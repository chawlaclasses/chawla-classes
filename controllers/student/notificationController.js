// controllers/student/notificationController.js
"use strict";

const notificationService = require('../../services/notifications');
const { asyncHandler } = require('../../utils/errorHandler');
const { AppError } = require('../../utils/errorHandler');

exports.getNotifications = asyncHandler(async (req, res) => {
    const { read, type, limit = 50 } = req.query;

    const notifications = await notificationService.getNotifications(req.user.id, {
        read: read === 'true' ? true : read === 'false' ? false : undefined,
        type,
        limit: parseInt(limit)
    });

    res.json({
        success: true,
        data: notifications
    });
});

exports.getUnreadCount = asyncHandler(async (req, res) => {
    const count = await notificationService.getUnreadCount(req.user.id);
    
    res.json({
        success: true,
        data: { count }
    });
});

// FIX (connections audit 2026-09): was missing entirely — see the
// matching FIX note in services/notifications.js#getById.
exports.getNotificationById = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await notificationService.getById(notificationId, req.user.id);

    res.json({
        success: true,
        data: notification
    });
});

exports.markRead = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await notificationService.markRead(
        notificationId,
        req.user.id
    );

    res.json({
        success: true,
        data: notification
    });
});

exports.markAllRead = asyncHandler(async (req, res) => {
    const count = await notificationService.markAllRead(req.user.id);
    
    res.json({
        success: true,
        data: { count },
        message: `Marked ${count} notifications as read`
    });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    await notificationService.deleteNotification(notificationId, req.user.id);

    res.json({
        success: true,
        message: 'Notification deleted'
    });
});

exports.getStats = asyncHandler(async (req, res) => {
    const stats = await notificationService.getStats(req.user.id);
    
    res.json({
        success: true,
        data: stats
    });
});
