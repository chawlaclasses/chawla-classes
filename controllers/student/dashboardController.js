// controllers/student/dashboardController.js
"use strict";

const db = require('../../services/jsonDb');
const { asyncHandler } = require('../../middleware/error');
const { AppError } = require('../../middleware/error');
const logger = require('../../utils/logger');

// ─── Get Dashboard Data ─────────────────────────────────────────────────────
exports.getDashboard = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const classId = req.user.class;
    const batchId = req.user.batch;

    try {
        const [
            stats,
            upcomingTests,
            recentResults,
            notifications,
            attendance,
            homework,
            achievements,
            gamification,
            weakChapters,
            strongChapters,
            recentActivity,
            aiSuggestions,
            resumeTest,
            dailyTarget,
            leaderboard
        ] = await Promise.all([
            getStudentStats(userId),
            getUpcomingTests(classId, batchId),
            getRecentResults(userId),
            getNotifications(userId),
            getAttendance(userId),
            getHomework(userId),
            getAchievements(userId),
            getGamification(userId),
            getWeakChapters(userId),
            getStrongChapters(userId),
            getRecentActivity(userId),
            getAISuggestions(userId),
            getResumeTest(userId),
            getDailyTarget(userId),
            getLeaderboard(batchId)
        ]);

        res.json({
            success: true,
            data: {
                stats,
                upcomingTests,
                recentResults,
                notifications,
                attendance,
                homework,
                achievements,
                gamification,
                weakChapters,
                strongChapters,
                recentActivity,
                aiSuggestions,
                resumeTest,
                dailyTarget,
                leaderboard
            }
        });
    } catch (error) {
        logger.error('Dashboard fetch failed:', error);
        throw new AppError('Failed to fetch dashboard data', 500);
    }
});

// ─── Get Student Stats ──────────────────────────────────────────────────────
async function getStudentStats(userId) {
    const [tests, results, attendance, student] = await Promise.all([
        db.find('test_results', { userId }),
        db.find('results', { userId }),
        db.find('attendance', { userId }),
        db.findById('students', userId)
    ]);

    const totalTests = tests.data.length;
    const completedTests = tests.data.filter(t => t.completed).length;
    const scores = tests.data.map(t => t.score).filter(s => s !== null && s !== undefined);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Calculate rank
    const allScores = await db.find('test_results', { completed: true });
    const sorted = allScores.data.sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(t => t.userId === userId) + 1;

    // Attendance
    const present = attendance.data.filter(a => a.status === 'present').length;
    const total = attendance.data.length;
    const attendancePercent = total > 0 ? Math.round((present / total) * 100) : 0;

    // Streak
    const streak = await calculateStreak(userId);

    // Questions solved
    const questionsSolved = tests.data.reduce((sum, t) => sum + (t.questionsAttempted || 0), 0);

    // Bookmarks and wrong questions
    const [bookmarks, wrongQuestions] = await Promise.all([
        db.find('bookmarks', { studentId: userId }),
        db.find('wrong_questions', { studentId: userId })
    ]);

    return {
        totalTests,
        completedTests,
        pendingTests: totalTests - completedTests,
        avgScore,
        bestScore,
        rank: rank || 'N/A',
        attendance: attendancePercent,
        streak: streak || 0,
        level: Math.floor(avgScore / 10) + 1,
        xp: completedTests * 100 + avgScore * 2,
        coins: completedTests * 50 + Math.floor(avgScore / 2),
        achievements: 8,
        certificates: 3,
        hoursStudied: Math.round(completedTests * 1.5),
        questionsSolved,
        accuracy: avgScore,
        weakChapters: 3,
        strongChapters: 8,
        assignmentsPending: 2,
        notesDownloaded: 34,
        bookmarks: bookmarks.data.length,
        wrongQuestions: wrongQuestions.data.length
    };
}

// ─── Get Upcoming Tests ────────────────────────────────────────────────────
async function getUpcomingTests(classId, batchId) {
    const now = new Date();
    const tests = await db.find('tests', {
        class: classId,
        batch: batchId,
        status: 'active',
        date: { $gte: now.toISOString() }
    }, { sort: 'date:asc', limit: 5 });

    return tests.data.map(test => ({
        id: test.id,
        name: test.name,
        subject: test.subject,
        date: test.date,
        time: test.time,
        duration: test.duration,
        status: 'upcoming',
        venue: test.venue || 'Online'
    }));
}

// ─── Get Recent Results ─────────────────────────────────────────────────────
async function getRecentResults(userId) {
    const results = await db.find('results', { userId }, {
        sort: 'createdAt:desc',
        limit: 5
    });

    return results.data.map(result => ({
        id: result.id,
        testName: result.testName,
        subject: result.subject,
        score: result.score,
        maxScore: result.maxScore,
        percentage: Math.round((result.score / result.maxScore) * 100),
        date: result.createdAt,
        rank: result.rank,
        status: result.status || 'completed'
    }));
}

// ─── Get Notifications ──────────────────────────────────────────────────────
async function getNotifications(userId) {
    const notifications = await db.find('notifications', {
        userId,
        archived: false
    }, { sort: 'createdAt:desc', limit: 20 });

    return notifications.data.map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read || false,
        createdAt: n.createdAt,
        data: n.data || {}
    }));
}

// ─── Get Attendance ─────────────────────────────────────────────────────────
async function getAttendance(userId) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const records = await db.find('attendance', {
        userId,
        date: { $gte: monthAgo.toISOString() }
    }, { sort: 'date:desc' });

    return {
        records: records.data,
        total: records.data.length,
        present: records.data.filter(r => r.status === 'present').length,
        absent: records.data.filter(r => r.status === 'absent').length,
        late: records.data.filter(r => r.status === 'late').length,
        percentage: records.data.length > 0 ? 
            Math.round((records.data.filter(r => r.status === 'present').length / records.data.length) * 100) : 0
    };
}

// ─── Get Homework ───────────────────────────────────────────────────────────
async function getHomework(userId) {
    const homework = await db.find('homework', {
        userId,
        status: { $in: ['pending', 'in_progress'] }
    }, { sort: 'dueDate:asc' });

    return homework.data.map(h => ({
        id: h.id,
        title: h.title,
        subject: h.subject,
        description: h.description,
        dueDate: h.dueDate,
        status: h.status,
        priority: h.priority || 'normal',
        attachments: h.attachments || []
    }));
}

// ─── Get Achievements ──────────────────────────────────────────────────────
async function getAchievements(userId) {
    const achievements = await db.find('achievements', { studentId: userId });
    return achievements.data;
}

// ─── Get Gamification ──────────────────────────────────────────────────────
async function getGamification(userId) {
    const student = await db.findById('students', userId);
    const achievements = await db.find('achievements', { studentId: userId });

    return {
        xp: student?.xp || 0,
        coins: student?.coins || 0,
        level: Math.floor((student?.xp || 0) / 1000) + 1,
        streak: student?.streak || 0,
        achievements: achievements.data.length,
        nextLevelXp: (Math.floor((student?.xp || 0) / 1000) + 1) * 1000,
        xpToNextLevel: ((Math.floor((student?.xp || 0) / 1000) + 1) * 1000) - (student?.xp || 0)
    };
}

// ─── Get Weak Chapters ─────────────────────────────────────────────────────
async function getWeakChapters(userId) {
    const results = await db.find('results', { userId });
    const chapterStats = {};

    results.data.forEach(result => {
        if (result.chapterWise) {
            Object.entries(result.chapterWise).forEach(([chapter, data]) => {
                if (!chapterStats[chapter]) {
                    chapterStats[chapter] = { total: 0, correct: 0 };
                }
                chapterStats[chapter].total += data.total || 0;
                chapterStats[chapter].correct += data.correct || 0;
            });
        }
    });

    return Object.entries(chapterStats)
        .map(([chapter, stats]) => ({
            chapter,
            accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
            total: stats.total
        }))
        .filter(item => item.accuracy < 60 && item.total > 5)
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 5);
}

// ─── Get Strong Chapters ──────────────────────────────────────────────────
async function getStrongChapters(userId) {
    const results = await db.find('results', { userId });
    const chapterStats = {};

    results.data.forEach(result => {
        if (result.chapterWise) {
            Object.entries(result.chapterWise).forEach(([chapter, data]) => {
                if (!chapterStats[chapter]) {
                    chapterStats[chapter] = { total: 0, correct: 0 };
                }
                chapterStats[chapter].total += data.total || 0;
                chapterStats[chapter].correct += data.correct || 0;
            });
        }
    });

    return Object.entries(chapterStats)
        .map(([chapter, stats]) => ({
            chapter,
            accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
            total: stats.total
        }))
        .filter(item => item.accuracy > 75 && item.total > 5)
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 5);
}

// ─── Get Recent Activity ───────────────────────────────────────────────────
async function getRecentActivity(userId) {
    const activities = [];

    // Get recent test completions
    const results = await db.find('results', { userId }, { sort: 'createdAt:desc', limit: 3 });
    results.data.forEach(r => {
        activities.push({
            type: 'test',
            text: `Completed <strong>${r.testName}</strong>`,
            time: r.createdAt,
            icon: 'fa-check-circle',
            color: 'green'
        });
    });

    // Get recent notes downloads
    const notes = await db.find('downloads', { userId, type: 'note' }, { sort: 'createdAt:desc', limit: 2 });
    notes.data.forEach(n => {
        activities.push({
            type: 'note',
            text: `Downloaded <strong>${n.name}</strong>`,
            time: n.createdAt,
            icon: 'fa-download',
            color: 'blue'
        });
    });

    // Get recent homework submissions
    const homework = await db.find('homework', { userId }, { sort: 'submittedAt:desc', limit: 2 });
    homework.data.forEach(h => {
        if (h.submittedAt) {
            activities.push({
                type: 'homework',
                text: `Submitted <strong>${h.title}</strong>`,
                time: h.submittedAt,
                icon: 'fa-upload',
                color: 'purple'
            });
        }
    });

    return activities.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);
}

// ─── Get AI Suggestions ────────────────────────────────────────────────────
async function getAISuggestions(userId) {
    const [weakAreas, stats, student] = await Promise.all([
        getWeakChapters(userId),
        getStudentStats(userId),
        db.findById('students', userId)
    ]);

    const suggestions = [];

    // Weak area suggestions
    if (weakAreas.length > 0) {
        const topWeak = weakAreas[0];
        suggestions.push({
            type: 'practice',
            title: `Focus on ${topWeak.chapter}`,
            desc: `Your accuracy in ${topWeak.chapter} is ${topWeak.accuracy.toFixed(1)}%. Practice more questions.`,
            icon: 'fa-exclamation-triangle',
            priority: 'high'
        });
    }

    // Study streak suggestion
    if (student?.streak && student.streak > 0) {
        suggestions.push({
            type: 'streak',
            title: `Keep Your ${student.streak}-Day Streak Going!`,
            desc: `You've been consistent for ${student.streak} days. Don't break the chain!`,
            icon: 'fa-fire',
            priority: 'medium'
        });
    }

    // Test suggestion
    if (stats.completedTests < 5) {
        suggestions.push({
            type: 'test',
            title: 'Take a Mock Test',
            desc: 'Complete more tests to improve your accuracy and confidence.',
            icon: 'fa-trophy',
            priority: 'high'
        });
    }

    // Revision suggestion
    suggestions.push({
        type: 'revision',
        title: 'Daily Revision',
        desc: 'Review your notes for 15 minutes today to reinforce learning.',
        icon: 'fa-sync-alt',
        priority: 'medium'
    });

    return suggestions;
}

// ─── Get Resume Test ──────────────────────────────────────────────────────
async function getResumeTest(userId) {
    const tests = await db.find('test_attempts', {
        userId,
        status: 'in_progress'
    }, { sort: 'startedAt:desc', limit: 1 });

    if (tests.data.length === 0) {
        return { hasTest: false };
    }

    const test = tests.data[0];
    const testDetail = await db.findById('tests', test.testId);

    return {
        hasTest: true,
        testId: test.testId,
        testName: testDetail?.name || 'Test',
        progress: test.progress || 0,
        remainingQuestions: test.remainingQuestions || 0,
        timeRemaining: test.timeRemaining || 0
    };
}

// ─── Get Daily Target ──────────────────────────────────────────────────────
async function getDailyTarget(userId) {
    const today = new Date().toDateString();
    const target = await db.findOne('daily_targets', {
        userId,
        date: today
    });

    if (target) {
        return {
            goal: target.goal,
            completed: target.completed,
            total: target.total,
            progress: Math.round((target.completed / target.total) * 100)
        };
    }

    // Default target
    const student = await db.findById('students', userId);
    const baseGoal = 50;
    const multiplier = student?.level ? Math.min(1 + (student.level / 10), 2) : 1;

    return {
        goal: `Practice ${Math.round(baseGoal * multiplier)} Questions`,
        completed: 0,
        total: Math.round(baseGoal * multiplier),
        progress: 0
    };
}

// ─── Get Leaderboard ──────────────────────────────────────────────────────
async function getLeaderboard(batchId) {
    const students = await db.find('students', { batch: batchId });
    const sorted = students.data
        .filter(s => s.xp)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0))
        .slice(0, 10)
        .map((s, index) => ({
            rank: index + 1,
            name: s.name,
            class: s.class,
            section: s.section,
            xp: s.xp || 0,
            coins: s.coins || 0,
            level: Math.floor((s.xp || 0) / 1000) + 1,
            streak: s.streak || 0
        }));

    return sorted;
}

// ─── Calculate Streak ──────────────────────────────────────────────────────
async function calculateStreak(userId) {
    const records = await db.find('attendance', {
        userId,
        status: 'present'
    }, { sort: 'date:desc' });

    let streak = 0;
    const today = new Date();
    let currentDate = new Date(today);
    currentDate.setHours(0, 0, 0, 0);

    for (const record of records.data) {
        const recordDate = new Date(record.date);
        recordDate.setHours(0, 0, 0, 0);
        
        const diffDays = Math.floor((currentDate - recordDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays === streak) {
            streak++;
        } else if (diffDays > streak) {
            break;
        }
    }

    return streak;
}

// ─── Export Analytics ──────────────────────────────────────────────────────
exports.getAnalytics = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { period = 'month' } = req.query;

    const [stats, weakChapters, strongChapters, performanceTrend] = await Promise.all([
        getStudentStats(userId),
        getWeakChapters(userId),
        getStrongChapters(userId),
        getPerformanceTrend(userId, period)
    ]);

    res.json({
        success: true,
        data: {
            stats,
            weakChapters,
            strongChapters,
            performanceTrend,
            recommendations: await getAISuggestions(userId)
        }
    });
});

// ─── Get Performance Trend ──────────────────────────────────────────────────
async function getPerformanceTrend(userId, period) {
    const results = await db.find('results', { userId }, { sort: 'createdAt:asc' });
    const data = results.data;

    if (data.length === 0) return [];

    let limit = period === 'week' ? 7 : period === 'month' ? 30 : data.length;
    const recent = data.slice(-limit);

    return recent.map(r => ({
        date: r.createdAt,
        score: Math.round((r.score / r.maxScore) * 100),
        testName: r.testName
    }));
}