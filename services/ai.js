// services/ai.js
"use strict";

const db = require('./jsonDb');
const logger = require('../utils/logger');
const { callClaude, isConfigured: isAIConfigured } = require('../utils/llm');

class AIService {
    constructor() {
        this.weights = {
            accuracy: 0.3,
            speed: 0.2,
            difficulty: 0.2,
            consistency: 0.15,
            improvement: 0.15
        };
    }

    async getSuggestions(studentId) {
        const student = await db.findById('users', studentId);
        if (!student) throw new Error('Student not found');

        const [stats, results, weakAreas, strongAreas] = await Promise.all([
            this.getStudentStats(studentId),
            this.getRecentResults(studentId),
            this.getWeakAreas(studentId),
            this.getStrongAreas(studentId)
        ]);

        return {
            recommendations: await this.getRecommendations(student, stats, weakAreas),
            weakTopics: weakAreas,
            strongTopics: strongAreas,
            dailyGoal: this.getDailyGoal(student, stats),
            revisionPlan: await this.getRevisionPlan(studentId, weakAreas),
            practiceSuggestions: this.getPracticeSuggestions(weakAreas, strongAreas),
            nextTest: await this.suggestTest(studentId, weakAreas)
        };
    }

    async getStudentStats(studentId) {
        const data = await db.find('results', { studentId });
        
        if (data.length === 0) return null;

        const scores = data.map(r => r.score);
        const times = data.map(r => r.timeTaken);
        
        return {
            averageScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            bestScore: Math.max(...scores),
            worstScore: Math.min(...scores),
            averageTime: times.reduce((a, b) => a + b, 0) / times.length,
            totalTests: data.length,
            trend: this.calculateTrend(scores)
        };
    }

    async getRecentResults(studentId) {
        const results = await db.find('results', { studentId }, {
            sort: 'createdAt:desc',
            limit: 10
        });
        return results;
    }

    async getWeakAreas(studentId) {
        const results = await db.find('results', { studentId });
        const subjectStats = {};

        results.forEach(result => {
            if (result.subjectWise) {
                Object.entries(result.subjectWise).forEach(([subject, data]) => {
                    if (!subjectStats[subject]) {
                        subjectStats[subject] = { total: 0, correct: 0 };
                    }
                    subjectStats[subject].total += data.total || 0;
                    subjectStats[subject].correct += data.correct || 0;
                });
            }
        });

        const weakAreas = Object.entries(subjectStats)
            .map(([subject, stats]) => ({
                subject,
                accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
                total: stats.total
            }))
            .filter(item => item.accuracy < 60 && item.total > 5)
            .sort((a, b) => a.accuracy - b.accuracy);

        return weakAreas;
    }

    async getStrongAreas(studentId) {
        const results = await db.find('results', { studentId });
        const subjectStats = {};

        results.forEach(result => {
            if (result.subjectWise) {
                Object.entries(result.subjectWise).forEach(([subject, data]) => {
                    if (!subjectStats[subject]) {
                        subjectStats[subject] = { total: 0, correct: 0 };
                    }
                    subjectStats[subject].total += data.total || 0;
                    subjectStats[subject].correct += data.correct || 0;
                });
            }
        });

        const strongAreas = Object.entries(subjectStats)
            .map(([subject, stats]) => ({
                subject,
                accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
                total: stats.total
            }))
            .filter(item => item.accuracy > 75 && item.total > 5)
            .sort((a, b) => b.accuracy - a.accuracy);

        return strongAreas;
    }

    async getRecommendations(student, stats, weakAreas) {
        const recommendations = [];

        if (!stats) {
            recommendations.push({
                type: 'test',
                title: 'Start Your First Test',
                description: 'Take a diagnostic test to identify your strengths and weaknesses.',
                priority: 'high'
            });
            return recommendations;
        }

        // Based on weak areas
        if (weakAreas && weakAreas.length > 0) {
            const topWeak = weakAreas[0];
            recommendations.push({
                type: 'practice',
                title: `Focus on ${topWeak.subject}`,
                description: `Your accuracy in ${topWeak.subject} is ${topWeak.accuracy.toFixed(1)}%. Practice more questions.`,
                priority: 'high',
                subject: topWeak.subject
            });
        }

        // Based on performance trend
        if (stats.trend < 0) {
            recommendations.push({
                type: 'revision',
                title: 'Time for Revision',
                description: 'Your performance is declining. Review previous topics and practice more.',
                priority: 'medium'
            });
        }

        // Based on time management
        if (stats.averageTime > 60) {
            recommendations.push({
                type: 'speed',
                title: 'Improve Speed',
                description: `You take ${stats.averageTime} minutes per test. Practice speed drills.`,
                priority: 'medium'
            });
        }

        // Daily recommendation
        recommendations.push({
            type: 'daily',
            title: 'Daily Practice Goal',
            description: 'Solve 20 questions today to maintain consistency.',
            priority: 'low'
        });

        return recommendations;
    }

    getDailyGoal(student, stats) {
        const base = 20;
        let multiplier = 1;

        if (stats) {
            if (stats.averageScore < 50) multiplier = 0.75;
            else if (stats.averageScore > 80) multiplier = 1.25;
        }

        const goal = Math.round(base * multiplier);
        return {
            questions: goal,
            subject: 'Mixed',
            time: `${Math.round(goal * 1.5)} minutes`
        };
    }

    async getRevisionPlan(studentId, weakAreas) {
        const plan = [];

        if (weakAreas.length > 0) {
            // Create revision plan for weak areas
            const weakSubjects = weakAreas.slice(0, 3);
            for (const area of weakSubjects) {
                const questions = await this.getPracticeQuestions(area.subject, 10);
                plan.push({
                    subject: area.subject,
                    action: 'Practice Questions',
                    count: 10,
                    questions: questions.slice(0, 5).map(q => q.id)
                });
            }
        }

        // Add general revision
        plan.push({
            subject: 'Mixed',
            action: 'Review Previous Mistakes',
            count: 5,
            type: 'review'
        });

        return plan;
    }

    getPracticeSuggestions(weakAreas, strongAreas) {
        const suggestions = [];

        if (weakAreas.length > 0) {
            suggestions.push({
                type: 'weak',
                subjects: weakAreas.slice(0, 2).map(w => w.subject),
                description: 'Focus on these subjects to improve your weak areas.',
                priority: 'high'
            });
        }

        if (strongAreas.length > 0) {
            suggestions.push({
                type: 'strong',
                subjects: strongAreas.slice(0, 2).map(s => s.subject),
                description: 'Maintain your strengths with regular practice.',
                priority: 'medium'
            });
        }

        return suggestions;
    }

    async suggestTest(studentId, weakAreas) {
        const tests = await db.find('tests', { status: 'active' });
        
        if (weakAreas.length > 0) {
            // Suggest test covering weak areas
            const weakSubjects = weakAreas.map(w => w.subject);
            const relevantTests = tests.filter(test => 
                weakSubjects.some(subject => test.subjects.includes(subject))
            );

            if (relevantTests.length > 0) {
                return relevantTests[0];
            }
        }

        // Return any active test
        return tests.length > 0 ? tests[0] : null;
    }

    async getPracticeQuestions(subject, count = 10) {
        const questions = await db.find('questions', {
            subject,
            status: 'active'
        });
        return this.shuffleArray(questions).slice(0, count);
    }

    calculateTrend(scores) {
        if (scores.length < 2) return 0;
        
        const first = scores.slice(0, Math.floor(scores.length / 2));
        const last = scores.slice(Math.floor(scores.length / 2));
        
        const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
        const lastAvg = last.reduce((a, b) => a + b, 0) / last.length;
        
        return lastAvg - firstAvg;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    async getLearningPath(studentId) {
        const [weak, strong] = await Promise.all([
            this.getWeakAreas(studentId),
            this.getStrongAreas(studentId)
        ]);

        return {
            immediateFocus: weak.slice(0, 2),
            shortTermGoal: 'Improve weak areas by 20%',
            longTermGoal: 'Master all subjects',
            estimatedTime: '4-6 weeks',
            milestones: [
                { week: 1, goal: 'Complete basic practice in weak areas' },
                { week: 2, goal: 'Achieve 60% accuracy in weak subjects' },
                { week: 3, goal: 'Take mock tests' },
                { week: 4, goal: 'Review and consolidate' }
            ]
        };
    }

    // NOTE: getStudyPlanner/getChapterAnalysis are called by
    // controllers/student/aiController.js but had never actually been
    // implemented here — any request to those endpoints would throw
    // "aiService.X is not a function". Added while touching this file for
    // the AI module work so those routes stop being dead ends.
    async getStudyPlanner(studentId, days = 7) {
        const weakAreas = await this.getWeakAreas(studentId);
        const topics = weakAreas.length > 0 ? weakAreas.map(w => w.subject) : ['Mixed Revision'];

        const plan = [];
        for (let day = 1; day <= days; day += 1) {
            const topic = topics[(day - 1) % topics.length];
            plan.push({
                day,
                focus: topic,
                tasks: [
                    { type: 'practice', description: `Solve 15 ${topic} questions`, estimatedMinutes: 30 },
                    { type: 'review', description: 'Review mistakes from the previous day', estimatedMinutes: 15 },
                ],
            });
        }
        return { days, weakTopicsCovered: topics, plan };
    }

    async getChapterAnalysis(studentId, subject) {
        const results = await db.find('results', { studentId });
        let total = 0;
        let correct = 0;
        let attempts = 0;

        results.forEach(result => {
            if (result.subjectWise && result.subjectWise[subject]) {
                total += result.subjectWise[subject].total || 0;
                correct += result.subjectWise[subject].correct || 0;
                attempts += 1;
            }
        });

        const accuracy = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
        return {
            subject,
            attempts,
            questionsAttempted: total,
            correctAnswers: correct,
            accuracy,
            status: total === 0 ? 'no_data' : accuracy >= 75 ? 'strong' : accuracy >= 50 ? 'average' : 'weak',
        };
    }

    // ── AI Performance Prediction ───────────────────────────────────────────
    // Core prediction is pure statistics (linear trend + confidence banding)
    // so it always works with zero setup. If GEMINI_API_KEY is configured,
    // a short plain-language narrative is layered on top — but the numbers
    // themselves never depend on the AI being available.
    async predictPerformance(studentId) {
        const student = await db.findById('users', studentId);
        if (!student) throw new Error('Student not found');

        const results = await db.find('results', { studentId }, { sort: 'createdAt:desc' });
        if (results.length < 2) {
            return {
                hasEnoughData: false,
                totalTests: results.length,
                message: results.length === 0
                    ? 'No test attempts yet — a prediction needs at least 2 tests to spot a trend.'
                    : 'Only one test attempt so far — one more will unlock a trend-based prediction.',
            };
        }

        // Oldest → newest for a proper trend read.
        const chronological = results.slice().reverse();
        const scores = chronological.map(r => r.score);
        const n = scores.length;

        // Simple linear regression over test index → score, so "predicted
        // next score" reflects the actual trajectory rather than just the
        // last result or a flat average.
        const xs = scores.map((_, i) => i);
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = scores.reduce((a, b) => a + b, 0) / n;
        const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (scores[i] - meanY), 0)
            / (xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0) || 1);
        const intercept = meanY - slope * meanX;

        const rawPrediction = intercept + slope * n;
        const predictedScore = Math.max(0, Math.min(100, Math.round(rawPrediction)));

        // Confidence grows with sample size and shrinks with volatility.
        const variance = scores.reduce((sum, s) => sum + (s - meanY) ** 2, 0) / n;
        const stdDev = Math.sqrt(variance);
        const volatilityPenalty = Math.min(40, stdDev);
        const sampleBonus = Math.min(30, n * 4);
        const confidence = Math.max(20, Math.min(90, 50 + sampleBonus - volatilityPenalty));

        const riskLevel = predictedScore < 40 ? 'high' : predictedScore < 60 ? 'medium' : 'low';

        const prediction = {
            hasEnoughData: true,
            totalTests: n,
            currentAverage: Math.round(meanY * 10) / 10,
            recentTrend: slope > 1 ? 'improving' : slope < -1 ? 'declining' : 'stable',
            predictedNextScore: predictedScore,
            confidence: Math.round(confidence),
            riskLevel,
            scoreHistory: chronological.map(r => ({ date: r.createdAt, score: r.score })),
        };

        if (isAIConfigured()) {
            const narrative = await callClaude({
                system: 'You are an academic advisor at an Indian coaching institute. Given a student\'s test score trend, write ONE short, encouraging, plain-language paragraph (2-3 sentences max) explaining the outlook and one concrete next step. No headers, no markdown, no bullet points.',
                prompt: `Student: ${student.name}. Last ${n} test scores in order: ${scores.join(', ')}. Trend: ${prediction.recentTrend}. Predicted next score: ${predictedScore}/100 (confidence ${prediction.confidence}%). Risk level: ${riskLevel}.`,
                maxTokens: 300,
            });
            if (narrative.ok) prediction.narrative = narrative.text.trim();
        }

        return prediction;
    }

    // ── AI Weak Topic Recommendation ────────────────────────────────────────
    // Builds on the existing getWeakAreas() stats with actionable next steps
    // (how many bank questions are available to practice with right now) and,
    // if configured, a short AI-written study tip per weak topic.
    async getWeakTopicRecommendations(studentId) {
        const weakAreas = await this.getWeakAreas(studentId);
        if (weakAreas.length === 0) {
            return { topics: [], message: 'No weak topics detected yet — keep taking tests to build up enough data.' };
        }

        const topics = [];
        for (const area of weakAreas.slice(0, 5)) {
            const availableQuestions = await db.find('questions', { chapter: area.subject, isActive: true });
            const topic = {
                subject: area.subject,
                accuracy: Math.round(area.accuracy * 10) / 10,
                questionsAttempted: area.total,
                availablePracticeQuestions: availableQuestions.length,
            };

            if (isAIConfigured()) {
                const tip = await callClaude({
                    system: 'You are a study coach. Given a weak topic and accuracy percentage, write ONE short, specific, actionable study tip (1-2 sentences, no markdown).',
                    prompt: `Topic: ${area.subject}. Current accuracy: ${topic.accuracy}% across ${area.total} attempted questions.`,
                    maxTokens: 150,
                });
                if (tip.ok) topic.aiTip = tip.text.trim();
            }

            topics.push(topic);
        }

        return { topics };
    }
}

module.exports = new AIService();