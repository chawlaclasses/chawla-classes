// routes/revision.js
"use strict";

const express = require('express');
const router = express.Router();
const revisionController = require('../controllers/student/revisioncontroller');
const { requireApiStudent } = require('../middleware/apiAuth');

router.use(requireApiStudent);

router.get('/queue', revisionController.getQueue);

module.exports = router;