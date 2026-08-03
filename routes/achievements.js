// routes/achievements.js
"use strict";

const express = require('express');
const router = express.Router();
const achievementController = require('../controllers/student/achievementcontroller');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

// XP / coins / level / streak / rank summary
router.get('/summary', achievementController.getSummary);

// Full badge catalog (locked + unlocked)
router.get('/catalog', achievementController.getCatalog);

// Class-scoped XP leaderboard
router.get('/leaderboard', achievementController.getLeaderboard);

// Daily check-in reward
router.get('/daily-reward', achievementController.getDailyReward);
router.post('/daily-reward/claim', achievementController.claimDailyReward);

module.exports = router;