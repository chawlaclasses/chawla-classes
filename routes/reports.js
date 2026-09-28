// routes/reports.js
"use strict";

const express = require('express');
const router = express.Router();
const reportController = require('../controllers/student/reportController');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

router.get('/my-report', reportController.getMyReport);

module.exports = router;