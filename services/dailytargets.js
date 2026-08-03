// services/dailyTargets.js
"use strict";

const db = require('./jsonDb');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_TARGET = { targetQuestions: 10, targetMinutes: 20 };

class DailyTargetsService {
    constructor() {
        this.collection = 'daily_targets';
    }

    todayKey(date = new Date()) {
        return date.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // Progress is always computed live from practice_sessions for that day —
    // never stored/incremented manually — so it can never drift out of sync
    // with what the student actually did.
    async getProgressForDate(studentId, date) {
        const sessions = await db.find('practice_sessions', { studentId });
        const daySessions = sessions.filter(s => {
            const ts = s.completedAt || s.startedAt;
            return ts && ts.slice(0, 10) === date;
        });

        let questionsAnswered = 0;
        let correct = 0;
        let timeSpentSeconds = 0;

        daySessions.forEach(s => {
            questionsAnswered += s.stats?.answered || 0;
            correct += s.stats?.correct || 0;
            timeSpentSeconds += s.stats?.timeSpent || 0;
        });

        return {
            questionsAnswered,
            correct,
            accuracy: questionsAnswered > 0 ? Math.round((correct / questionsAnswered) * 100) : 0,
            minutesSpent: Math.round(timeSpentSeconds / 60),
            sessionsCount: daySessions.length
        };
    }

    async getOrCreateForDate(studentId, date) {
        let target = await db.findOne(this.collection, { studentId, date });

        if (!target) {
            // Carry forward the most recent goal the student set, if any,
            // otherwise fall back to a sensible default.
            const recent = await db.find(this.collection, { studentId }, { sort: 'date:desc', limit: 1 });
            const carried = recent[0];

            target = {
                id: uuidv4(),
                studentId,
                date,
                targetQuestions: carried?.targetQuestions || DEFAULT_TARGET.targetQuestions,
                targetMinutes: carried?.targetMinutes || DEFAULT_TARGET.targetMinutes,
                createdAt: new Date().toISOString()
            };
            await db.insert(this.collection, target);
        }

        return target;
    }

    async getToday(studentId) {
        const date = this.todayKey();
        const target = await this.getOrCreateForDate(studentId, date);
        const progress = await this.getProgressForDate(studentId, date);

        return {
            ...target,
            progress,
            achieved: progress.questionsAnswered >= target.targetQuestions
        };
    }

    async updateToday(studentId, { targetQuestions, targetMinutes }) {
        const date = this.todayKey();
        const target = await this.getOrCreateForDate(studentId, date);

        if (targetQuestions !== undefined && targetQuestions !== null) {
            target.targetQuestions = Math.max(1, parseInt(targetQuestions) || DEFAULT_TARGET.targetQuestions);
        }
        if (targetMinutes !== undefined && targetMinutes !== null) {
            target.targetMinutes = Math.max(1, parseInt(targetMinutes) || DEFAULT_TARGET.targetMinutes);
        }

        await db.updateById(this.collection, target.id, target);

        const progress = await this.getProgressForDate(studentId, date);
        return { ...target, progress, achieved: progress.questionsAnswered >= target.targetQuestions };
    }

    async getHistory(studentId, days = 14) {
        const targets = await db.find(this.collection, { studentId }, { sort: 'date:desc', limit: days });

        const withProgress = await Promise.all(
            targets.map(async t => {
                const progress = await this.getProgressForDate(studentId, t.date);
                return { ...t, progress, achieved: progress.questionsAnswered >= t.targetQuestions };
            })
        );

        return withProgress.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Consecutive days (ending today or yesterday) where the target was met.
    async getTargetStreak(studentId) {
        const history = await this.getHistory(studentId, 60);
        const byDate = new Map(history.map(h => [h.date, h]));

        let streak = 0;
        const cursor = new Date();
        if (!byDate.get(this.todayKey(cursor))?.achieved) {
            cursor.setDate(cursor.getDate() - 1);
        }

        while (true) {
            const key = this.todayKey(cursor);
            const day = byDate.get(key);
            if (!day || !day.achieved) break;
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        return streak;
    }
}

module.exports = new DailyTargetsService();