// services/notifications.js
"use strict";

const db = require('./jsonDb');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class NotificationService {
    constructor() {
        this.collection = 'notifications';
    }

    async createNotification(userId, type, title, message, data = null) {
        const notification = {
            id: uuidv4(),
            userId,
            type,
            title,
            message,
            data,
            read: false,
            createdAt: new Date().toISOString(),
            readAt: null
        };

        await db.insert(this.collection, notification);

        return notification;
    }

    async getNotifications(userId, filters = {}) {
        const query = { userId };
        
        if (filters.read !== undefined) {
            query.read = filters.read;
        }
        
        if (filters.type) {
            query.type = filters.type;
        }

        const notifications = await db.find(this.collection, query, {
            sort: 'createdAt:desc',
            limit: filters.limit || 50
        });

        return notifications;
    }

    async markRead(notificationId, userId) {
        const notification = await db.findOne(this.collection, {
            id: notificationId,
            userId
        });

        if (!notification) throw new Error('Notification not found');

        notification.read = true;
        notification.readAt = new Date().toISOString();
        await db.updateById(this.collection, notificationId, notification);

        return notification;
    }

    async markAllRead(userId) {
        const notifications = await db.find(this.collection, {
            userId,
            read: false
        });

        for (const notification of notifications) {
            notification.read = true;
            notification.readAt = new Date().toISOString();
            await db.updateById(this.collection, notification.id, notification);
        }

        return notifications.length;
    }

    async deleteNotification(notificationId, userId) {
        const notification = await db.findOne(this.collection, {
            id: notificationId,
            userId
        });

        if (!notification) throw new Error('Notification not found');

        await db.deleteById(this.collection, notificationId);
        return true;
    }

    async getUnreadCount(userId) {
        const notifications = await db.find(this.collection, {
            userId,
            read: false
        });
        return notifications.length;
    }

    // Notification types
    async sendTestReminder(studentId, testName, testDate) {
        return this.createNotification(
            studentId,
            'test_reminder',
            `Upcoming Test: ${testName}`,
            `Your ${testName} is scheduled for ${testDate}`,
            { testName, testDate }
        );
    }

    async sendResultNotification(studentId, testName, score) {
        return this.createNotification(
            studentId,
            'result',
            `Results Available: ${testName}`,
            `You scored ${score}% in ${testName}`,
            { testName, score }
        );
    }

    async sendHomeworkReminder(studentId, homeworkTitle, dueDate) {
        return this.createNotification(
            studentId,
            'homework',
            `Homework Due: ${homeworkTitle}`,
            `Your homework "${homeworkTitle}" is due on ${dueDate}`,
            { homeworkTitle, dueDate }
        );
    }

    async sendAnnouncement(studentId, title, message, data = null) {
        return this.createNotification(
            studentId,
            'announcement',
            title,
            message,
            data
        );
    }

    async sendAttendanceAlert(studentId, message) {
        return this.createNotification(
            studentId,
            'attendance',
            'Attendance Alert',
            message,
            { type: 'attendance_alert' }
        );
    }

    async sendFeeReminder(studentId, amount, dueDate) {
        return this.createNotification(
            studentId,
            'fee',
            'Fee Payment Reminder',
            `Fee of ₹${amount} is due on ${dueDate}`,
            { amount, dueDate }
        );
    }

    async sendAchievementNotification(studentId, achievementTitle) {
        return this.createNotification(
            studentId,
            'achievement',
            `Achievement Unlocked! 🎉`,
            `You've earned "${achievementTitle}"`,
            { achievement: achievementTitle }
        );
    }

    async sendPracticeReminder(studentId, subject) {
        return this.createNotification(
            studentId,
            'practice',
            'Practice Reminder',
            `Time to practice ${subject}! Keep your streak going.`,
            { subject }
        );
    }

    // Bulk notifications
    async sendBulkNotifications(userIds, type, title, message, data = null) {
        const notifications = [];
        for (const userId of userIds) {
            const notification = await this.createNotification(
                userId,
                type,
                title,
                message,
                data
            );
            notifications.push(notification);
        }
        return notifications;
    }

    // Send to all students in a class
    async sendClassAnnouncement(classId, title, message, data = null) {
        const students = await db.find('students', { class: classId });
        return this.sendBulkNotifications(
            students.map(s => s.id),
            'announcement',
            title,
            message,
            data
        );
    }

    // Send to all students in a batch
    async sendBatchAnnouncement(batchId, title, message, data = null) {
        const students = await db.find('students', { batch: batchId });
        return this.sendBulkNotifications(
            students.map(s => s.id),
            'announcement',
            title,
            message,
            data
        );
    }

    // Cleanup old notifications
    async cleanupOldNotifications(days = 30) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        cutoff.setHours(0, 0, 0, 0);

        const notifications = await db.find(this.collection, {
            read: true,
            createdAt: { $lt: cutoff.toISOString() }
        });

        for (const notification of notifications) {
            await db.deleteById(this.collection, notification.id);
        }

        return notifications.length;
    }

    // Get notification statistics
    async getStats(userId) {
        const all = await db.find(this.collection, { userId });
        const unread = all.filter(n => !n.read);
        const byType = {};
        
        all.forEach(n => {
            byType[n.type] = (byType[n.type] || 0) + 1;
        });

        return {
            total: all.length,
            unread: unread.length,
            byType,
            lastWeek: all.filter(n => {
                const date = new Date(n.createdAt);
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                return date > weekAgo;
            }).length
        };
    }
}

module.exports = new NotificationService();