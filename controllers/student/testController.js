const db = require('../../services/jsonDb');
const { AppError, asyncHandler } = require('../../utils/errorHandler');
const ResponseHandler = require('../../utils/response');

/**
 * Shuffle array helper
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Start a test
 */
const startTest = asyncHandler(async (req, res) => {
  const { testId } = req.body;
  const student = req.user;

  // Verify test is available
  const test = db.findById('tests', testId);
  if (!test || test.isDeleted || !test.isPublished) {
    throw new AppError("Test not found or not available", 404);
  }

  // Verify student's class
  if (test.classId !== student.classId) {
    throw new AppError("You don't have access to this test", 403);
  }

  // Check if test is available
  let isAvailable = true;
  if (test.isScheduled) {
    const now = new Date();
    isAvailable = now >= new Date(test.startDate) && now <= new Date(test.endDate);
  }
  if (!isAvailable) {
    throw new AppError("Test is not available at this time", 403);
  }

  // Check attempts
  const attempts = db.find('studentAttempts', {
    studentId: student.id,
    testId: test._id,
    isSubmitted: true
  });

  if (attempts.length >= test.maximumAttempts) {
    throw new AppError(`Maximum attempts (${test.maximumAttempts}) reached`, 403);
  }

  // Check for existing active attempt
  const existingAttempt = db.findOne('studentAttempts', {
    studentId: student.id,
    testId: test._id,
    isSubmitted: false
  });

  if (existingAttempt) {
    return ResponseHandler.success(res, {
      attempt: existingAttempt,
      isResumed: true
    }, "Resuming existing attempt");
  }

  // Get questions
  let questions = db.find('testQuestions', {
    testId: test._id,
    isActive: true
  });

  if (!questions || questions.length === 0) {
    throw new AppError("Test has no questions", 400);
  }

  // Randomize questions if enabled
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
    studentId: student.id,
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

  ResponseHandler.created(res, {
    attempt: newAttempt,
    questions: formattedQuestions,
    totalQuestions: formattedQuestions.length,
    duration: test.duration,
    totalMarks: test.totalMarks
  }, "Test started successfully");
});

/**
 * Save answer for a question
 */
const saveAnswer = asyncHandler(async (req, res) => {
  const { attemptId, questionId, selectedOption, timeSpent } = req.body;
  const student = req.user;

  // Verify attempt belongs to student
  const attempt = db.findOne('studentAttempts', {
    _id: attemptId,
    studentId: student.id,
    isSubmitted: false
  });

  if (!attempt) {
    throw new AppError("Attempt not found or already submitted", 404);
  }

  // Verify question belongs to test
  const question = db.findOne('testQuestions', {
    _id: questionId,
    testId: attempt.testId,
    isActive: true
  });

  if (!question) {
    throw new AppError("Question not found", 404);
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
    // Update existing answer
    attempt.answers[existingAnswerIndex] = answerData;
  } else {
    // Add new answer
    attempt.answers.push(answerData);
  }

  db.findByIdAndUpdate('studentAttempts', attemptId, {
    answers: attempt.answers
  });

  ResponseHandler.success(res, {
    saved: true,
    isCorrect,
    marksObtained
  }, "Answer saved successfully");
});

/**
 * Submit test
 */
const submitTest = asyncHandler(async (req, res) => {
  const { attemptId } = req.body;
  const student = req.user;

  // Verify attempt belongs to student
  const attempt = db.findOne('studentAttempts', {
    _id: attemptId,
    studentId: student.id,
    isSubmitted: false
  });

  if (!attempt) {
    throw new AppError("Attempt not found or already submitted", 404);
  }

  // Get test
  const test = db.findById('tests', attempt.testId);
  if (!test) {
    throw new AppError("Test not found", 404);
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

  // Create result document
  const result = db.insertOne('results', {
    studentId: student.id,
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

  ResponseHandler.success(res, {
    attemptId: attempt._id,
    resultId: result._id,
    marksObtained: totalMarksObtained,
    totalMarks: test.totalMarks,
    percentage: Math.round(percentage * 100) / 100,
    isPassed: isPassed,
    correctAnswers: correctAnswers,
    incorrectAnswers: incorrectAnswers,
    unansweredQuestions: unansweredQuestions
  }, "Test submitted successfully");
});

/**
 * Get ongoing test questions
 */
const getTestQuestions = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const student = req.user;

  const attempt = db.findOne('studentAttempts', {
    _id: attemptId,
    studentId: student.id,
    isSubmitted: false
  });

  if (!attempt) {
    throw new AppError("Attempt not found or already submitted", 404);
  }

  const test = db.findById('tests', attempt.testId);
  if (!test) {
    throw new AppError("Test not found", 404);
  }

  // Get questions
  let questions = db.find('testQuestions', {
    testId: test._id,
    isActive: true
  });

  if (!questions || questions.length === 0) {
    throw new AppError("No questions found", 404);
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

  ResponseHandler.success(res, {
    questions: formattedQuestions,
    totalQuestions: formattedQuestions.length,
    remainingTime: remainingTime,
    elapsedTime: elapsedTime
  }, "Questions retrieved successfully");
});

module.exports = {
  startTest,
  saveAnswer,
  submitTest,
  getTestQuestions
};