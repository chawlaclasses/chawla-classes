// routes/notifications.js
"use strict";

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/student/notificationController');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

// Get all notifications
router.get('/', 
    notificationController.getNotifications
);

// Get unread count
router.get('/unread-count', 
    notificationController.getUnreadCount
);

// Mark notification as read
router.post('/:notificationId/read', 
    notificationController.markRead
);

// Mark all as read
router.post('/mark-all-read', 
    notificationController.markAllRead
);

// Delete notification
router.delete('/:notificationId', 
    notificationController.deleteNotification
);

// Get notification stats
router.get('/stats', 
    notificationController.getStats
);

// Get a single notification by id.
// FIX (connections audit 2026-09): registered AFTER '/unread-count' and
// '/stats' above deliberately — Express matches routes in registration
// order, so a '/:notificationId' route placed earlier would have swallowed
// both of those literal paths (treating "stats"/"unread-count" as an id).
router.get('/:notificationId',
    notificationController.getNotificationById
);

module.exports = router;