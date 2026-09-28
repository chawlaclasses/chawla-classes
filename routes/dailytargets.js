// routes/dailyTargets.js
"use strict";

const express = require('express');
const router = express.Router();
const dailyTargetController = require('../controllers/student/dailytargetcontroller');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

router.get('/today', dailyTargetController.getToday);
router.put('/today', dailyTargetController.updateToday);
router.get('/history', dailyTargetController.getHistory);

module.exports = router;