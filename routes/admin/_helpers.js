// routes/admin/_helpers.js
//
// Small shared helpers used by more than one of the split admin route
// modules (routes/admin/*.js). Extracted out of routes/adminRoutes.js
// (refactor, 2026-07) — moved here instead of into a single route file
// specifically because more than one module needs it, and duplicating it
// would violate the project's own "avoid duplicate code" rule.
//
// Leading underscore in the filename is intentional: this isn't a route
// module itself (no router, nothing mounted), just shared logic for the
// files that are.

const db = require('../../services/jsonDb');

// Recomputes a test's totalMarks/totalQuestions from its actual attached
// (active) testQuestions — used by every mutation that adds/removes/replaces
// questions so the numbers shown to admins and students are always accurate,
// instead of relying on whatever was typed by hand when the test was created.
// Used by: routes/admin/test-questions.js, routes/admin/ai.js
function recalcTestTotals(testId) {
  const activeQuestions = db.find('testQuestions', { testId, isActive: true });
  const totalMarks = activeQuestions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
  return db.findByIdAndUpdate('tests', testId, {
    totalQuestions: activeQuestions.length,
    totalMarks,
    questions: activeQuestions.map(q => q._id),
  });
}

module.exports = { recalcTestTotals };