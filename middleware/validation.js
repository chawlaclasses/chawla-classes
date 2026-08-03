"use strict";

const { validationResult, body, param, query } = require("express-validator");

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  const extractedErrors = errors.array().map(err => ({
    field: err.path,
    message: err.msg
  }));

  return res.status(400).json({
    success: false,
    message: "Validation failed",
    errors: extractedErrors
  });
};

// Common validation rules
const validators = {
  // Object ID validation (for JSON IDs)
  validateObjectId: (paramName) => {
    return param(paramName)
      .notEmpty()
      .withMessage(`${paramName} is required`)
      .isLength({ min: 5 })
      .withMessage(`Invalid ${paramName} format`);
  },

  // Pagination validation
  validatePagination: () => {
    return [
      query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer")
        .toInt(),
      query("limit")
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage("Limit must be between 1 and 100")
        .toInt()
    ];
  },

  // Search validation
  validateSearch: () => {
    return [
      query("search")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Search term cannot exceed 100 characters")
    ];
  },

  // Class validators
  createClass: [
    body("name")
      .trim()
      .notEmpty().withMessage("Class name is required")
      .isLength({ min: 2, max: 50 }).withMessage("Class name must be between 2 and 50 characters"),
    body("displayName")
      .trim()
      .notEmpty().withMessage("Display name is required")
      .isLength({ min: 2, max: 50 }).withMessage("Display name must be between 2 and 50 characters"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters")
  ],

  // Subject validators
  createSubject: [
    body("name")
      .trim()
      .notEmpty().withMessage("Subject name is required")
      .isLength({ min: 2, max: 100 }).withMessage("Subject name must be between 2 and 100 characters"),
    body("code")
      .trim()
      .notEmpty().withMessage("Subject code is required")
      .isLength({ min: 2, max: 10 }).withMessage("Subject code must be between 2 and 10 characters")
      .matches(/^[A-Z0-9]+$/).withMessage("Subject code must contain only uppercase letters and numbers"),
    body("classId")
      .notEmpty().withMessage("Class ID is required"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters")
  ],

  // Series validators
  createSeries: [
    body("name")
      .trim()
      .notEmpty().withMessage("Series name is required")
      .isLength({ min: 2, max: 100 }).withMessage("Series name must be between 2 and 100 characters"),
    body("subjectId")
      .notEmpty().withMessage("Subject ID is required"),
    body("classId")
      .notEmpty().withMessage("Class ID is required"),
    body("type")
      .optional()
      .isIn(["chapter-wise", "weekly", "revision", "mock", "sample-paper", "other"])
      .withMessage("Invalid series type"),
    body("description")
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage("Description cannot exceed 500 characters")
  ],

  // Test validators
  createTest: [
    body("title")
      .trim()
      .notEmpty().withMessage("Test title is required")
      .isLength({ min: 3, max: 200 }).withMessage("Test title must be between 3 and 200 characters"),
    body("seriesId")
      .notEmpty().withMessage("Series ID is required"),
    body("subjectId")
      .notEmpty().withMessage("Subject ID is required"),
    body("classId")
      .notEmpty().withMessage("Class ID is required"),
    body("totalMarks")
      .isInt({ min: 1 }).withMessage("Total marks must be a positive integer"),
    body("passingMarks")
      .isInt({ min: 0 }).withMessage("Passing marks must be a non-negative integer")
      .custom((value, { req }) => {
        if (value > req.body.totalMarks) {
          throw new Error("Passing marks cannot exceed total marks");
        }
        return true;
      }),
    body("duration")
      .isInt({ min: 1 }).withMessage("Duration must be a positive integer"),
    body("negativeMarking")
      .optional()
      .isObject().withMessage("Negative marking must be an object"),
    body("negativeMarking.enabled")
      .optional()
      .isBoolean().withMessage("Negative marking enabled must be a boolean"),
    body("negativeMarking.value")
      .optional()
      .isFloat({ min: 0 }).withMessage("Negative marking value must be a non-negative number"),
    body("maximumAttempts")
      .optional()
      .isInt({ min: 1 }).withMessage("Maximum attempts must be at least 1"),
    body("randomizeQuestions")
      .optional()
      .isBoolean().withMessage("Randomize questions must be a boolean"),
    body("randomizeOptions")
      .optional()
      .isBoolean().withMessage("Randomize options must be a boolean")
  ],

  // Question validators
  createQuestion: [
    body("questionText")
      .trim()
      .notEmpty().withMessage("Question text is required"),
    body("options")
      .isArray({ min: 2 }).withMessage("At least 2 options are required")
      .custom((options) => {
        const hasCorrect = options.some(opt => opt.isCorrect);
        if (!hasCorrect) {
          throw new Error("At least one correct option must be specified");
        }
        return true;
      }),
    body("options.*.text")
      .trim()
      .notEmpty().withMessage("Option text is required"),
    body("options.*.isCorrect")
      .isBoolean().withMessage("isCorrect must be a boolean"),
    body("correctAnswer")
      .trim()
      .notEmpty().withMessage("Correct answer is required"),
    body("marks")
      .isFloat({ min: 0 }).withMessage("Marks must be a non-negative number"),
    body("type")
      .optional()
      .isIn(["mcq", "true-false", "fill-in-blank"])
      .withMessage("Invalid question type"),
    body("explanation")
      .optional()
      .trim()
      .isLength({ max: 500 }).withMessage("Explanation cannot exceed 500 characters")
  ],

  // Student attempt validators
  startTest: [
    body("testId")
      .notEmpty().withMessage("Test ID is required")
  ],

  saveAnswer: [
    body("attemptId")
      .notEmpty().withMessage("Attempt ID is required"),
    body("questionId")
      .notEmpty().withMessage("Question ID is required"),
    body("selectedOption")
      .optional()
      .trim(),
    body("timeSpent")
      .optional()
      .isInt({ min: 0 }).withMessage("Time spent must be a non-negative integer")
  ],

  submitTest: [
    body("attemptId")
      .notEmpty().withMessage("Attempt ID is required")
  ]
};

module.exports = {
  validate,
  validators,
  body,
  param,
  query
};