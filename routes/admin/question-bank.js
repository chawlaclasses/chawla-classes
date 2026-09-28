// routes/admin/question-bank.js
//
// Question Bank management — CRUD, the review workflow (draft → review →
// approved → published, see config/questionWorkflow.js), change history,
// and bulk operations. Extracted out of routes/adminRoutes.js (refactor,
// 2026-07). Mounted at '/questions' by routes/adminRoutes.js, so the final
// URLs (/api/admin/questions, /api/admin/questions/:id, etc.) are
// unchanged.
//
// Reorganization note: in the original file, these routes were split
// across three places with no consistent grouping — most were crammed
// into the "Doubt Management" section with no separating banner comment,
// while bulk-update and bulk-delete each sat under their own small banner
// elsewhere in the file. They're all genuinely the same domain (the
// question bank), so this refactor consolidates them into one file.

const express = require('express');
const router = express.Router();

const db = require('../../services/jsonDb');
const logger = require('../../utils/logger');
const { logAudit } = require('../../utils/auditLog');
const { requirePermission } = require('../../middleware/permissions');
const { validate } = require('../../middleware/validation');
const validators = require('../../utils/validators');
const { recordQuestionHistory, getQuestionHistory } = require('../../utils/questionHistory');
const { getAllowedTransition, getAvailableTransitions, STATUS_LABELS } = require('../../config/questionWorkflow');
const { hasPermission, isClassAllowedForUser, isSubjectAllowedForUser } = require('../../config/permissions');
const { callClaudeJSON, isConfigured: isAiConfigured } = require('../../utils/llm');
const { jaccardSimilarity } = require('../../utils/textSimilarity');

// Ordering used by ?sortBy=difficulty — lower first (easy -> hard).
const DIFFICULTY_ORDER = { easy: 1, medium: 2, hard: 3 };

const QUESTION_SORTERS = {
  newest:     (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  oldest:     (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  difficulty: (a, b) => (DIFFICULTY_ORDER[a.difficulty] || 2) - (DIFFICULTY_ORDER[b.difficulty] || 2),
  marks:      (a, b) => (Number(b.marks) || 0) - (Number(a.marks) || 0),
};

// Get all questions from question bank
//
// Smart Search additions (2026-07): q / difficulty / type / marks / sortBy /
// page / limit are all NEW optional query params, each a no-op when absent.
// A caller that only ever sent {chapter, isActive, status, subjectId,
// classId} — every existing caller, today — gets exactly the same response
// shape and content as before. Pagination in particular only activates when
// `page` is explicitly present, so unpaginated callers keep getting the
// full array they always have.
router.get('/', requirePermission('questions:view'), (req, res) => {
  try {
    const { chapter, isActive, status, subjectId, classId, q, difficulty, type, marks, sortBy, page, limit, topic, subTopic, book, generatedByAI } = req.query;

    let query = {};
    if (chapter) query.chapter = chapter;
    // FIX: when the caller doesn't explicitly ask for a specific isActive
    // value, default to active-only. Previously an absent `isActive` param
    // meant "no filter at all", so soft-deleted questions (isActive:false,
    // set by DELETE /:id below) kept showing up in this list — a delete
    // would report success but the question never actually disappeared,
    // since the admin UI's loadQuestions() never sends an isActive param.
    query.isActive = isActive !== undefined ? isActive === 'true' : true;
    if (status) query.status = status;
    if (classId) query.classId = classId;
    if (difficulty) query.difficulty = difficulty;
    if (type) query.type = type;
    if (topic) query.topic = topic;
    if (subTopic) query.subTopic = subTopic;
    if (book) query.book = book;
    if (generatedByAI !== undefined) query.generatedByAI = generatedByAI === 'true';

    let questions = db.find('questions', query);

    // subjectId supports the real subject _id, or the sentinel 'unassigned'
    // to find questions that were never tagged with a subject (e.g.
    // everything created before subject-tagging existed) — handled as a
    // JS filter rather than a query key since jsonDb's exact-match query
    // has no clean "field is missing" operator.
    if (subjectId === 'unassigned') {
      questions = questions.filter(q => !q.subjectId);
    } else if (subjectId) {
      questions = questions.filter(q => q.subjectId === subjectId);
    }

    if (marks !== undefined && marks !== '') {
      const m = Number(marks);
      if (!Number.isNaN(m)) questions = questions.filter(qq => Number(qq.marks) === m);
    }

    // Scope to the caller's assigned classes/subjects if they have either
    // set (teachers via Staff Management). Everyone else sees everything.
    // Deliberately after subjectId/marks filters, before the search text
    // filter, so totalMatched below reflects what this user can actually
    // see (and search analytics logging doesn't count hits they can't).
    questions = questions.filter(qq => isClassAllowedForUser(req.userData, qq.classId) && isSubjectAllowedForUser(req.userData, qq.subjectId));

    // Free-text search — checks question text, options, answer, explanation,
    // chapter and tags (if present), plus an exact ID match. Substring/
    // case-insensitive, same spirit as the "Question, ID, Keyword, Formula,
    // Option, Tag" search box in the spec.
    if (q && q.trim()) {
      const needle = q.trim().toLowerCase();
      questions = questions.filter(qq => {
        if (String(qq._id).toLowerCase() === needle) return true;
        const haystack = [
          qq.questionText,
          qq.explanation,
          qq.chapter,
          qq.correctAnswer,
          ...(Array.isArray(qq.options) ? qq.options : []),
          ...(Array.isArray(qq.tags) ? qq.tags : []),
        ].filter(Boolean).join(' \u241f ').toLowerCase();
        return haystack.includes(needle);
      });
    }

    const totalMatched = questions.length;

    // Log the search for Search Analytics (top keywords, zero-result
    // queries). Only when there's an actual text query — filter-only
    // requests (chapter/difficulty with no q) aren't "searches" in the
    // sense an admin would want to see analyzed. Fire-and-forget: never
    // let logging failure affect the actual search response.
    if (q && q.trim()) {
      try {
        db.insertOne('search-logs', {
          query: q.trim(),
          resultCount: totalMatched,
          createdBy: req.user?.id || 'admin',
        });
      } catch (_) { /* analytics logging is best-effort */ }
    }

    if (sortBy && QUESTION_SORTERS[sortBy]) {
      questions = [...questions].sort(QUESTION_SORTERS[sortBy]);
    }

    let pagination = null;
    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.max(1, Math.min(200, parseInt(limit, 10) || 20));
      const start = (pageNum - 1) * pageSize;
      pagination = { page: pageNum, limit: pageSize, total: totalMatched, pages: Math.max(1, Math.ceil(totalMatched / pageSize)) };
      questions = questions.slice(start, start + pageSize);
    }

    questions = questions.map(q => ({
      ...q,
      availableTransitions: getAvailableTransitions(q.status || 'draft')
        .filter(t => hasPermission(req.userData.role, t.permission))
    }));

    res.json({
      success: true,
      data: questions,
      total: totalMatched,
      ...(pagination ? { pagination } : {})
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Autocomplete suggestions for the Smart Search box — matching question
// snippets and chapter names, capped at 8, computed on demand (no separate
// search index; the in-memory array scan is fast enough at current volumes
// and this is a NEW endpoint so it can't regress anything existing).
// Registered before '/:id' for the same reason as '/stats/by-subject' below.
// Saved Searches — lets an admin name and re-run a filter combination
// they use often (e.g. "Class 9 MCQs", "Board PYQs") instead of
// re-picking Class/Chapter/Type/Difficulty every time. Scoped per admin
// (createdBy) since different teachers have different regular searches.
router.get('/saved-searches', requirePermission('questions:view'), (req, res) => {
  try {
    const searches = db.find('saved-searches', { createdBy: req.user?.id || 'admin' })
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: searches });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/saved-searches', requirePermission('questions:view'), (req, res) => {
  try {
    const { name, filters } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'A name is required to save this search' });
    }
    if (!filters || typeof filters !== 'object') {
      return res.status(400).json({ success: false, message: 'No filters to save' });
    }
    const saved = db.insertOne('saved-searches', {
      name: name.trim(),
      filters,
      usageCount: 0,
      createdBy: req.user?.id || 'admin',
    });
    res.status(201).json({ success: true, data: saved });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Bumps a saved search's usage counter — called (fire-and-forget) whenever
// the admin applies a saved search, so Search Analytics can show which
// ones are actually relied on day to day.
router.post('/saved-searches/:id/use', requirePermission('questions:view'), (req, res) => {
  try {
    const search = db.findById('saved-searches', req.params.id);
    if (!search) {
      return res.status(404).json({ success: false, message: 'Saved search not found' });
    }
    db.findByIdAndUpdate('saved-searches', req.params.id, { usageCount: (search.usageCount || 0) + 1 });
    res.json({ success: true });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Search Analytics — top searched keywords, searches that returned zero
// results (a content-gap signal: teachers looking for something the bank
// doesn't have), and the most-used saved searches. Built from search-logs
// (written by GET / above) and saved-searches.usageCount.
router.get('/search-analytics', requirePermission('questions:view'), (req, res) => {
  try {
    const logs = db.find('search-logs', {});

    const byQuery = new Map();
    for (const log of logs) {
      const key = (log.query || '').trim().toLowerCase();
      if (!key) continue;
      if (!byQuery.has(key)) byQuery.set(key, { query: log.query.trim(), count: 0, zeroResultCount: 0 });
      const entry = byQuery.get(key);
      entry.count++;
      if (log.resultCount === 0) entry.zeroResultCount++;
    }

    const topKeywords = Array.from(byQuery.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const zeroResultSearches = Array.from(byQuery.values())
      .filter(e => e.zeroResultCount > 0)
      .sort((a, b) => b.zeroResultCount - a.zeroResultCount)
      .slice(0, 15);

    const savedSearches = db.find('saved-searches', { createdBy: req.user?.id || 'admin' })
      .slice()
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .slice(0, 10)
      .map(s => ({ name: s.name, usageCount: s.usageCount || 0 }));

    res.json({
      success: true,
      data: {
        totalSearches: logs.length,
        topKeywords,
        zeroResultSearches,
        savedSearches,
      }
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.delete('/saved-searches/:id', requirePermission('questions:view'), (req, res) => {
  try {
    const search = db.findById('saved-searches', req.params.id);
    if (!search || search.createdBy !== (req.user?.id || 'admin')) {
      return res.status(404).json({ success: false, message: 'Saved search not found' });
    }
    db.deleteById('saved-searches', req.params.id);
    res.json({ success: true, message: 'Saved search removed' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

router.get('/search/suggestions', requirePermission('questions:view'), (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const questions = db.find('questions', {}).filter(x => x.isActive !== false);
    const seen = new Set();
    const suggestions = [];

    for (const question of questions) {
      if (suggestions.length >= 8) break;
      const text = question.questionText || '';
      if (text.toLowerCase().includes(q) && !seen.has(text)) {
        seen.add(text);
        suggestions.push({
          type: 'question',
          id: question._id,
          label: text.length > 70 ? `${text.slice(0, 70)}…` : text
        });
      }
    }

    if (suggestions.length < 8) {
      const chapters = [...new Set(questions.map(x => (x.chapter || '').trim()).filter(Boolean))];
      for (const ch of chapters) {
        if (suggestions.length >= 8) break;
        if (ch.toLowerCase().includes(q) && !seen.has(ch)) {
          seen.add(ch);
          suggestions.push({ type: 'chapter', label: ch });
        }
      }
    }

    res.json({ success: true, data: suggestions });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Subject-wise breakdown of the question bank — one row per active subject
// (even subjects with zero questions, so gaps are visible) plus an
// "unassigned" count for questions never tagged with a subject. Powers the
// quick-filter chips in the Question Bank UI.
// NOTE: must be registered before GET '/:id' below, for the same reason as
// PUT '/bulk-approve' above — otherwise Express would match this path as
// an :id lookup and 404.
router.get('/stats/by-subject', requirePermission('questions:view'), (req, res) => {
  try {
    const questions = db.find('questions', {}).filter(q => q.isActive !== false);
    const subjects = db.find('subjects', { isActive: true });
    const classes = db.find('classes', {});
    const classById = new Map(classes.map(c => [c._id, c]));

    const bySubject = new Map();
    let unassigned = 0;
    for (const q of questions) {
      if (!q.subjectId) { unassigned++; continue; }
      if (!bySubject.has(q.subjectId)) bySubject.set(q.subjectId, { total: 0, byStatus: {} });
      const entry = bySubject.get(q.subjectId);
      entry.total++;
      const st = q.status || 'draft';
      entry.byStatus[st] = (entry.byStatus[st] || 0) + 1;
    }

    const data = subjects.map(s => {
      const cls = classById.get(s.classId);
      const entry = bySubject.get(s._id) || { total: 0, byStatus: {} };
      return {
        subjectId: s._id,
        subjectName: s.name,
        classId: s.classId || null,
        className: cls ? (cls.displayName || cls.name) : 'N/A',
        total: entry.total,
        byStatus: entry.byStatus
      };
    }).sort((a, b) => `${a.className} ${a.subjectName}`.localeCompare(`${b.className} ${b.subjectName}`));

    res.json({ success: true, data: { subjects: data, unassigned } });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// AI Natural-Language Search — translates a free-text query like "show
// easy polynomial questions" or "board questions from Chapter 5" into the
// SAME structured filters GET '/' already understands (q, chapter,
// subjectId, classId, difficulty, type, marks, sortBy). Deliberately does
// NOT run the search itself — it only returns the interpreted filters, so
// the actual query execution always goes through the one, already-tested
// filter/sort/paginate code path in GET '/' above. That also lets the UI
// show the admin what the AI understood and let them tweak it before
// running the search.
router.post('/search/ai-interpret', requirePermission('questions:view'), async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, message: 'Query is required' });
    }

    if (!isAiConfigured()) {
      return res.status(503).json({ success: false, message: 'AI search is not configured (GEMINI_API_KEY missing). Falling back to plain text search.' });
    }

    // Only let the AI pick chapter/subject/class values that actually
    // exist — an AI-guessed chapter name that doesn't match anything in
    // the bank would silently return zero results. Anything it can't
    // confidently map to a real value should stay in free-text `q` instead.
    const activeQuestions = db.find('questions', {}).filter(x => x.isActive !== false);
    const chapters = [...new Set(activeQuestions.map(x => (x.chapter || '').trim()).filter(Boolean))].slice(0, 300);
    const subjects = db.find('subjects', { isActive: true }).map(s => ({ id: s._id, name: s.name, classId: s.classId }));
    const classes = db.find('classes', {}).map(c => ({ id: c._id, name: c.displayName || c.name }));

    const system = `You convert a teacher's natural-language question-bank search into strict JSON filters.
Respond with ONLY a JSON object, no markdown fences, no explanation, matching this exact shape:
{"q": string, "chapter": string, "subjectId": string, "classId": string, "difficulty": "easy"|"medium"|"hard"|"", "type": "mcq"|"subjective"|"true-false"|"fill-in-blank"|"case-study"|"", "marks": number|null, "sortBy": "newest"|"oldest"|"difficulty"|"marks"|""}

Rules:
- "chapter" must be an EXACT string from the provided chapter list, or "" if none clearly matches.
- "subjectId" and "classId" must be an EXACT id from the provided lists, or "" if unsure.
- Put any remaining descriptive words (topic keywords, "board questions", "PYQ", etc.) that don't map to a structured field into "q" as free text — it will be matched against question text/options/tags.
- "marks" is a number only if the query specifies exact marks (e.g. "1 mark questions"); otherwise null.
- Never invent a chapter/subject/class value that isn't in the lists below.

Known chapters: ${JSON.stringify(chapters)}
Known subjects: ${JSON.stringify(subjects)}
Known classes: ${JSON.stringify(classes)}`;

    const result = await callClaudeJSON({ system, prompt: query, maxTokens: 400 });

    if (!result.ok) {
      return res.status(502).json({ success: false, message: result.reason || 'AI could not interpret this search.' });
    }

    const d = result.data || {};
    // Defensive re-validation: even with the prompt constraints, only trust
    // chapter/subjectId/classId values that actually exist — anything else
    // is dropped rather than passed through to the filter engine.
    const filters = {
      q: typeof d.q === 'string' ? d.q.trim() : '',
      chapter: chapters.includes(d.chapter) ? d.chapter : '',
      subjectId: subjects.some(s => s.id === d.subjectId) ? d.subjectId : '',
      classId: classes.some(c => c.id === d.classId) ? d.classId : '',
      difficulty: ['easy', 'medium', 'hard'].includes(d.difficulty) ? d.difficulty : '',
      type: ['mcq', 'subjective', 'true-false', 'fill-in-blank', 'case-study'].includes(d.type) ? d.type : '',
      marks: typeof d.marks === 'number' && d.marks > 0 ? d.marks : '',
      sortBy: ['newest', 'oldest', 'difficulty', 'marks'].includes(d.sortBy) ? d.sortBy : '',
    };

    res.json({ success: true, data: filters });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Duplicate Question Detection — finds pairs of questions whose text is
// suspiciously similar. To stay fast even with a very large bank, it never
// does a full O(n^2) scan: questions are first "blocked" by
// subjectId+chapter (true duplicates are essentially always within the
// same chapter), and only questions inside the same block are ever
// compared against each other.
router.get('/duplicates', requirePermission('questions:view'), (req, res) => {
  try {
    const threshold = Math.min(0.95, Math.max(0.3, parseFloat(req.query.threshold) || 0.6));
    const { subjectId, chapter } = req.query;

    let questions = db.find('questions', {}).filter(q => q.isActive !== false);
    if (subjectId) questions = questions.filter(q => q.subjectId === subjectId);
    if (chapter) questions = questions.filter(q => q.chapter === chapter);

    const blocks = new Map();
    for (const q of questions) {
      const key = `${q.subjectId || 'none'}::${(q.chapter || '').trim().toLowerCase()}`;
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(q);
    }

    const MAX_PAIRS = 300;
    const pairs = [];

    for (const group of blocks.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const similarity = jaccardSimilarity(group[i].questionText, group[j].questionText);
          if (similarity >= threshold) {
            pairs.push({
              similarity: Math.round(similarity * 100),
              a: summarizeForDuplicateCheck(group[i]),
              b: summarizeForDuplicateCheck(group[j]),
            });
          }
        }
      }
    }

    pairs.sort((a, b) => b.similarity - a.similarity);

    res.json({
      success: true,
      data: pairs.slice(0, MAX_PAIRS),
      scanned: questions.length,
      totalPairsFound: pairs.length
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

function summarizeForDuplicateCheck(q) {
  return {
    _id: q._id,
    questionText: q.questionText,
    chapter: q.chapter,
    subjectId: q.subjectId,
    difficulty: q.difficulty,
    marks: q.marks,
    status: q.status,
    createdAt: q.createdAt,
  };
}

// Single-question duplicate check — run before saving a new/edited
// question so the UI can warn "this looks like an existing question" with
// Compare / Save Anyway, instead of only ever finding duplicates after the
// fact via the bulk scanner above. Scoped to the same subject+chapter for
// speed, same blocking rationale as GET /duplicates.
router.post('/duplicate-check', requirePermission('questions:view'), (req, res) => {
  try {
    const { questionText, subjectId, chapter, excludeId } = req.body;
    if (!questionText || !questionText.trim()) {
      return res.json({ success: true, data: [] });
    }

    let candidates = db.find('questions', {}).filter(q => q.isActive !== false && q._id !== excludeId);
    if (subjectId) candidates = candidates.filter(q => q.subjectId === subjectId);
    if (chapter) candidates = candidates.filter(q => (q.chapter || '').trim().toLowerCase() === chapter.trim().toLowerCase());

    const matches = candidates
      .map(q => ({ similarity: Math.round(jaccardSimilarity(questionText, q.questionText) * 100), question: summarizeForDuplicateCheck(q) }))
      .filter(m => m.similarity >= 60)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    res.json({ success: true, data: matches });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});


// Question Analytics — Times Used / Correct% / Wrong% / Average Time /
// Difficulty Index, computed from REAL student data: studentAttempts ->
// (answers[].questionId) -> testQuestions._id -> testQuestions.bankQuestionId
// -> this question. Deliberately does NOT include Practice Mode attempts
// (services/practice.js) — that flow reads from a different, older question
// shape (`q.question`/`q.answer`, no shared _id back to the Question Bank)
// and isn't reliably linkable back to a bank question yet. Rather than
// silently under-counting, the response says so via `practiceModeIncluded`.
router.get('/:id/analytics', requirePermission('questions:view'), (req, res) => {
  try {
    const { id } = req.params;
    const question = db.findById('questions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    const linkedTestQuestions = db.find('testQuestions', { bankQuestionId: id });
    const linkedIds = new Set(linkedTestQuestions.map(tq => tq._id));

    let timesUsed = 0, correct = 0, wrong = 0, totalTimeSpent = 0;
    if (linkedIds.size > 0) {
      const attempts = db.find('studentAttempts', { isSubmitted: true });
      for (const attempt of attempts) {
        for (const ans of (attempt.answers || [])) {
          if (linkedIds.has(ans.questionId)) {
            timesUsed++;
            if (ans.isCorrect) correct++; else wrong++;
            totalTimeSpent += ans.timeSpent || 0;
          }
        }
      }
    }

    const correctPct = timesUsed > 0 ? Math.round((correct / timesUsed) * 100) : null;
    const wrongPct = timesUsed > 0 ? Math.round((wrong / timesUsed) * 100) : null;
    const avgTimeSeconds = timesUsed > 0 ? Math.round(totalTimeSpent / timesUsed) : null;
    // Standard psychometric convention: difficulty index = % who got it
    // WRONG (higher = harder). Shown alongside correct%/wrong% so it's
    // never ambiguous which direction it runs.
    const difficultyIndex = wrongPct;

    res.json({
      success: true,
      data: {
        timesUsed,
        correctCount: correct,
        wrongCount: wrong,
        correctPct,
        wrongPct,
        avgTimeSeconds,
        difficultyIndex,
        testsUsedIn: linkedTestQuestions.length,
        practiceModeIncluded: false
      }
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Get question by ID from bank
router.get('/:id', requirePermission('questions:view'), (req, res) => {
  try {
    const { id } = req.params;
    const question = db.findById('questions', id);

    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    res.json({
      success: true,
      data: {
        ...question,
        availableTransitions: getAvailableTransitions(question.status || 'draft')
          .filter(t => hasPermission(req.userData.role, t.permission))
      }
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Add question to question bank
router.post('/', requirePermission('questions:create'), validators.createQuestion, validate, (req, res) => {
  try {
    const { questionText, chapter, options, correctAnswer, explanation, marks, type, difficulty, subjectId, book, topic, subTopic, learningOutcome } = req.body;

    if (!questionText || !options || !correctAnswer) {
      return res.status(400).json({
        success: false,
        message: 'Question text, options, and correct answer are required'
      });
    }

    // classId is always derived from the chosen subject (never taken
    // directly from the client) so a question's class can never drift out
    // of sync with the subject it's actually tagged under.
    let classId = null;
    if (subjectId) {
      const subject = db.findById('subjects', subjectId);
      if (!subject) {
        return res.status(400).json({ success: false, message: 'Selected subject was not found' });
      }
      classId = subject.classId || null;
    }

    if (!isSubjectAllowedForUser(req.userData, subjectId) || !isClassAllowedForUser(req.userData, classId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this subject." });
    }

    const newQuestion = db.insertOne('questions', {
      questionText,
      chapter: chapter || 'Uncategorized',
      subjectId: subjectId || null,
      classId,
      // Full content hierarchy: Class -> Subject -> Book -> Chapter -> Topic
      // -> Sub Topic -> Learning Outcome. All optional/free-text (no master
      // list to maintain) so tagging can be as coarse or fine as the admin
      // wants — an empty topic just means "not tagged down that far yet".
      book: book || '',
      topic: topic || '',
      subTopic: subTopic || '',
      learningOutcome: learningOutcome || '',
      options,
      correctAnswer,
      explanation: explanation || '',
      marks: marks || 1,
      type: type || 'mcq',
      difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
      status: 'draft',
      isActive: true,
      createdBy: req.user?.id || 'admin',
      createdAt: new Date().toISOString()
    });


    recordQuestionHistory(req, newQuestion._id, 'created', { toStatus: 'draft', summary: 'Question created' });
    logAudit(req, 'create', 'question', newQuestion._id, `Added question to bank (${newQuestion.chapter})`);

    res.status(201).json({
      success: true,
      data: newQuestion,
      message: 'Question added to bank successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Bulk-approve — moves every selected question that is currently "In Review"
// to "Approved" in one call. Questions in any other status (draft, already
// approved/published, archived) are skipped rather than failing the whole
// batch, and the response reports how many were skipped and why.
//
// NOTE: this must be registered before PUT '/:id' below — Express matches
// PUT routes in registration order, and '/:id' would otherwise swallow
// '/bulk-approve' requests (treating "bulk-approve" as an id) and return a
// false "Question not found" 404.
router.put('/bulk-approve', requirePermission('questions:approve'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids must be a non-empty array' });
    }

    const approved = [];
    const skipped = [];

    for (const id of ids) {
      const question = db.findById('questions', id);
      if (!question) { skipped.push({ id, reason: 'Not found' }); continue; }

      const fromStatus = question.status || 'draft';
      const transition = getAllowedTransition(fromStatus, 'approved');
      if (!transition) {
        skipped.push({ id, reason: `Currently "${STATUS_LABELS[fromStatus] || fromStatus}", not "In Review"` });
        continue;
      }

      const updated = db.findByIdAndUpdate('questions', id, { status: 'approved' });
      recordQuestionHistory(req, id, 'status_change', { fromStatus, toStatus: 'approved', note: 'Bulk approved' });
      approved.push(updated._id);
    }

    if (approved.length > 0) {
      logAudit(req, 'edit', 'question', null, `Bulk approved ${approved.length} question(s)`);
    }

    res.json({
      success: true,
      data: { approvedIds: approved, skipped },
      message: skipped.length
        ? `Approved ${approved.length} question(s). Skipped ${skipped.length} (not in review).`
        : `Approved ${approved.length} question(s).`
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Update question in bank
router.put('/:id', requirePermission('questions:edit'), validators.updateQuestion, validate, (req, res) => {
  try {
    const { id } = req.params;
    const { questionText, chapter, options, correctAnswer, explanation, marks, type, isActive, difficulty, subjectId, book, topic, subTopic, learningOutcome } = req.body;

    const question = db.findById('questions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    // Editing the content of something already approved/published means
    // it hasn't actually been reviewed in its current form — send it back
    // to draft so it goes through Review again before it can be
    // (re-)published. Editing a draft/in-review/archived question just
    // updates it in place. Re-tagging the subject alone is deliberately
    // NOT in this list — moving a question to a different subject/class
    // doesn't change whether its content has been reviewed.
    const contentChanged = [questionText, chapter, options, correctAnswer, explanation, marks, type, difficulty, book, topic, subTopic, learningOutcome]
        .some(v => v !== undefined);
    const shouldResetToDraft = contentChanged && ['approved', 'published'].includes(question.status);

    // classId always tracks whichever subject the question ends up tagged
    // with, same as on create — never accepted directly from the client.
    let classId = question.classId;
    if (subjectId !== undefined) {
      if (subjectId) {
        const subject = db.findById('subjects', subjectId);
        if (!subject) {
          return res.status(400).json({ success: false, message: 'Selected subject was not found' });
        }
        classId = subject.classId || null;
      } else {
        classId = null;
      }
    }

    // Full pre-edit snapshot, captured BEFORE the update is applied — this
    // is what makes real version history + rollback possible (the old
    // history log only recorded a generic "Content edited" line with no
    // way to see or restore what it used to say).
    const preEditSnapshot = { ...question };

    const updated = db.findByIdAndUpdate('questions', id, {
      questionText: questionText || question.questionText,
      chapter: chapter !== undefined ? chapter : question.chapter,
      subjectId: subjectId !== undefined ? (subjectId || null) : question.subjectId,
      classId,
      book: book !== undefined ? book : question.book,
      topic: topic !== undefined ? topic : question.topic,
      subTopic: subTopic !== undefined ? subTopic : question.subTopic,
      learningOutcome: learningOutcome !== undefined ? learningOutcome : question.learningOutcome,
      options: options || question.options,
      correctAnswer: correctAnswer || question.correctAnswer,
      explanation: explanation !== undefined ? explanation : question.explanation,
      marks: marks || question.marks,
      type: type || question.type,
      difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : (question.difficulty || 'medium'),
      isActive: isActive !== undefined ? isActive : question.isActive,
      status: shouldResetToDraft ? 'draft' : (question.status || 'draft'),
      updatedAt: new Date().toISOString()
    });

    recordQuestionHistory(req, id, 'edited', { summary: 'Content edited', snapshot: preEditSnapshot });
    if (shouldResetToDraft) {
      recordQuestionHistory(req, id, 'status_change', {
        fromStatus: question.status, toStatus: 'draft',
        note: 'Automatically sent back to Draft — content was edited after being approved/published and needs re-review.'
      });
    }

    logAudit(req, 'edit', 'question', id, `Updated question in bank (${updated.chapter})`);

    res.json({
      success: true,
      data: updated,
      message: shouldResetToDraft
        ? 'Question updated. Since it was already approved/published, it has been moved back to Draft for re-review.'
        : 'Question updated successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Bulk-update — edits a shared field (chapter/marks/type/subject/class)
// across many questions at once, e.g. re-chaptering a batch.
router.post('/bulk-update', requirePermission('questions:edit'), (req, res) => {
  try {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided'
      });
    }

    let changed = 0;
    const questions = db.find('questions', {});
    // Cache subject/class lookups across the batch instead of re-reading
    // the subjects/classes collections once per selected question.
    const subjectCache = new Map();
    const classCache = new Map();

    for (const update of updates) {
      const { id, chapter, marks, type, subjectId, classId } = update;
      const question = questions.find(q => q._id === id);

      if (!question) continue;
      if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) continue;

      let updated = false;

      if (chapter !== undefined && chapter !== '') {
        question.chapter = chapter;
        updated = true;
      }
      if (marks !== undefined && marks !== '') {
        question.marks = parseFloat(marks) || 1;
        updated = true;
      }
      if (type !== undefined && type !== '') {
        question.type = type;
        updated = true;
      }
      // Bulk subject reassignment: classId is always derived from the
      // subject (same rule as the single-question create/edit routes
      // above), so a bulk move can never leave subjectId/classId out of
      // sync. Unknown subject ids are silently skipped for that one field
      // rather than failing the whole batch.
      if (subjectId !== undefined && subjectId !== '') {
        if (!subjectCache.has(subjectId)) {
          subjectCache.set(subjectId, db.findById('subjects', subjectId));
        }
        const subject = subjectCache.get(subjectId);
        if (subject) {
          question.subjectId = subject._id;
          question.classId = subject.classId || null;
          updated = true;
        }
      }
      // Bulk class reassignment: moving a question to a different class
      // directly (not via subject) intentionally clears subjectId — the
      // question's current subject belongs to its OLD class and almost
      // certainly isn't valid for the new one, so leaving it set would
      // silently create a subject/class that don't match. The question
      // becomes "Unassigned" (subject) in its new class, same as any
      // other unassigned question, ready for a subject to be picked
      // separately. Skipped if `subjectId` was ALSO sent in the same
      // update (subject reassignment above already set a consistent
      // classId, so classId here would just be redundant/conflicting).
      if (classId !== undefined && classId !== '' && (subjectId === undefined || subjectId === '')) {
        if (!classCache.has(classId)) {
          classCache.set(classId, db.findById('classes', classId));
        }
        const cls = classCache.get(classId);
        if (cls) {
          question.classId = cls._id;
          question.subjectId = null;
          updated = true;
        }
      }

      if (updated) {
        question.updatedAt = new Date().toISOString();
        changed++;
      }
    }

    db.saveCollection('questions');

    if (changed > 0) {
      logAudit(req, 'edit', 'question', null, `Bulk-updated ${changed} question(s)`);
    }

    res.json({
      success: true,
      data: { changed },
      message: `${changed} questions updated successfully`
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Failed to update questions' });
  }
});

// Bulk-delete — hard-removes the given question IDs from the bank entirely
// (unlike the single-question DELETE below, which soft-deletes).
router.post('/bulk-delete', requirePermission('questions:delete'), (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No IDs provided'
      });
    }

    const idSet = new Set(ids);
    const questions = db.find('questions', {});
    const initialCount = questions.length;

    const remaining = questions.filter(q => !idSet.has(q._id) || !isClassAllowedForUser(req.userData, q.classId) || !isSubjectAllowedForUser(req.userData, q.subjectId));
    const deleted = initialCount - remaining.length;

    db.collections.questions = remaining;
    db.saveCollection('questions');

    if (deleted > 0) {
      logAudit(req, 'delete', 'question', null, `Bulk-deleted ${deleted} question(s)`);
    }

    res.json({
      success: true,
      data: { deleted },
      message: `${deleted} questions deleted successfully`
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Failed to delete questions' });
  }
});

// Move a single question through the review workflow (draft → review →
// approved → published, plus the "send back" paths) — see
// config/questionWorkflow.js for the full state machine.
router.put('/:id/status', requirePermission('questions:edit'), (req, res) => {
  try {
    const { id } = req.params;
    const { status: toStatus, note } = req.body;

    const question = db.findById('questions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    const fromStatus = question.status || 'draft';
    const transition = getAllowedTransition(fromStatus, toStatus);
    if (!transition) {
      return res.status(400).json({
        success: false,
        message: `Can't move a question from "${STATUS_LABELS[fromStatus] || fromStatus}" to "${STATUS_LABELS[toStatus] || toStatus}".`
      });
    }
    if (!hasPermission(req.userData.role, transition.permission)) {
      return res.status(403).json({
        success: false,
        message: `Your role (${req.userData.role}) doesn't have permission to do this (${transition.label}).`
      });
    }

    const updated = db.findByIdAndUpdate('questions', id, { status: toStatus });
    recordQuestionHistory(req, id, 'status_change', { fromStatus, toStatus, note: note || '' });
    logAudit(req, 'edit', 'question', id, `Moved question from "${STATUS_LABELS[fromStatus]}" to "${STATUS_LABELS[toStatus]}"${note ? `: ${note}` : ''}`);

    res.json({ success: true, data: updated, message: `Question moved to ${STATUS_LABELS[toStatus]}` });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Full change history for one question (creation, edits, status moves)
router.get('/:id/history', requirePermission('questions:view'), (req, res) => {
  try {
    const question = db.findById('questions', req.params.id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    res.json({ success: true, data: getQuestionHistory(req.params.id) });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Restore a question to how it looked in a previous version — only works
// for 'edited' history entries, which are the ones that carry a full
// pre-edit snapshot (see recordQuestionHistory). Restoring counts as a
// content edit itself: it records its own history entry (with a snapshot
// of the state right before the restore, so a restore can itself be
// undone) and sends the question back to Draft, same as any other
// content edit to something previously approved/published.
router.post('/:id/history/:historyId/restore', requirePermission('questions:edit'), (req, res) => {
  try {
    const { id, historyId } = req.params;

    const question = db.findById('questions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    const entry = getQuestionHistory(id).find(h => h._id === historyId);
    if (!entry || !entry.snapshot) {
      return res.status(404).json({ success: false, message: 'No restorable version found for that history entry' });
    }

    const preRestoreSnapshot = { ...question };
    const snap = entry.snapshot;

    const updated = db.findByIdAndUpdate('questions', id, {
      questionText: snap.questionText,
      chapter: snap.chapter,
      subjectId: snap.subjectId,
      classId: snap.classId,
      book: snap.book || '',
      topic: snap.topic || '',
      subTopic: snap.subTopic || '',
      learningOutcome: snap.learningOutcome || '',
      options: snap.options,
      correctAnswer: snap.correctAnswer,
      explanation: snap.explanation,
      marks: snap.marks,
      type: snap.type,
      difficulty: snap.difficulty,
      status: 'draft', // a restored version hasn't been reviewed in this form — back to Draft
      updatedAt: new Date().toISOString()
    });

    recordQuestionHistory(req, id, 'edited', { summary: 'Restored to a previous version', snapshot: preRestoreSnapshot });
    recordQuestionHistory(req, id, 'status_change', {
      fromStatus: question.status, toStatus: 'draft',
      note: 'Sent back to Draft — a restored version needs re-review before it can be approved/published again.'
    });

    logAudit(req, 'update', 'question', id, `Restored question to a previous version`);
    res.json({ success: true, data: updated, message: 'Question restored to the previous version and sent back to Draft for re-review.' });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

// Delete question from bank (soft delete)
router.delete('/:id', requirePermission('questions:delete'), (req, res) => {
  try {
    const { id } = req.params;

    const question = db.findById('questions', id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    if (!isClassAllowedForUser(req.userData, question.classId) || !isSubjectAllowedForUser(req.userData, question.subjectId)) {
      return res.status(403).json({ success: false, message: "You're not assigned to this class/subject." });
    }

    // Soft delete
    db.findByIdAndUpdate('questions', id, { isActive: false });
    logAudit(req, 'delete', 'question', id, `Deleted question from bank`);

    res.json({
      success: true,
      message: 'Question deleted from bank successfully'
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;