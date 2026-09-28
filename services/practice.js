// services/practice.js
"use strict";

const db = require('./jsonDb');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class PracticeService {
    constructor() {
        this.collection = 'practice_sessions';
    }

    async startSession(studentId, params) {
        const session = {
            id: uuidv4(),
            studentId,
            subject: params.subject,
            chapter: params.chapter,
            difficulty: params.difficulty,
            questionType: params.questionType,
            questions: [],
            currentIndex: 0,
            answers: {},
            startedAt: new Date().toISOString(),
            completedAt: null,
            status: 'active',
            stats: {
                total: 0,
                answered: 0,
                correct: 0,
                wrong: 0,
                skipped: 0,
                accuracy: 0,
                timeSpent: 0
            }
        };

        // Fetch questions (studentId must be included so bookmarked/wrong
        // filters below can look up this student's own bookmarks/wrong list)
        const questions = await this.getQuestions({ ...params, studentId });
        // NOTE: the question bank stores question text as `question` and the
        // correct option as `answer` (see services/questions.js) — not
        // `text`/`correctAnswer`. Mapped here so the rest of this service
        // (and the frontend) can keep using the friendlier text/correctAnswer
        // names internally without touching the question bank's own schema.
        session.questions = questions.map(q => ({
            id: q.id,
            text: q.question,
            options: q.options,
            type: q.type,
            difficulty: q.difficulty || null, // not tracked by the question bank today
            subject: q.subject,
            chapter: q.chapter,
            marks: q.marks,
            explanation: q.explanation || null,
            correctAnswer: q.answer // Only for practice
        }));
        session.stats.total = questions.length;

        await db.insert(this.collection, session);
        return session;
    }

    async getQuestions(params) {
        // NOTE: the general question bank (collection "questions") has no
        // status/isActive/difficulty field — every record present is usable,
        // and deletions there are hard deletes. So no status filter here.
        let query = {};

        if (params.questionIds && params.questionIds.length) {
            // Explicit ID list (e.g. from the Revision queue) takes priority
            // over subject/chapter/bookmarked/wrong filters, which don't
            // make sense combined with a specific set of questions.
            query.id = { $in: params.questionIds };
        } else {
            if (params.subject) query.subject = params.subject;
            if (params.chapter) query.chapter = params.chapter;
            // difficulty isn't tracked by the question bank schema today;
            // only applied if a record happens to have one, so it's a safe no-op.
            if (params.difficulty) query.difficulty = params.difficulty;

            if (params.bookmarked) {
                // Get bookmarked questions
                const bookmarks = await db.find('bookmarks', { studentId: params.studentId });
                const questionIds = bookmarks.map(b => b.questionId);
                query.id = { $in: questionIds };
            }

            if (params.wrong) {
                // Get wrong questions
                const wrong = await db.find('wrong_questions', { studentId: params.studentId });
                const questionIds = wrong.map(w => w.questionId);
                query.id = { $in: questionIds };
            }
        }

        let questions = await db.find('questions', query);

        // Question type (e.g. "MCQ") is matched case-insensitively since the
        // question bank and this API don't agree on casing conventions.
        if (params.questionType) {
            const wanted = String(params.questionType).toLowerCase();
            questions = questions.filter(q => String(q.type || '').toLowerCase() === wanted);
        }

        let result = questions;

        // Randomize if needed
        if (params.random) {
            result = this.shuffleArray(result);
        }

        // Limit (controller sends this as "count"; accept either key)
        const limit = params.limit || params.count;
        if (limit) {
            result = result.slice(0, limit);
        }

        return result;
    }

    async submitAnswer(sessionId, questionId, answer, timeTaken) {
        const session = await db.findOne(this.collection, { id: sessionId });
        if (!session) throw new Error('Session not found');

        const question = session.questions.find(q => q.id === questionId);
        if (!question) throw new Error('Question not found');

        const isCorrect = question.correctAnswer === answer;
        
        session.answers[questionId] = {
            answer,
            isCorrect,
            timeTaken,
            timestamp: new Date().toISOString()
        };

        // Update stats
        session.stats.answered++;
        if (isCorrect) session.stats.correct++;
        else session.stats.wrong++;
        session.stats.timeSpent += timeTaken;
        session.stats.accuracy = (session.stats.correct / session.stats.answered) * 100;

        // Move to next question
        session.currentIndex++;

        await db.updateById(this.collection, sessionId, session);
        
        // Track wrong question
        if (!isCorrect) {
            await this.trackWrongQuestion(session.studentId, questionId, question);
        }

        return {
            isCorrect,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            stats: session.stats
        };
    }

    async getSession(sessionId) {
        return db.findOne(this.collection, { id: sessionId });
    }

    async completeSession(sessionId) {
        const session = await db.findOne(this.collection, { id: sessionId });
        if (!session) throw new Error('Session not found');

        session.status = 'completed';
        session.completedAt = new Date().toISOString();
        
        // Final stats
        session.stats.skipped = session.stats.total - session.stats.answered;
        
        await db.updateById(this.collection, sessionId, session);

        // NOTE: XP/coins/streak/achievements are awarded by the controller via
        // services/gamification.js (single source of truth). This service used
        // to also award them here via updateGamification(), which caused a
        // double-award bug (every completed session gave XP/coins twice).

        return session;
    }

    async trackWrongQuestion(studentId, questionId, question) {
        const wrong = await db.findOne('wrong_questions', {
            studentId,
            questionId
        });

        if (wrong) {
            wrong.count++;
            wrong.lastAttempted = new Date().toISOString();
            wrong.improved = false; // wrong again — back into the pending notebook
            await db.updateById('wrong_questions', wrong.id, wrong);
        } else {
            await db.insert('wrong_questions', {
                id: uuidv4(),
                studentId,
                questionId,
                question: question.text,
                subject: question.subject,
                chapter: question.chapter,
                difficulty: question.difficulty,
                count: 1,
                lastAttempted: new Date().toISOString(),
                improved: false
            });
        }
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    async getSessionStats(sessionId) {
        const session = await db.findOne(this.collection, { id: sessionId });
        if (!session) throw new Error('Session not found');
        return session.stats;
    }

    async getPracticeHistory(studentId, limit = 10) {
        const sessions = await db.find(this.collection, {
            studentId,
            status: 'completed'
        }, { sort: 'completedAt:desc', limit });
        return sessions;
    }

    async getAvailableFilters() {
        const questions = await db.find('questions', {});
        const subjects = {};
        const types = new Set();
        const difficulties = new Set();

        questions.forEach(q => {
            if (q.subject) {
                if (!subjects[q.subject]) subjects[q.subject] = new Set();
                if (q.chapter) subjects[q.subject].add(q.chapter);
            }
            if (q.type) types.add(q.type);
            // difficulty isn't part of the question bank schema today, but
            // pick it up if a record happens to have one set manually.
            if (q.difficulty) difficulties.add(q.difficulty);
        });

        return {
            subjects: Object.keys(subjects).sort(),
            chaptersBySubject: Object.fromEntries(
                Object.entries(subjects).map(([s, chapters]) => [s, Array.from(chapters).sort()])
            ),
            types: Array.from(types).sort(),
            difficulties: Array.from(difficulties).sort()
        };
    }

    async getWrongQuestions(studentId, filters = {}) {
        const query = { studentId };
        if (filters.subject) query.subject = filters.subject;
        if (filters.chapter) query.chapter = filters.chapter;
        // By default only show questions still pending revision; pass
        // filters.improved = 'all' or 'true' to see improved ones too.
        if (!filters.improved || filters.improved === 'false') {
            query.improved = false;
        } else if (filters.improved === 'true') {
            query.improved = true;
        }

        const wrongQuestions = await db.find('wrong_questions', query, {
            sort: 'lastAttempted:desc',
            limit: filters.limit || 50
        });
        return wrongQuestions;
    }

    async markImproved(studentId, questionId) {
        const wrong = await db.findOne('wrong_questions', { studentId, questionId });
        if (!wrong) throw new Error('Wrong question entry not found');

        wrong.improved = true;
        wrong.improvedAt = new Date().toISOString();
        await db.updateById('wrong_questions', wrong.id, wrong);
        return wrong;
    }

    // Offline, rule-based recommendations built purely from the student's own
    // history in the local DB (no external/paid AI call involved).
    async getRecommendations(studentId) {
        const [wrongQuestions, history] = await Promise.all([
            db.find('wrong_questions', { studentId, improved: false }),
            this.getPracticeHistory(studentId, 20)
        ]);

        // Weak subjects/chapters = where wrong questions pile up most
        const bySubject = {};
        wrongQuestions.forEach(w => {
            const key = w.subject || 'General';
            bySubject[key] = bySubject[key] || { subject: key, chapters: {}, count: 0 };
            bySubject[key].count++;
            if (w.chapter) {
                bySubject[key].chapters[w.chapter] = (bySubject[key].chapters[w.chapter] || 0) + 1;
            }
        });

        const weakSubjects = Object.values(bySubject)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(s => ({
                subject: s.subject,
                pendingWrongQuestions: s.count,
                topChapter: Object.entries(s.chapters).sort((a, b) => b[1] - a[1])[0]?.[0] || null
            }));

        // Recent accuracy trend from last completed sessions
        const recentAccuracy = history.length
            ? Math.round(history.reduce((sum, s) => sum + (s.stats?.accuracy || 0), 0) / history.length)
            : null;

        const recommendations = [];

        if (weakSubjects.length) {
            weakSubjects.forEach(s => {
                recommendations.push({
                    type: 'weak_subject',
                    subject: s.subject,
                    chapter: s.topChapter,
                    reason: `${s.pendingWrongQuestions} unresolved wrong question(s)${s.topChapter ? ` in ${s.topChapter}` : ''}`,
                    suggestedAction: 'practice_wrong'
                });
            });
        }

        if (recentAccuracy !== null && recentAccuracy < 60) {
            recommendations.push({
                type: 'low_accuracy',
                reason: `Your recent practice accuracy is ${recentAccuracy}%. A slower, focused session may help.`,
                suggestedAction: 'practice_easy'
            });
        }

        if (!wrongQuestions.length && !history.length) {
            recommendations.push({
                type: 'get_started',
                reason: 'You haven\'t started practicing yet. Pick a subject to begin.',
                suggestedAction: 'practice_new'
            });
        }

        return {
            recentAccuracy,
            weakSubjects,
            recommendations
        };
    }
}

module.exports = new PracticeService();