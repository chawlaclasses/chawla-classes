// controllers/student/reportController.js
"use strict";

const studentReportService = require('../../services/studentReport');
const { asyncHandler } = require('../../utils/errorHandler');
const { sendPdf, sendCsv } = require('../../utils/reportGenerator');

exports.getMyReport = asyncHandler(async (req, res) => {
    const { format = 'json' } = req.query;
    const studentId = req.user.id;

    if (format === 'pdf') {
        const buffer = await studentReportService.toPdfBuffer(studentId);
        return sendPdf(res, buffer, 'student-report.pdf');
    }

    if (format === 'csv' || format === 'excel') {
        const csv = await studentReportService.toCsv(studentId);
        return sendCsv(res, csv, 'student-report.csv');
    }

    const data = await studentReportService.getReportData(studentId);
    res.json({ success: true, data });
});