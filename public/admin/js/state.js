// public/admin/js/state.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// STATE
// ============================================================
let currentSection = 'dashboard';
let currentData = [];
let modalCallback = null;
let editingId = null;
window._subjects = [];
window._series = [];
window._tests = [];
window._classes = [];

// ── BULK SELECTION STATE ──
let selectedQuestionIds = new Set();
let allQuestions = [];

