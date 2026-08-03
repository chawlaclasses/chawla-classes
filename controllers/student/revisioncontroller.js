// controllers/student/revisionController.js
"use strict";

const revisionService = require('../../services/revision');
const { asyncHandler } = require('../../utils/errorHandler');

exports.getQueue = asyncHandler(async (req, res) => {
    const { limit = 20 } = req.query;
    const queue = await revisionService.getQueue(req.user.id, parseInt(limit));

    res.json({
        success: true,
        data: queue
    });
});