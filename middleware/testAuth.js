"use strict";

const { verifyToken, extractToken } = require("../services/auth");
const db = require("../services/jsonDb");

// ── Shared helpers ────────────────────────────────────────────────────────────

function getPayload(req) {
  try {
    return verifyToken(extractToken(req)) || null;
  } catch (_) {
    return null;
  }
}

function unauthorized(res, msg = "Unauthorized") {
  return res.status(401).json({ success: false, message: msg });
}

function forbidden(res, msg = "Forbidden") {
  return res.status(403).json({ success: false, message: msg });
}

/**
 * Middleware to verify student has access to their class tests
 */
const requireStudentClassAccess = async (req, res, next) => {
  try {
    const payload = req.tokenPayload;
    if (!payload) {
      return unauthorized(res);
    }

    // Get student's class from JSON DB
    const user = db.findById("users", payload.id);
    if (!user || !user.classId) {
      return res.status(403).json({
        success: false,
        message: "Student class not found"
      });
    }

    // Check if requested class matches student's class
    const requestedClassId = req.params.classId || req.body.classId || req.query.classId;
    
    if (requestedClassId) {
      if (requestedClassId !== user.classId) {
        return res.status(403).json({
          success: false,
          message: "Access denied: You can only access your class tests"
        });
      }
    }

    // Attach student class to request for downstream use
    const classData = db.findById("classes", user.classId);
    req.studentClass = classData;
    req.studentId = user._id;
    
    next();
  } catch (error) {
    console.error("Class access check error:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking class access"
    });
  }
};

/**
 * Middleware to verify test availability for student
 */
const requireTestAccess = async (req, res, next) => {
  try {
    const testId = req.params.testId || req.body.testId || req.query.testId;
    
    if (!testId) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required"
      });
    }

    const test = db.findById("tests", testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found"
      });
    }

    // Get class and subject info
    const classData = db.findById("classes", test.classId);
    const subjectData = db.findById("subjects", test.subjectId);
    const seriesData = db.findById("series", test.seriesId);

    // Check if test is published
    if (!test.isPublished) {
      return res.status(403).json({
        success: false,
        message: "This test is not available yet"
      });
    }

    // Check if test is within schedule
    if (test.isScheduled) {
      const now = new Date();
      if (now < new Date(test.startDate)) {
        return res.status(403).json({
          success: false,
          message: `Test will be available on ${new Date(test.startDate).toLocaleDateString()}`
        });
      }
      if (now > new Date(test.endDate)) {
        return res.status(403).json({
          success: false,
          message: "Test has expired"
        });
      }
    }

    // Verify student belongs to the class
    const user = db.findById("users", req.studentId || req.tokenPayload.id);
    if (!user || user.classId !== test.classId) {
      return res.status(403).json({
        success: false,
        message: "You don't have access to this test"
      });
    }

    req.test = test;
    req.test.classData = classData;
    req.test.subjectData = subjectData;
    req.test.seriesData = seriesData;
    next();
  } catch (error) {
    console.error("Test access check error:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking test access"
    });
  }
};

/**
 * Middleware to verify test attempt limits
 */
const requireAttemptAllowed = async (req, res, next) => {
  try {
    const test = req.test;
    const studentId = req.studentId || req.tokenPayload.id;
    
    if (!test || !studentId) {
      return res.status(400).json({
        success: false,
        message: "Test and student information required"
      });
    }

    const completedAttempts = db.find("studentAttempts", {
      studentId,
      testId: test._id,
      isSubmitted: true
    });

    if (completedAttempts.length >= test.maximumAttempts) {
      return res.status(403).json({
        success: false,
        message: `You have reached the maximum attempts (${test.maximumAttempts}) for this test`
      });
    }

    req.remainingAttempts = test.maximumAttempts - completedAttempts.length;
    next();
  } catch (error) {
    console.error("Attempt check error:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking attempt limits"
    });
  }
};

module.exports = {
  requireStudentClassAccess,
  requireTestAccess,
  requireAttemptAllowed
};