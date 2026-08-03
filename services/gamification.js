// services/gamification.js
"use strict";

const db = require('./jsonDb');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class GamificationService {
    constructor() {
        this.collection = 'gamification';
        this.levels = [
            { level: 1, xpRequired: 0, title: 'Beginner' },
            { level: 2, xpRequired: 1000, title: 'Student' },
            { level: 3, xpRequired: 2500, title: 'Scholar' },
            { level: 4, xpRequired: 5000, title: 'Master' },
            { level: 5, xpRequired: 10000, title: 'Expert' },
            { level: 6, xpRequired: 20000, title: 'Pro' },
            { level: 7, xpRequired: 35000, title: 'Elite' },
            { level: 8, xpRequired: 50000, title: 'Legend' },
            { level: 9, xpRequired: 75000, title: 'Grand Master' },
            { level: 10, xpRequired: 100000, title: 'Champion' }
        ];

        this.achievements = {
            first_test: { title: 'First Test', icon: '🎯', description: 'Complete your first test' },
            perfect_score: { title: 'Perfect Score', icon: '⭐', description: 'Score 100% in a test' },
            streak_7: { title: '7 Day Streak', icon: '🔥', description: 'Practice for 7 days in a row' },
            streak_30: { title: '30 Day Streak', icon: '💎', description: 'Practice for 30 days in a row' },
            master_subject: { title: 'Subject Master', icon: '📚', description: 'Achieve 90%+ in a subject' },
            speed_demon: { title: 'Speed Demon', icon: '⚡', description: 'Complete a test in half the time' },
            problem_solver: { title: 'Problem Solver', icon: '🧩', description: 'Solve 100 questions' },
            bookworm: { title: 'Bookworm', icon: '📖', description: 'Download 50 notes' },
            helper: { title: 'Helper', icon: '🤝', description: 'Help 5 other students' },
            champion: { title: 'Champion', icon: '🏆', description: 'Top the leaderboard' }
        };
    }

    async getGamificationData(studentId) {
        const student = await db.findById('users', studentId);
        if (!student) throw new Error('Student not found');

        const [achievements, rank] = await Promise.all([
            this.getAchievements(studentId),
            this.getRank(studentId)
        ]);

        const currentLevel = this.getLevel(student.xp || 0);
        const nextLevel = this.getNextLevel(currentLevel);

        return {
            xp: student.xp || 0,
            coins: student.coins || 0,
            level: currentLevel,
            nextLevel: nextLevel,
            streak: student.streak || 0,
            achievements,
            rank,
            badges: this.getBadges(achievements)
        };
    }

    async addXP(studentId, amount, source) {
        const student = await db.findById('users', studentId);
        if (!student) throw new Error('Student not found');

        student.xp = (student.xp || 0) + amount;
        student.lastActivity = new Date().toISOString();

        // Check level up
        const newLevel = this.getLevel(student.xp);
        const oldLevel = this.getLevel(student.xp - amount);

        if (newLevel.level > oldLevel.level) {
            // Level up!
            await this.handleLevelUp(studentId, newLevel);
        }

        await db.updateById('users', student._id, student);
        
        return {
            xp: student.xp,
            levelUp: newLevel.level > oldLevel.level,
            newLevel: newLevel
        };
    }

    async addCoins(studentId, amount, source) {
        const student = await db.findById('users', studentId);
        if (!student) throw new Error('Student not found');

        student.coins = (student.coins || 0) + amount;
        await db.updateById('users', student._id, student);

        return student.coins;
    }

    getLevel(xp) {
        let level = this.levels[0];
        for (const l of this.levels) {
            if (xp >= l.xpRequired) {
                level = l;
            }
        }
        return level;
    }

    getNextLevel(currentLevel) {
        const index = this.levels.findIndex(l => l.level === currentLevel.level);
        if (index === this.levels.length - 1) {
            return null;
        }
        return this.levels[index + 1];
    }

    async handleLevelUp(studentId, newLevel) {
        // Create level up achievement
        await this.unlockAchievement(studentId, 'level_up', {
            title: `Level ${newLevel.level}!`,
            icon: '🌟',
            description: `You've reached Level ${newLevel.level}: ${newLevel.title}`
        }, newLevel.level);

        // Send notification
        const notifications = require('./notifications');
        await notifications.createNotification(
            studentId,
            'achievement',
            `🎉 Level Up! ${newLevel.title}`,
            `You've reached Level ${newLevel.level}! Keep going!`
        );

        // Award bonus coins
        await this.addCoins(studentId, newLevel.level * 10, 'level_up');
    }

    async getAchievements(studentId) {
        const achievements = await db.find('achievements', { studentId });
        return achievements;
    }

    // Merge the static achievement catalog with what this student has
    // actually earned, so the UI can show locked achievements too (not
    // just the ones already unlocked).
    async getCatalogWithProgress(studentId) {
        const earned = await this.getAchievements(studentId);
        const earnedByType = new Map();
        earned.forEach(a => {
            // Keep the earliest-earned record per type for the catalog badge
            if (!earnedByType.has(a.type) || new Date(a.earnedAt) < new Date(earnedByType.get(a.type).earnedAt)) {
                earnedByType.set(a.type, a);
            }
        });

        return Object.entries(this.achievements).map(([type, def]) => {
            const record = earnedByType.get(type);
            return {
                type,
                title: def.title,
                icon: def.icon,
                description: def.description,
                unlocked: !!record,
                earnedAt: record?.earnedAt || null
            };
        });
    }

    async unlockAchievement(studentId, type, customData = null, variantKey = null) {
        const achievement = this.achievements[type];
        // Allow "virtual" achievement types (not in the static catalog above)
        // as long as full custom data is supplied — e.g. level_up and
        // master_subject both reuse this for per-level/per-subject variants.
        if (!achievement && !customData) return null;

        // Achievements like level_up (per level) or master_subject (per
        // subject) need a per-variant dedup key, not just the bare type,
        // otherwise they can only ever be earned once, ever.
        const dedupKey = variantKey ? `${type}:${variantKey}` : type;

        // Check if already earned
        const existing = await db.findOne('achievements', {
            studentId,
            dedupKey
        });

        if (existing) return existing;

        const newAchievement = {
            id: uuidv4(),
            studentId,
            type,
            dedupKey,
            title: customData?.title || achievement?.title,
            icon: customData?.icon || achievement?.icon,
            description: customData?.description || achievement?.description,
            earnedAt: new Date().toISOString(),
            progress: 100
        };

        await db.insert('achievements', newAchievement);

        // Send notification
        const notifications = require('./notifications');
        await notifications.createNotification(
            studentId,
            'achievement',
            `🏆 Achievement Unlocked: ${newAchievement.title}`,
            newAchievement.description
        );

        // Award bonus
        await this.addCoins(studentId, 50, 'achievement');
        await this.addXP(studentId, 100, 'achievement');

        return newAchievement;
    }

    getBadges(achievements) {
        return achievements.map(a => ({
            id: a.id,
            title: a.title,
            icon: a.icon,
            earnedAt: a.earnedAt
        }));
    }

    async getRank(studentId) {
        const students = await db.find('users', { role: 'student' });
        const sorted = students
            .filter(s => s.xp)
            .sort((a, b) => (b.xp || 0) - (a.xp || 0));

        const rank = sorted.findIndex(s => s._id === studentId) + 1;
        return rank > 0 ? rank : null;
    }

    async updateStreak(studentId) {
        const student = await db.findById('users', studentId);
        if (!student) return;

        const today = new Date().toDateString();
        const lastActivity = student.lastActivity ? new Date(student.lastActivity).toDateString() : null;

        if (lastActivity === today) return;

        if (lastActivity === new Date(Date.now() - 86400000).toDateString()) {
            student.streak = (student.streak || 0) + 1;
            
            // Check streak achievements
            if (student.streak === 7) {
                await this.unlockAchievement(studentId, 'streak_7');
            } else if (student.streak === 30) {
                await this.unlockAchievement(studentId, 'streak_30');
            }
        } else {
            student.streak = 1;
        }

        student.lastActivity = new Date().toISOString();
        await db.updateById('users', student._id, student);

        return student.streak;
    }

    async getLeaderboard(batchId = null, limit = 100) {
        const query = batchId ? { role: 'student', classId: batchId } : { role: 'student' };
        const students = await db.find('users', query);

        const sorted = students
            .filter(s => s.xp)
            .sort((a, b) => (b.xp || 0) - (a.xp || 0))
            .slice(0, limit)
            .map((s, index) => ({
                rank: index + 1,
                name: s.name,
                class: s.class,
                section: s.section,
                xp: s.xp || 0,
                coins: s.coins || 0,
                level: this.getLevel(s.xp || 0),
                streak: s.streak || 0
            }));

        return sorted;
    }

    async getDailyRewards(studentId) {
        const today = new Date().toDateString();
        const claimed = await db.findOne('daily_rewards', {
            studentId,
            date: today
        });

        if (claimed) {
            return { claimed: true, reward: claimed.reward };
        }

        const streak = await this.getStreak(studentId);
        const reward = {
            xp: 50 + streak * 10,
            coins: 20 + streak * 5
        };

        return { claimed: false, reward };
    }

    async claimDailyReward(studentId) {
        const today = new Date().toDateString();
        const existing = await db.findOne('daily_rewards', {
            studentId,
            date: today
        });

        if (existing) {
            throw new Error('Daily reward already claimed');
        }

        const reward = await this.getDailyRewards(studentId);
        await this.addXP(studentId, reward.reward.xp, 'daily_reward');
        await this.addCoins(studentId, reward.reward.coins, 'daily_reward');

        await db.insert('daily_rewards', {
            id: uuidv4(),
            studentId,
            date: today,
            reward: reward.reward,
            claimedAt: new Date().toISOString()
        });

        return reward.reward;
    }

    async getStreak(studentId) {
        const student = await db.findById('users', studentId);
        return student?.streak || 0;
    }

    // Check and unlock achievements based on actions
    async checkAchievements(studentId, action, data) {
        const student = await db.findById('users', studentId);
        if (!student) return;

        switch (action) {
            case 'test_completed':
                if (data.score === 100) {
                    await this.unlockAchievement(studentId, 'perfect_score');
                }
                const results = await db.find('results', { studentId });
                if (results.length === 1) {
                    await this.unlockAchievement(studentId, 'first_test');
                }
                break;

            case 'notes_downloaded':
                if (data.count >= 50) {
                    await this.unlockAchievement(studentId, 'bookworm');
                }
                break;

            case 'questions_solved':
                if (data.count >= 100) {
                    await this.unlockAchievement(studentId, 'problem_solver');
                }
                break;

            case 'subject_master':
                if (data.subject && data.accuracy >= 90) {
                    await this.unlockAchievement(studentId, 'master_subject', {
                        title: `Master of ${data.subject}`,
                        icon: '📚',
                        description: `Achieved 90%+ accuracy in ${data.subject}`
                    }, data.subject);
                }
                break;

            case 'speed_demon':
                if (data.timeTaken < data.expectedTime / 2) {
                    await this.unlockAchievement(studentId, 'speed_demon');
                }
                break;
        }
    }
}

module.exports = new GamificationService();