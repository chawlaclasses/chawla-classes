const express = require('express');
const router = express.Router();
const { requireApiStudent } = require('../middleware/apiAuth');
const db = require('../services/jsonDb');
const logger = require('../utils/logger');
const path = require('path');
const { uploadHomeworkSubmission, homeworkMimeGuard, HOMEWORK_SUBMISSIONS_DIR, uploadDoubtAttachment, doubtMimeGuard, DOUBTS_DIR } = require('../middleware/upload');
const { streamFeeReceipt } = require('../utils/feeReceipt');
const { feeWithComputed } = require('../services/feeCalc');
const { cleanupFile } = require('../utils/helpers');

const gamificationService = require('../services/gamification');
const aiController = require('../controllers/student/aiController');
// FIX (audit 2026-07): wiring in the previously-unused validation layer —
// see routes/adminRoutes.js for the full explanation.
const { validate } = require('../middleware/validation');
const validators = require('../utils/validators');

// ============================================================
// Student Dashboard
// ============================================================
router.get('/dashboard', requireApiStudent, async (req, res) => {
    try {
        const student = req.userData;
        
        if (!student.classId) {
            return res.status(400).json({
                success: false,
                message: 'Student not assigned to any class'
            });
        }
        
        // Get class details
        const classData = db.findById('classes', student.classId);
        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }
        
        // Get subjects for this class
        const subjects = db.find('subjects', { classId: student.classId, isActive: true });
        
        // Get student's results
        const results = db.find('results', { studentId: student._id });
        const completedTestIds = new Set(results.map(r => r.testId));
        
        // Calculate statistics
        const totalTests = results.length;
        let averageScore = 0;
        let bestScore = 0;
        let passedTests = 0;
        
        if (results.length > 0) {
            const percentages = results.map(r => r.percentage || 0);
            averageScore = percentages.reduce((a, b) => a + b, 0) / percentages.length;
            bestScore = Math.max(...percentages);
            passedTests = results.filter(r => r.isPassed).length;
        }
        
        // Recent activity
        const recentActivity = results
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map(r => {
                const test = db.findById('tests', r.testId);
                return {
                    testName: test ? test.title : 'Unknown Test',
                    percentage: r.percentage || 0,
                    isPassed: r.isPassed || false,
                    date: r.createdAt
                };
            });

        // FIX: the dashboard.html frontend expects `data.stats` (with
        // totalTests/completedTests/avgScore/bestScore/rank/attendance/
        // streak/level/xp/coins) and `data.upcomingTests`, but this endpoint
        // only ever returned `data.statistics` (a differently-shaped object)
        // and no upcomingTests at all. The frontend was crashing on
        // `undefined.totalTests` and silently falling into its generic
        // "Server error" message. We now compute and return both shapes:
        // `statistics` (existing, in case anything else reads it) and the
        // `stats`/`upcomingTests` the UI actually consumes, built from real
        // data rather than placeholders.
        const classTests = db.find('tests', { classId: student.classId, isPublished: true, isDeleted: false });
        const totalAvailableTests = classTests.length;

        const upcomingTests = classTests
            .filter(t => !completedTestIds.has(t._id))
            .slice(0, 5)
            .map(t => {
                const subject = db.findById('subjects', t.subjectId);
                return {
                    _id: t._id,
                    name: t.title,
                    date: t.startDate ? new Date(t.startDate).toLocaleDateString() : 'Available now',
                    time: subject ? subject.name : ''
                };
            });

        let attendancePercent = null;
        const attendanceRecords = db.find('attendance', { email: student.email });
        if (attendanceRecords.length > 0) {
            const presentCount = attendanceRecords.filter(a => (a.status || '').toLowerCase() === 'present').length;
            attendancePercent = Math.round((presentCount / attendanceRecords.length) * 100);
        }

        let gamification = { xp: 0, coins: 0, level: 1, streak: 0, rank: null };
        try {
            gamification = await gamificationService.getGamificationData(student._id);
        } catch (gErr) {
            // Gamification is a bonus layer — if it fails for any reason,
            // still return the rest of the dashboard rather than erroring out.
        }
        
        res.json({
            success: true,
            data: {
                student: {
                    name: student.name,
                    email: student.email,
                    class: classData.displayName || classData.name
                },
                subjects: subjects || [],
                statistics: {
                    completedTests: totalTests,
                    averageScore: Math.round(averageScore * 100) / 100,
                    bestScore: Math.round(bestScore * 100) / 100,
                    passedTests: passedTests
                },
                stats: {
                    totalTests: totalAvailableTests,
                    completedTests: totalTests,
                    avgScore: Math.round(averageScore),
                    bestScore: Math.round(bestScore),
                    rank: gamification.rank || null,
                    attendance: attendancePercent,
                    streak: gamification.streak || 0,
                    level: (gamification.level && gamification.level.level) || 1,
                    levelTitle: (gamification.level && gamification.level.title) || 'Beginner',
                    xp: gamification.xp || 0,
                    coins: gamification.coins || 0
                },
                upcomingTests,
                recentActivity: recentActivity
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading dashboard'
        });
    }
});

// ============================================================
// Login History / Device History (self-service — a student can only ever
// see their own entries, never anyone else's)
// ============================================================
router.get('/login-history', requireApiStudent, (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const logs = db.find('login-history', { userId: req.userData._id })
            .slice()
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, parseInt(limit, 10) || 20);
        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to load login history'
        });
    }
});

// ============================================================
// Get subjects for student
// ============================================================
router.get('/subjects', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        
        if (!student.classId) {
            return res.status(400).json({
                success: false,
                message: 'Student not assigned to any class'
            });
        }
        
        const subjects = db.find('subjects', { classId: student.classId, isActive: true });
        
        res.json({
            success: true,
            data: subjects
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again.'
        });
    }
});

// ============================================================
// Get series for a subject
// ============================================================
router.get('/subjects/:subjectId/series', requireApiStudent, (req, res) => {
    try {
        const { subjectId } = req.params;
        const student = req.userData;
        
        // Verify subject belongs to student's class
        const subject = db.findOne('subjects', { _id: subjectId, classId: student.classId });
        if (!subject) {
            return res.status(404).json({
                success: false,
                message: 'Subject not found or not accessible'
            });
        }
        
        const series = db.find('series', { subjectId, isActive: true });
        
        res.json({
            success: true,
            data: series
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again.'
        });
    }
});

// ============================================================
// Get tests for a series
// ============================================================
router.get('/series/:seriesId/tests', requireApiStudent, (req, res) => {
    try {
        const { seriesId } = req.params;
        const student = req.userData;
        
        // Verify series belongs to student's class
        const series = db.findOne('series', { _id: seriesId, classId: student.classId });
        if (!series) {
            return res.status(404).json({
                success: false,
                message: 'Series not found or not accessible'
            });
        }
        
        const tests = db.find('tests', { seriesId, isPublished: true, isDeleted: false });
        
        // Add attempt status
        const testsWithStatus = tests.map(test => {
            const attempts = db.find('studentAttempts', {
                studentId: student._id,
                testId: test._id
            });
            
            const completedAttempts = attempts.filter(a => a.isSubmitted).length;
            const activeAttempt = attempts.find(a => !a.isSubmitted && !a.isCompleted);
            
            // Check if test is available
            let canAttempt = completedAttempts < test.maximumAttempts;
            if (test.isScheduled) {
                const now = new Date();
                canAttempt = canAttempt && now >= new Date(test.startDate) && now <= new Date(test.endDate);
            }
            
            return {
                ...test,
                attemptsMade: completedAttempts,
                remainingAttempts: Math.max(0, test.maximumAttempts - completedAttempts),
                canAttempt: canAttempt,
                hasActiveAttempt: !!activeAttempt,
                activeAttemptId: activeAttempt ? activeAttempt._id : null
            };
        });
        
        res.json({
            success: true,
            data: testsWithStatus
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again.'
        });
    }
});

// ============================================================
// Get test details
// ============================================================
router.get('/tests/:testId/details', requireApiStudent, (req, res) => {
    try {
        const { testId } = req.params;
        const student = req.userData;
        
        const test = db.findById('tests', testId);
        if (!test || !test.isPublished || test.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'Test not found or not available'
            });
        }
        
        // Verify student's class
        if (test.classId !== student.classId) {
            return res.status(403).json({
                success: false,
                message: 'You don\'t have access to this test'
            });
        }
        
        // Check if test is available
        let isAvailable = true;
        if (test.isScheduled) {
            const now = new Date();
            isAvailable = now >= new Date(test.startDate) && now <= new Date(test.endDate);
        }
        if (!isAvailable) {
            return res.status(403).json({
                success: false,
                message: 'Test is not available at this time'
            });
        }
        
        // Check attempts
        const attempts = db.find('studentAttempts', {
            studentId: student._id,
            testId: test._id,
            isSubmitted: true
        });
        
        if (attempts.length >= test.maximumAttempts) {
            return res.status(403).json({
                success: false,
                message: `Maximum attempts (${test.maximumAttempts}) reached`
            });
        }
        
        // Check active attempt
        const activeAttempt = db.findOne('studentAttempts', {
            studentId: student._id,
            testId: test._id,
            isSubmitted: false
        });
        
        res.json({
            success: true,
            data: {
                test: {
                    _id: test._id,
                    title: test.title,
                    description: test.description,
                    totalMarks: test.totalMarks,
                    duration: test.duration,
                    totalQuestions: test.totalQuestions,
                    negativeMarking: test.negativeMarking
                },
                hasActiveAttempt: !!activeAttempt,
                activeAttemptId: activeAttempt ? activeAttempt._id : null,
                attemptsMade: attempts.length,
                remainingAttempts: test.maximumAttempts - attempts.length
            }
        });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({
            success: false,
            message: 'Something went wrong. Please try again.'
        });
    }
});
// ============================================================
// Student Test Routes
// ============================================================

// Start a test
router.post('/tests/start', requireApiStudent, validators.startTest, validate, async (req, res) => {
    try {
        const { testId } = req.body;
        const student = req.userData;
        
        if (!testId) {
            return res.status(400).json({
                success: false,
                message: 'Test ID is required'
            });
        }
        
        // Get test
        const test = db.findById('tests', testId);
        if (!test || !test.isPublished || test.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'Test not found or not available'
            });
        }
        
        // Verify student's class
        if (test.classId !== student.classId) {
            return res.status(403).json({
                success: false,
                message: 'You don\'t have access to this test'
            });
        }
        
        // Check if test is available
        let isAvailable = true;
        if (test.isScheduled) {
            const now = new Date();
            isAvailable = now >= new Date(test.startDate) && now <= new Date(test.endDate);
        }
        if (!isAvailable) {
            return res.status(403).json({
                success: false,
                message: 'Test is not available at this time'
            });
        }
        
        // Check attempts
        const attempts = db.find('studentAttempts', {
            studentId: student._id,
            testId: test._id,
            isSubmitted: true
        });
        
        if (attempts.length >= test.maximumAttempts) {
            return res.status(403).json({
                success: false,
                message: `Maximum attempts (${test.maximumAttempts}) reached`
            });
        }
        
        // Check for existing active attempt
        const existingAttempt = db.findOne('studentAttempts', {
            studentId: student._id,
            testId: test._id,
            isSubmitted: false
        });
        
        if (existingAttempt) {
            return res.json({
                success: true,
                data: {
                    attempt: existingAttempt,
                    isResumed: true
                },
                message: 'Resuming existing attempt'
            });
        }
        
        // Get questions
        let questions = db.find('testQuestions', {
            testId: test._id,
            isActive: true
        });
        
        if (!questions || questions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Test has no questions'
            });
        }
        
        // Shuffle questions if enabled
        if (test.randomizeQuestions) {
            questions = shuffleArray(questions);
        }
        
        // Randomize options if enabled
        if (test.randomizeOptions) {
            questions = questions.map(q => {
                const options = [...q.options];
                return {
                    ...q,
                    options: shuffleArray(options)
                };
            });
        }
        
        // Create attempt
        const newAttempt = db.insertOne('studentAttempts', {
            studentId: student._id,
            testId: test._id,
            attemptNumber: attempts.length + 1,
            startTime: new Date().toISOString(),
            remainingTime: test.duration * 60,
            isCompleted: false,
            isSubmitted: false,
            answers: []
        });
        
        // Format questions for response (hide correct answers)
        const formattedQuestions = questions.map(q => ({
            _id: q._id,
            questionText: q.questionText,
            options: q.options.map(opt => ({
                text: opt.text
            })),
            type: q.type,
            marks: q.marks,
            order: q.order
        }));
        
        res.status(201).json({
            success: true,
            data: {
                attempt: newAttempt,
                questions: formattedQuestions,
                totalQuestions: formattedQuestions.length,
                duration: test.duration,
                totalMarks: test.totalMarks
            },
            message: 'Test started successfully'
        });
        
    } catch (error) {
        console.error('Start test error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start test'
        });
    }
});

// ============================================================
// Save answer
// ============================================================
router.post('/tests/save-answer', requireApiStudent, validators.saveAnswer, validate, async (req, res) => {
    try {
        const { attemptId, questionId, selectedOption, timeSpent } = req.body;
        const student = req.userData;
        
        // Verify attempt belongs to student
        const attempt = db.findOne('studentAttempts', {
            _id: attemptId,
            studentId: student._id,
            isSubmitted: false
        });
        
        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }
        
        // Verify question belongs to test
        const question = db.findOne('testQuestions', {
            _id: questionId,
            testId: attempt.testId,
            isActive: true
        });
        
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        // Find or create answer entry
        const existingAnswerIndex = attempt.answers.findIndex(
            a => a.questionId === questionId
        );
        
        const isCorrect = selectedOption === question.correctAnswer;
        const marksObtained = isCorrect ? question.marks : 0;
        
        const answerData = {
            questionId,
            selectedOption,
            isCorrect,
            marksObtained,
            timeSpent: timeSpent || 0
        };
        
        if (existingAnswerIndex !== -1) {
            attempt.answers[existingAnswerIndex] = answerData;
        } else {
            attempt.answers.push(answerData);
        }
        
        db.findByIdAndUpdate('studentAttempts', attemptId, {
            answers: attempt.answers
        });
        
        res.json({
            success: true,
            data: {
                saved: true,
                isCorrect,
                marksObtained
            },
            message: 'Answer saved successfully'
        });
        
    } catch (error) {
        console.error('Save answer error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save answer'
        });
    }
});

// ============================================================
// Submit test
// ============================================================
router.post('/tests/submit', requireApiStudent, validators.submitTest, validate, async (req, res) => {
    try {
        const { attemptId } = req.body;
        const student = req.userData;
        
        // Verify attempt belongs to student
        const attempt = db.findOne('studentAttempts', {
            _id: attemptId,
            studentId: student._id,
            isSubmitted: false
        });
        
        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }
        
        // Get test
        const test = db.findById('tests', attempt.testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }
        
        // Get all questions for this test
        const questions = db.find('testQuestions', {
            testId: test._id,
            isActive: true
        });
        
        // Calculate results
        let totalMarksObtained = 0;
        let correctAnswers = 0;
        let incorrectAnswers = 0;
        let unansweredQuestions = 0;
        const questionWiseAnalysis = [];
        
        questions.forEach(question => {
            const studentAnswer = attempt.answers.find(
                a => a.questionId === question._id
            );
            
            if (studentAnswer) {
                if (studentAnswer.isCorrect) {
                    totalMarksObtained += question.marks;
                    correctAnswers++;
                } else {
                    incorrectAnswers++;
                    if (test.negativeMarking && test.negativeMarking.enabled) {
                        totalMarksObtained -= test.negativeMarking.value;
                    }
                }
            } else {
                unansweredQuestions++;
            }
            
            questionWiseAnalysis.push({
                questionId: question._id,
                isCorrect: studentAnswer ? studentAnswer.isCorrect : false,
                selectedOption: studentAnswer ? studentAnswer.selectedOption : null,
                correctAnswer: question.correctAnswer,
                marksObtained: studentAnswer ? studentAnswer.marksObtained : 0,
                timeSpent: studentAnswer ? studentAnswer.timeSpent : 0
            });
        });
        
        // Ensure marks don't go below 0
        totalMarksObtained = Math.max(0, totalMarksObtained);
        
        const percentage = (totalMarksObtained / test.totalMarks) * 100;
        const isPassed = percentage >= test.passingMarks;
        
        const endTime = new Date().toISOString();
        
        // Update attempt
        db.findByIdAndUpdate('studentAttempts', attemptId, {
            isCompleted: true,
            isSubmitted: true,
            endTime: endTime,
            totalMarksObtained: totalMarksObtained,
            correctAnswers: correctAnswers,
            incorrectAnswers: incorrectAnswers,
            unansweredQuestions: unansweredQuestions,
            percentage: Math.round(percentage * 100) / 100,
            isPassed: isPassed
        });
        
        // Create result
        const result = db.insertOne('results', {
            studentId: student._id,
            testId: test._id,
            attemptId: attempt._id,
            totalMarks: test.totalMarks,
            marksObtained: totalMarksObtained,
            percentage: Math.round(percentage * 100) / 100,
            isPassed: isPassed,
            timeTaken: Math.floor((new Date(endTime) - new Date(attempt.startTime)) / 1000),
            correctAnswers: correctAnswers,
            incorrectAnswers: incorrectAnswers,
            unansweredQuestions: unansweredQuestions,
            questionWiseAnalysis: questionWiseAnalysis,
            isDownloaded: false
        });
        
        // Calculate rank
        const allResults = db.find('results', { testId: test._id, isPassed: true });
        const sortedResults = allResults.sort((a, b) => {
            if (b.percentage !== a.percentage) return b.percentage - a.percentage;
            if (b.marksObtained !== a.marksObtained) return b.marksObtained - a.marksObtained;
            return a.timeTaken - b.timeTaken;
        });
        
        const rank = sortedResults.findIndex(r => r._id === result._id) + 1;
        if (rank > 0) {
            db.findByIdAndUpdate('results', result._id, {
                rank: rank,
                totalStudents: sortedResults.length
            });
        }
        
        res.json({
            success: true,
            data: {
                attemptId: attempt._id,
                resultId: result._id,
                marksObtained: totalMarksObtained,
                totalMarks: test.totalMarks,
                percentage: Math.round(percentage * 100) / 100,
                isPassed: isPassed,
                correctAnswers: correctAnswers,
                incorrectAnswers: incorrectAnswers,
                unansweredQuestions: unansweredQuestions
            },
            message: 'Test submitted successfully'
        });
        
    } catch (error) {
        console.error('Submit test error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit test'
        });
    }
});

// ============================================================
// Get test questions (for resuming)
// ============================================================
router.get('/attempts/:attemptId/questions', requireApiStudent, async (req, res) => {
    try {
        const { attemptId } = req.params;
        const student = req.userData;
        
        const attempt = db.findOne('studentAttempts', {
            _id: attemptId,
            studentId: student._id,
            isSubmitted: false
        });
        
        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }
        
        const test = db.findById('tests', attempt.testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }
        
        // Get questions
        let questions = db.find('testQuestions', {
            testId: test._id,
            isActive: true
        });
        
        if (!questions || questions.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No questions found'
            });
        }
        
        // Randomize options if enabled
        if (test.randomizeOptions) {
            questions = questions.map(q => {
                const options = [...q.options];
                return {
                    ...q,
                    options: shuffleArray(options)
                };
            });
        }
        
        // Format questions and include student's answers
        const formattedQuestions = questions.map(q => {
            const studentAnswer = attempt.answers.find(
                a => a.questionId === q._id
            );
            
            return {
                _id: q._id,
                questionText: q.questionText,
                options: q.options.map(opt => ({
                    text: opt.text
                })),
                type: q.type,
                marks: q.marks,
                order: q.order,
                selectedOption: studentAnswer ? studentAnswer.selectedOption : null,
                isAnswered: !!studentAnswer
            };
        });
        
        // Calculate elapsed time
        const elapsedTime = Math.floor((Date.now() - new Date(attempt.startTime).getTime()) / 1000);
        const remainingTime = Math.max(0, attempt.remainingTime - elapsedTime);
        
        res.json({
            success: true,
            data: {
                questions: formattedQuestions,
                totalQuestions: formattedQuestions.length,
                remainingTime: remainingTime,
                elapsedTime: elapsedTime
            },
            message: 'Questions retrieved successfully'
        });
        
    } catch (error) {
        console.error('Get questions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get questions'
        });
    }
});

// ============================================================
// Helper function to shuffle array
// ============================================================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}
// ============================================================
// Student Results Routes
// ============================================================

// Get student's results
router.get('/results', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        
        const results = db.find('results', { studentId: student._id });
        
        // Sort by date (newest first)
        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Populate test details
        const populatedResults = results.map(r => {
            const test = db.findById('tests', r.testId);
            return {
                ...r,
                testId: test ? {
                    _id: test._id,
                    title: test.title,
                    totalMarks: test.totalMarks
                } : null
            };
        });
        
        res.json({
            success: true,
            data: populatedResults
        });
    } catch (error) {
        console.error('Get results error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get results'
        });
    }
});

// Get result by ID
router.get('/results/:resultId', requireApiStudent, (req, res) => {
    try {
        const { resultId } = req.params;
        const student = req.userData;
        
        const result = db.findById('results', resultId);
        if (!result || result.studentId !== student._id) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }
        
        // Populate test details
        const test = db.findById('tests', result.testId);
        const studentData = db.findById('users', result.studentId);
        
        const populatedResult = {
            ...result,
            testId: test ? {
                _id: test._id,
                title: test.title,
                totalMarks: test.totalMarks,
                duration: test.duration,
                passingMarks: test.passingMarks,
                negativeMarking: test.negativeMarking
            } : null,
            studentId: studentData ? {
                _id: studentData._id,
                name: studentData.name,
                email: studentData.email
            } : null
        };
        
        res.json({
            success: true,
            data: populatedResult
        });
    } catch (error) {
        console.error('Get result error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get result'
        });
    }
});

// Get result analysis
router.get('/results/:resultId/analysis', requireApiStudent, (req, res) => {
    try {
        const { resultId } = req.params;
        const student = req.userData;
        
        const result = db.findById('results', resultId);
        if (!result || result.studentId !== student._id) {
            return res.status(404).json({
                success: false,
                message: 'Result not found'
            });
        }
        
        // Get question details for analysis
        const questionIds = result.questionWiseAnalysis.map(q => q.questionId);
        const questions = db.find('testQuestions', { _id: { $in: questionIds } });
        
        // Map questions to analysis
        const detailedAnalysis = result.questionWiseAnalysis.map(analysis => {
            const question = questions.find(q => q._id === analysis.questionId);
            return {
                questionText: question ? question.questionText : 'Question not found',
                type: question ? question.type : 'mcq',
                options: question ? question.options : [],
                selectedOption: analysis.selectedOption,
                correctAnswer: analysis.correctAnswer,
                isCorrect: analysis.isCorrect,
                marksObtained: analysis.marksObtained,
                timeSpent: analysis.timeSpent
            };
        });
        
        const test = db.findById('tests', result.testId);
        
        const analysisData = {
            result: {
                _id: result._id,
                totalMarks: result.totalMarks,
                marksObtained: result.marksObtained,
                percentage: result.percentage,
                isPassed: result.isPassed,
                rank: result.rank,
                totalStudents: result.totalStudents,
                timeTaken: result.timeTaken,
                correctAnswers: result.correctAnswers,
                incorrectAnswers: result.incorrectAnswers,
                unansweredQuestions: result.unansweredQuestions
            },
            questions: detailedAnalysis,
            test: test ? {
                _id: test._id,
                title: test.title,
                duration: test.duration,
                passingMarks: test.passingMarks
            } : null
        };
        
        res.json({
            success: true,
            data: analysisData
        });
    } catch (error) {
        console.error('Get analysis error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get analysis'
        });
    }
});

// Get rank for a specific test
router.get('/tests/:testId/rank', requireApiStudent, (req, res) => {
    try {
        const { testId } = req.params;
        const student = req.userData;
        
        const result = db.findOne('results', {
            testId,
            studentId: student._id
        });
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Result not found for this test'
            });
        }
        
        // Get rank distribution
        const allResults = db.find('results', { testId: result.testId });
        const rankDistribution = {};
        allResults.forEach(r => {
            const rank = r.rank || 0;
            rankDistribution[rank] = (rankDistribution[rank] || 0) + 1;
        });
        
        res.json({
            success: true,
            data: {
                rank: result.rank,
                totalStudents: result.totalStudents,
                percentage: result.percentage,
                marksObtained: result.marksObtained,
                isPassed: result.isPassed,
                rankDistribution: Object.entries(rankDistribution).map(([rank, count]) => ({ rank: parseInt(rank), count }))
            }
        });
    } catch (error) {
        console.error('Get rank error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get rank'
        });
    }
});

// Get performance summary
router.get('/performance/summary', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        
        const results = db.find('results', { studentId: student._id });
        
        if (results.length === 0) {
            return res.json({
                success: true,
                data: {
                    totalTests: 0,
                    averagePercentage: 0,
                    passRate: 0,
                    bestScore: 0,
                    subjectPerformance: [],
                    recentPerformance: []
                }
            });
        }
        
        // Calculate overall statistics
        const totalTests = results.length;
        const passedTests = results.filter(r => r.isPassed).length;
        const averagePercentage = results.reduce((sum, r) => sum + (r.percentage || 0), 0) / totalTests;
        const bestScore = Math.max(...results.map(r => r.percentage || 0));
        
        // Subject-wise performance
        const subjectPerformance = {};
        results.forEach(result => {
            const test = db.findById('tests', result.testId);
            const subject = test ? db.findById('subjects', test.subjectId) : null;
            const subjectName = subject ? subject.name : 'Unknown';
            
            if (!subjectPerformance[subjectName]) {
                subjectPerformance[subjectName] = {
                    subject: subjectName,
                    tests: 0,
                    totalPercentage: 0,
                    passed: 0
                };
            }
            subjectPerformance[subjectName].tests++;
            subjectPerformance[subjectName].totalPercentage += (result.percentage || 0);
            if (result.isPassed) subjectPerformance[subjectName].passed++;
        });
        
        const subjectPerformanceArray = Object.values(subjectPerformance).map(sp => ({
            ...sp,
            averagePercentage: Math.round((sp.totalPercentage / sp.tests) * 100) / 100,
            passRate: Math.round((sp.passed / sp.tests) * 100)
        }));
        
        // Recent performance (last 5)
        const recentPerformance = results
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map(r => {
                const test = db.findById('tests', r.testId);
                return {
                    testName: test ? test.title : 'Unknown Test',
                    percentage: r.percentage,
                    isPassed: r.isPassed,
                    date: r.createdAt
                };
            });
        
        res.json({
            success: true,
            data: {
                totalTests,
                averagePercentage: Math.round(averagePercentage * 100) / 100,
                passRate: Math.round((passedTests / totalTests) * 100),
                bestScore: Math.round(bestScore * 100) / 100,
                subjectPerformance: subjectPerformanceArray,
                recentPerformance
            }
        });
    } catch (error) {
        console.error('Get performance summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get performance summary'
        });
    }
});

// Get leaderboard for a test
router.get('/tests/:testId/leaderboard', requireApiStudent, (req, res) => {
    try {
        const { testId } = req.params;
        const { limit = 10 } = req.query;
        
        const test = db.findById('tests', testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }
        
        const allResults = db.find('results', { testId, isPassed: true });
        const leaderboard = allResults
            .sort((a, b) => {
                if (b.percentage !== a.percentage) return b.percentage - a.percentage;
                if (b.marksObtained !== a.marksObtained) return b.marksObtained - a.marksObtained;
                return a.timeTaken - b.timeTaken;
            })
            .slice(0, parseInt(limit))
            .map(r => {
                const student = db.findById('users', r.studentId);
                return {
                    studentId: r.studentId,
                    name: student ? student.name : 'Unknown',
                    marksObtained: r.marksObtained,
                    percentage: r.percentage,
                    rank: r.rank,
                    timeTaken: r.timeTaken
                };
            });
        
        const studentResult = db.findOne('results', {
            testId,
            studentId: req.userData._id
        });
        
        res.json({
            success: true,
            data: {
                leaderboard,
                studentRank: studentResult ? studentResult.rank : null,
                totalParticipants: allResults.length
            }
        });
    } catch (error) {
        console.error('Get leaderboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get leaderboard'
        });
    }
});
// ============================================================
// Homework Module (Student)
// ============================================================

function homeworkForStudent(hw, studentId) {
    const submission = db.findOne('homeworkSubmissions', { homeworkId: hw._id, studentId });
    const isOverdue = !submission && new Date() > new Date(hw.dueDate);
    return {
        ...hw,
        submission,
        submissionStatus: submission ? submission.status : (isOverdue ? 'overdue' : 'pending'),
    };
}

// List published homework for the student's class
router.get('/homework', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        if (!student.classId) {
            return res.status(400).json({ success: false, message: 'Student not assigned to any class' });
        }

        const homework = db.find('homework', { classId: student.classId, isPublished: true, isActive: true })
            .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
            .map(hw => homeworkForStudent(hw, student._id));

        res.json({ success: true, data: homework });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Single homework detail, with the student's own submission if any
router.get('/homework/:id', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const homework = db.findById('homework', req.params.id);
        if (!homework || homework.classId !== student.classId || !homework.isPublished || !homework.isActive) {
            return res.status(404).json({ success: false, message: 'Homework not found' });
        }
        res.json({ success: true, data: homeworkForStudent(homework, student._id) });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Upload/replace a submission — blocked once the submission has been graded,
// so a student can't quietly swap files out from under a marked grade.
router.post('/homework/:id/submit', uploadHomeworkSubmission.single('file'), homeworkMimeGuard, requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const homework = db.findById('homework', req.params.id);
        if (!homework || homework.classId !== student.classId || !homework.isPublished || !homework.isActive) {
            if (req.file) cleanupFile(req.file.path);
            return res.status(404).json({ success: false, message: 'Homework not found' });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const existing = db.findOne('homeworkSubmissions', { homeworkId: homework._id, studentId: student._id });
        if (existing && existing.status === 'graded') {
            cleanupFile(req.file.path);
            return res.status(400).json({ success: false, message: 'This submission has already been graded and can no longer be replaced' });
        }

        const isLate = new Date() > new Date(homework.dueDate);

        let saved;
        if (existing) {
            // Replacing an ungraded submission — remove the old file first.
            cleanupFile(path.join(HOMEWORK_SUBMISSIONS_DIR, existing.filename));
            saved = db.findByIdAndUpdate('homeworkSubmissions', existing._id, {
                filename: req.file.filename,
                originalName: req.file.originalname,
                submittedAt: new Date().toISOString(),
                isLate,
                status: 'submitted',
            });
        } else {
            saved = db.insertOne('homeworkSubmissions', {
                homeworkId: homework._id,
                studentId: student._id,
                filename: req.file.filename,
                originalName: req.file.originalname,
                submittedAt: new Date().toISOString(),
                isLate,
                status: 'submitted',
                marksAwarded: null,
                teacherRemarks: null,
                gradedBy: null,
                gradedAt: null,
            });
        }

        res.json({ success: true, data: saved, message: isLate ? 'Submitted (after the due date)' : 'Submitted successfully' });
    } catch (error) {
        if (req.file) cleanupFile(req.file.path);
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Submission history — every homework the student has ever submitted,
// newest first, regardless of whether it's since been graded.
router.get('/homework/submissions/history', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const submissions = db.find('homeworkSubmissions', { studentId: student._id })
            .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
            .map(sub => {
                const homework = db.findById('homework', sub.homeworkId);
                return {
                    ...sub,
                    homeworkTitle: homework ? homework.title : 'Deleted homework',
                    homeworkMarks: homework ? homework.marks : null,
                    homeworkDueDate: homework ? homework.dueDate : null,
                };
            });

        res.json({ success: true, data: submissions });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Download the student's own previously submitted file
router.get('/homework/submissions/:submissionId/download', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const submission = db.findById('homeworkSubmissions', req.params.submissionId);
        if (!submission || submission.studentId !== student._id) {
            return res.status(404).json({ success: false, message: 'Submission not found' });
        }
        const filePath = path.join(HOMEWORK_SUBMISSIONS_DIR, submission.filename);
        res.download(filePath, submission.originalName);
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// Doubt Management (Student)
// ============================================================

// Ask a doubt — question text plus an optional image and/or voice note
router.post('/doubts',
    uploadDoubtAttachment.fields([{ name: 'image', maxCount: 1 }, { name: 'voiceNote', maxCount: 1 }]),
    doubtMimeGuard,
    requireApiStudent,
    (req, res) => {
        try {
            const student = req.userData;
            const { questionText, subjectId } = req.body;
            const files = req.files || {};

            if (!questionText || !questionText.trim()) {
                for (const list of Object.values(files)) { for (const f of list) cleanupFile(f.path); }
                return res.status(400).json({ success: false, message: 'Please describe your doubt' });
            }

            const image = files.image?.[0];
            const voiceNote = files.voiceNote?.[0];

            const doubt = db.insertOne('doubts', {
                studentId: student._id,
                classId: student.classId || null,
                subjectId: subjectId || null,
                questionText: questionText.trim(),
                imageFilename: image ? image.filename : null,
                imageOriginalName: image ? image.originalname : null,
                voiceNoteFilename: voiceNote ? voiceNote.filename : null,
                voiceNoteOriginalName: voiceNote ? voiceNote.originalname : null,
                status: 'open',
                priority: 'medium',
                isActive: true,
            });

            res.status(201).json({ success: true, data: doubt, message: 'Your doubt has been submitted' });
        } catch (error) {
            logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
            res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
        }
    }
);

// List the student's own doubts, newest first
router.get('/doubts', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const doubts = db.find('doubts', { studentId: student._id })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, data: doubts });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Single doubt + the admin's reply thread — ownership-checked
router.get('/doubts/:id', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const doubt = db.findById('doubts', req.params.id);
        if (!doubt || doubt.studentId !== student._id) {
            return res.status(404).json({ success: false, message: 'Doubt not found' });
        }
        const replies = db.find('doubtReplies', { doubtId: doubt._id }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        res.json({ success: true, data: { doubt, replies } });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Stream the student's own doubt image/voice note
router.get('/doubts/:id/image', requireApiStudent, (req, res) => {
    const student = req.userData;
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt || doubt.studentId !== student._id || !doubt.imageFilename) {
        return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.sendFile(path.join(DOUBTS_DIR, doubt.imageFilename));
});

router.get('/doubts/:id/voice', requireApiStudent, (req, res) => {
    const student = req.userData;
    const doubt = db.findById('doubts', req.params.id);
    if (!doubt || doubt.studentId !== student._id || !doubt.voiceNoteFilename) {
        return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.sendFile(path.join(DOUBTS_DIR, doubt.voiceNoteFilename));
});

// ============================================================
// My Fees (Student)
// ============================================================

// List the student's own fee records, newest first
router.get('/fees', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const fees = db.find('fees-v2', { studentId: student._id })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(feeWithComputed);
        res.json({ success: true, data: fees });
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// Download the student's own paid-fee receipt
router.get('/fees/:id/receipt', requireApiStudent, (req, res) => {
    try {
        const student = req.userData;
        const fee = db.findById('fees-v2', req.params.id);
        if (!fee || fee.studentId !== student._id) {
            return res.status(404).json({ success: false, message: 'Fee record not found' });
        }
        if (fee.status !== 'Paid') {
            return res.status(400).json({ success: false, message: 'Receipt is only available once the fee is paid' });
        }
        const cls = student.classId ? db.findById('classes', student.classId) : null;
        streamFeeReceipt(feeWithComputed(fee), { ...student, className: cls ? (cls.displayName || cls.name) : null }, res);
    } catch (error) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
});

// ============================================================
// AI Insights (daily goal, recommendations, predictions)
// FIX: controllers/student/aiController.js already had all of this
// logic implemented, it just had no routes pointing at it — every
// call from dashboard.html/js/api/ai.js was 404ing.
// ============================================================
router.get('/ai/suggestions', aiController.getSuggestions);
router.get('/ai/planner', aiController.getStudyPlanner);
router.get('/ai/revision', aiController.getRevisionPlan);
router.get('/ai/weak-areas', aiController.getWeakAreas);
router.get('/ai/strong-areas', aiController.getStrongAreas);
router.get('/ai/practice-recommendations', aiController.getPracticeRecommendations);
router.get('/ai/daily-goal', aiController.getDailyGoal);
router.get('/ai/learning-path', aiController.getLearningPath);
router.get('/ai/chapter-analysis/:subject', aiController.getChapterAnalysis);
router.get('/ai/predict-performance', aiController.predictPerformance);
router.get('/ai/weak-topic-recommendations', aiController.getWeakTopicRecommendations);

module.exports = router;