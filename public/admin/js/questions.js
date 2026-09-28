// public/admin/js/questions.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

const QUESTION_STATUS_LABELS = {
    draft: 'Draft',
    review: 'In Review',
    approved: 'Approved',
    published: 'Published',
    archived: 'Archived',
};

// Same 5 types already used by the Filters dropdown (#qfType) and the bulk
// "Question Type" update selector (#bulkFieldSelectValue) — kept as one
// shared list so the manual Add/Edit Question forms offer the exact same
// choices instead of introducing a 6th, inconsistent set.
const QUESTION_TYPE_OPTIONS = [
    { id: 'mcq', label: 'MCQ' },
    { id: 'subjective', label: 'Subjective' },
    { id: 'true-false', label: 'True/False' },
    { id: 'fill-in-blank', label: 'Fill in Blank' },
    { id: 'case-study', label: 'Case Study' },
];

function questionTypeOptionsHTML(selectedType) {
    const sel = selectedType || 'mcq';
    return QUESTION_TYPE_OPTIONS.map(t =>
        `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.label}</option>`
    ).join('');
}

// Ctrl/Cmd+K focuses the Smart Search box (only meaningful while the
// Question Bank section is open — the input simply won't exist otherwise,
// so this is a harmless no-op elsewhere).
document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const input = document.getElementById('questionSearchInput');
        if (input) {
            e.preventDefault();
            input.focus();
            input.select();
        }
    }
});

// Smart Search state — one place holding everything the search bar /
// advanced filter panel / sort dropdown / pagination controls read and
// write. Defaults are all "off" so a fresh page load behaves exactly like
// before Smart Search existed (plain unfiltered, unpaginated list).
window._qSearch = window._qSearch || {
    q: '',
    chapter: '',
    topic: '',
    subTopic: '',
    book: '',
    difficulty: '',
    type: '',
    marks: '',
    sortBy: '',
    page: 1,
    limit: 20,
    advancedOpen: false,
};

async function loadQuestions() {
    showLoading();
    try {
        const statusFilter = window._questionStatusFilter;
        const subjectFilter = window._questionSubjectFilter;
        const s = window._qSearch;
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (subjectFilter) params.set('subjectId', subjectFilter);
        if (s.q) params.set('q', s.q);
        if (s.chapter) params.set('chapter', s.chapter);
        if (s.topic) params.set('topic', s.topic);
        if (s.subTopic) params.set('subTopic', s.subTopic);
        if (s.book) params.set('book', s.book);
        if (s.difficulty) params.set('difficulty', s.difficulty);
        if (s.type) params.set('type', s.type);
        if (s.marks) params.set('marks', s.marks);
        if (s.sortBy) params.set('sortBy', s.sortBy);
        // Pagination only kicks in once there's an active search/filter —
        // browsing the full bank unpaginated (old behavior) still works
        // when the search box and advanced filters are untouched.
        const searchActive = !!(s.q || s.chapter || s.topic || s.subTopic || s.book || s.difficulty || s.type || s.marks);
        if (searchActive) {
            params.set('page', s.page);
            params.set('limit', s.limit);
        }
        const qs = params.toString();

        const [questionsRes, subjectsRes, classesRes, statsRes, savedSearchesRes] = await Promise.all([
            apiCall(`/questions${qs ? `?${qs}` : ''}`),
            apiCall('/subjects'),
            apiCall('/classes'),
            apiCall('/questions/stats/by-subject'),
            apiCall('/questions/saved-searches')
        ]);
        allQuestions = questionsRes?.data || [];
        currentData = allQuestions;
        window._questionsTotal = questionsRes?.total ?? allQuestions.length;
        window._questionsPagination = questionsRes?.pagination || null;
        window._subjects = subjectsRes?.data || [];
        window._classes = classesRes?.data || [];
        window._questionSubjectStats = statsRes?.data || { subjects: [], unassigned: 0 };
        window._savedSearches = savedSearchesRes?.data || [];
        renderQuestions();
    } catch (error) {
        showError('Failed to load questions', error.message);
    }
}

// Debounce helper — used so the search box fires a request ~350ms after
// the admin stops typing, not on every keystroke.
function debounce(fn, wait) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

function handleQuestionSearchInput(value) {
    window._qSearch.q = value;
    window._qSearch.page = 1;
    debouncedQuestionSuggestions(value);
    debouncedQuestionSearch();
}
const debouncedQuestionSearch = debounce(() => loadQuestions(), 350);
const debouncedQuestionSuggestions = debounce((value) => fetchQuestionSuggestions(value), 150);

function handleQuestionSearchKeydown(e) {
    if (e.key === 'Escape') {
        e.target.value = '';
        clearQuestionSearch();
        e.target.blur();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const box = document.getElementById('questionSearchSuggestions');
        const first = box && box.style.display !== 'none' ? box.querySelector('.search-suggestion-item') : null;
        if (first) {
            first.click(); // reuses whichever onclick is already wired (suggestion or recent-search item)
        } else {
            addRecentSearch(e.target.value);
            window._qSearch.q = e.target.value;
            window._qSearch.page = 1;
            loadQuestions(); // run immediately instead of waiting for the debounce
        }
    }
}

// ============================================================
// RECENT SEARCHES
// ============================================================
// Stored client-side (this admin's browser) — last 8 distinct terms,
// most recent first. Shown under the search box when it's focused with
// nothing (or too little) typed yet, before live suggestions take over.
const RECENT_SEARCHES_KEY = 'chawlaClasses_recentQuestionSearches';

function getRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    } catch (_) {
        return [];
    }
}

function addRecentSearch(term) {
    if (!term || !term.trim()) return;
    const value = term.trim();
    let recent = getRecentSearches().filter(x => x.toLowerCase() !== value.toLowerCase());
    recent.unshift(value);
    recent = recent.slice(0, 8);
    try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent)); } catch (_) { /* storage unavailable — recent searches just won't persist */ }
}

function showRecentSearchesDropdown() {
    const input = document.getElementById('questionSearchInput');
    if (input && input.value.trim().length >= 2) return; // live suggestions already own the dropdown at that point
    const box = document.getElementById('questionSearchSuggestions');
    if (!box) return;
    const recent = getRecentSearches();
    if (recent.length === 0) { box.style.display = 'none'; return; }
    box.innerHTML = `
        <div style="padding:6px 14px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--card-border);">Recent</div>
        ${recent.map(term => `
            <div class="search-suggestion-item" onclick="applyQuestionSuggestion(null, '${escapeHtml(term).replace(/'/g, "\\'")}', 'recent')">
                <i class="fas fa-history"></i>
                <span>${escapeHtml(term)}</span>
            </div>
        `).join('')}
    `;
    box.style.display = 'block';
}

async function fetchQuestionSuggestions(value) {
    const box = document.getElementById('questionSearchSuggestions');
    if (!box) return;
    const q = (value || '').trim();
    if (q.length < 2) { showRecentSearchesDropdown(); return; }
    try {
        const res = await apiCall(`/questions/search/suggestions?q=${encodeURIComponent(q)}`);
        const items = res?.data || [];
        if (items.length === 0) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.innerHTML = items.map(item => `
            <div class="search-suggestion-item" onclick="applyQuestionSuggestion(${item.type === 'question' ? `'${item.id}'` : 'null'}, '${escapeHtml(item.label).replace(/'/g, "\\'")}', '${item.type}')">
                <i class="fas ${item.type === 'question' ? 'fa-question-circle' : 'fa-book'}"></i>
                <span>${escapeHtml(item.label)}</span>
            </div>
        `).join('');
        box.style.display = 'block';
    } catch (_) {
        box.style.display = 'none';
    }
}

function applyQuestionSuggestion(id, label, type) {
    const input = document.getElementById('questionSearchInput');
    const box = document.getElementById('questionSearchSuggestions');
    const value = (type === 'chapter' || type === 'recent') ? label : label.replace(/…$/, '');
    if (input) input.value = value;
    window._qSearch.q = value;
    window._qSearch.page = 1;
    addRecentSearch(value);
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    loadQuestions();
}

function toggleAdvancedFilters() {
    window._qSearch.advancedOpen = !window._qSearch.advancedOpen;
    renderQuestions();
}

function applyAdvancedFilters() {
    const s = window._qSearch;
    s.chapter = document.getElementById('qfChapter')?.value || '';
    s.topic = document.getElementById('qfTopic')?.value || '';
    s.subTopic = document.getElementById('qfSubTopic')?.value || '';
    s.book = document.getElementById('qfBook')?.value || '';
    s.difficulty = document.getElementById('qfDifficulty')?.value || '';
    s.type = document.getElementById('qfType')?.value || '';
    s.marks = document.getElementById('qfMarks')?.value || '';
    s.page = 1;
    loadQuestions();
}

function clearQuestionSearch() {
    window._qSearch = { q: '', chapter: '', topic: '', subTopic: '', book: '', difficulty: '', type: '', marks: '', sortBy: '', page: 1, limit: 20, advancedOpen: false };
    window._aiInterpretedNote = '';
    loadQuestions();
}

function changeQuestionsSort(value) {
    window._qSearch.sortBy = value;
    loadQuestions();
}

function changeQuestionsPage(delta) {
    const p = window._questionsPagination;
    if (!p) return;
    const next = Math.min(p.pages, Math.max(1, p.page + delta));
    if (next === p.page) return;
    window._qSearch.page = next;
    loadQuestions();
}

async function runAiQuestionSearch() {
    const input = document.getElementById('questionSearchInput');
    const query = (input?.value || '').trim();
    if (!query) { showToast('AI Search', 'Type what you\'re looking for first, e.g. "easy polynomial questions"', 'warning'); return; }
    addRecentSearch(query);

    const btn = document.getElementById('qAiSearchBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Thinking...'; }

    try {
        const res = await apiCall('/questions/search/ai-interpret', {
            method: 'POST',
            body: JSON.stringify({ query })
        });

        if (!res || !res.success) {
            showToast('AI Search', (res && res.message) || 'Could not interpret that — running it as a plain text search instead.', 'warning');
            window._qSearch.q = query;
            window._qSearch.page = 1;
            await loadQuestions();
            return;
        }

        const f = res.data || {};
        const s = window._qSearch;
        s.q = f.q || '';
        s.chapter = f.chapter || '';
        s.difficulty = f.difficulty || '';
        s.type = f.type || '';
        s.marks = f.marks || '';
        s.sortBy = f.sortBy || s.sortBy;
        s.page = 1;
        s.advancedOpen = true; // reveal the interpreted filters so the admin can see/tweak them
        if (f.subjectId) { window._questionSubjectFilter = f.subjectId; }

        window._aiInterpretedNote = summarizeAiFilters(f);
        await loadQuestions();
    } catch (err) {
        showToast('AI Search', 'AI search failed — try a plain keyword search instead.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> AI Search'; }
    }
}

function summarizeAiFilters(f) {
    const parts = [];
    if (f.chapter) parts.push(`Chapter: ${f.chapter}`);
    if (f.difficulty) parts.push(`Difficulty: ${f.difficulty}`);
    if (f.type) parts.push(`Type: ${f.type}`);
    if (f.marks) parts.push(`Marks: ${f.marks}`);
    if (f.q) parts.push(`Keywords: "${f.q}"`);
    return parts.length ? `AI understood this as — ${parts.join(' · ')}` : '';
}

// ============================================================
// SEARCH ANALYTICS
// ============================================================

async function showSearchAnalytics() {
    showModal('Search Analytics', 'What teachers are searching for, and where the bank comes up short.', `
        <div id="searchAnalyticsBody" style="color:var(--muted);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
        <div style="margin-top:14px;text-align:right;"><button class="btn" onclick="closeModal()">Close</button></div>
    `, null);
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';

    const res = await apiCall('/questions/search-analytics');
    const body = document.getElementById('searchAnalyticsBody');
    if (!body) return; // modal was closed before this resolved
    if (!res || !res.success) { body.innerHTML = `<div style="color:var(--danger);">Failed to load search analytics.</div>`; return; }

    const d = res.data;
    body.innerHTML = `
        <div style="color:var(--muted);font-size:12px;margin-bottom:14px;">${d.totalSearches.toLocaleString()} searches logged in total.</div>

        <h4 style="margin:0 0 8px;color:var(--text);font-size:13px;"><i class="fas fa-fire"></i> Top Keywords</h4>
        ${d.topKeywords.length === 0 ? `<div style="color:var(--muted);font-size:12px;margin-bottom:16px;">No searches logged yet.</div>` : `
            <div style="margin-bottom:16px;">
                ${d.topKeywords.map(k => searchAnalyticsRowHTML(k.query, `${k.count}×`)).join('')}
            </div>
        `}

        <h4 style="margin:0 0 8px;color:var(--text);font-size:13px;"><i class="fas fa-exclamation-triangle" style="color:var(--danger);"></i> Zero-Result Searches</h4>
        ${d.zeroResultSearches.length === 0 ? `<div style="color:var(--muted);font-size:12px;margin-bottom:16px;">None — every logged search found something.</div>` : `
            <div style="color:var(--muted);font-size:11px;margin-bottom:6px;">Teachers looking for something the bank doesn't have yet — good candidates for new questions.</div>
            <div style="margin-bottom:16px;">
                ${d.zeroResultSearches.map(k => searchAnalyticsRowHTML(k.query, `${k.zeroResultCount}×`)).join('')}
            </div>
        `}

        <h4 style="margin:0 0 8px;color:var(--text);font-size:13px;"><i class="fas fa-star" style="color:var(--gold);"></i> Most-Used Saved Searches</h4>
        ${d.savedSearches.length === 0 ? `<div style="color:var(--muted);font-size:12px;">No saved searches yet.</div>` : `
            <div>${d.savedSearches.map(s => searchAnalyticsRowHTML(s.name, `${s.usageCount}×`)).join('')}</div>
        `}
    `;
}

function searchAnalyticsRowHTML(label, count) {
    return `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--card-border);font-size:12px;">
            <span style="color:var(--text);">${escapeHtml(label)}</span>
            <span style="color:var(--muted);">${escapeHtml(count)}</span>
        </div>
    `;
}

// Called right before saving a new/edited question. Returns true if it's
// safe to proceed (no close match, or the admin chose Save Anyway), false
// if the admin backed out to go review the existing one instead.
async function confirmNotDuplicate(questionText, subjectId, chapter, excludeId) {
    try {
        const res = await apiCall('/questions/duplicate-check', {
            method: 'POST',
            body: JSON.stringify({ questionText, subjectId, chapter, excludeId: excludeId || null })
        });
        const matches = res?.data || [];
        if (matches.length === 0) return true;
        const top = matches[0];
        if (top.similarity < 70) return true; // not similar enough to bother asking
        const snippet = (top.question.questionText || '').substring(0, 140);
        return confirm(`This looks ${top.similarity}% similar to an existing question:\n\n"${snippet}${(top.question.questionText || '').length > 140 ? '...' : ''}"\n\nSave anyway?`);
    } catch (_) {
        return true; // don't block saving if the duplicate check itself fails
    }
}

// ============================================================
// DUPLICATE QUESTION DETECTION
// ============================================================

async function showDuplicateScanner() {
    showModal('Duplicate Question Scanner', 'Finds questions with very similar text within the same chapter, so you can review and clean them up.', `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
            <label style="font-size:13px;color:var(--muted);">Similarity threshold</label>
            <select id="dupThreshold" class="status-filter-select" style="min-width:140px;">
                <option value="0.5">Loose (50%+)</option>
                <option value="0.6" selected>Balanced (60%+)</option>
                <option value="0.75">Strict (75%+)</option>
                <option value="0.9">Near-exact (90%+)</option>
            </select>
            <button class="btn btn-gold btn-sm" onclick="runDuplicateScan()"><i class="fas fa-search"></i> Scan</button>
            ${window._questionSubjectFilter && window._questionSubjectFilter !== 'unassigned' ? `<span style="font-size:12px;color:var(--muted);">Scoped to current subject filter</span>` : `<span style="font-size:12px;color:var(--muted);">Scanning whole bank — pick a subject filter first to narrow it down</span>`}
        </div>
        <div id="dupResults"><div style="color:var(--muted);font-size:13px;">Click "Scan" to find similar questions.</div></div>
        <div style="margin-top:14px;text-align:right;"><button class="btn" onclick="closeModal()">Close</button></div>
    `, null);
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';
}

async function runDuplicateScan() {
    const box = document.getElementById('dupResults');
    const threshold = document.getElementById('dupThreshold')?.value || '0.6';
    box.innerHTML = `<div style="color:var(--muted);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Scanning...</div>`;

    const params = new URLSearchParams({ threshold });
    const subjectFilter = window._questionSubjectFilter;
    if (subjectFilter && subjectFilter !== 'unassigned') params.set('subjectId', subjectFilter);

    try {
        const res = await apiCall(`/questions/duplicates?${params.toString()}`);
        const pairs = res?.data || [];
        window._lastDuplicatePairs = pairs;
        if (pairs.length === 0) {
            box.innerHTML = `<div style="color:var(--muted);font-size:13px;">No similar questions found (scanned ${res?.scanned ?? 0} questions). Try a lower threshold.</div>`;
            return;
        }
        box.innerHTML = `
            <div style="color:var(--muted);font-size:12px;margin-bottom:10px;">Scanned ${res.scanned} questions · ${pairs.length} likely duplicate pair(s)${res.totalPairsFound > pairs.length ? ` (showing top ${pairs.length})` : ''}</div>
            <div style="max-height:420px;overflow-y:auto;">
                ${pairs.map((p, idx) => duplicatePairHTML(p, idx)).join('')}
            </div>
        `;
    } catch (err) {
        box.innerHTML = `<div style="color:var(--danger);font-size:13px;">Failed to scan for duplicates.</div>`;
    }
}

function duplicatePairHTML(pair, idx) {
    const badgeColor = pair.similarity >= 90 ? 'status-inactive' : pair.similarity >= 75 ? 'type-badge' : 'status-active';
    return `
        <div style="border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:12px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span class="status-badge ${badgeColor}">${pair.similarity}% similar</span>
                <span style="font-size:11px;color:var(--muted);">${escapeHtml(pair.a.chapter || 'Uncategorized')}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                ${duplicateSideHTML(pair.a)}
                ${duplicateSideHTML(pair.b)}
            </div>
        </div>
    `;
}

function duplicateSideHTML(q) {
    return `
        <div style="background:var(--surface);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:10px;font-size:12px;">
            <div style="color:var(--text);margin-bottom:8px;max-height:70px;overflow-y:auto;">${escapeHtml(q.questionText || '')}</div>
            <div style="color:var(--muted);font-size:11px;margin-bottom:8px;">${q.marks || 1} mark(s) · ${escapeHtml(q.difficulty || 'medium')} · ${q.createdAt ? new Date(q.createdAt).toLocaleDateString() : ''}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm" onclick="editQuestion('${q._id}')" title="Edit"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-gold btn-sm" onclick="mergeKeepThisDeleteOther('${q._id}')" title="Keep this one, delete the other side of the pair"><i class="fas fa-code-merge"></i> Keep This</button>
            </div>
        </div>
    `;
}

// "Merge" here means: keep this question, delete the other side of the
// pair it was compared against. Deliberately not doing a field-by-field
// auto-merge (combining explanations/tags from both) — for question text
// specifically, a human picking the better-worded version is safer than
// software silently splicing two versions together.
async function mergeKeepThisDeleteOther(keepId) {
    if (!confirm('Keep this question and delete the other one in the pair? This cannot be undone.')) return;
    // Find the pair containing keepId from the last rendered scan results.
    const pair = (window._lastDuplicatePairs || []).find(p => p.a._id === keepId || p.b._id === keepId);
    const deleteId = pair ? (pair.a._id === keepId ? pair.b._id : pair.a._id) : null;
    if (!deleteId) { showToast('Error', 'Could not determine which question to delete — try re-scanning.', 'error'); return; }
    await apiCall(`/questions/${deleteId}`, { method: 'DELETE' });
    showToast('Merged', 'Duplicate removed, kept the selected question.', 'success');
    runDuplicateScan();
}

async function deleteDuplicateAndRescan(id) {
    if (!confirm('Delete this question? This cannot be undone.')) return;
    await apiCall(`/questions/${id}`, { method: 'DELETE' });
    showToast('Deleted', 'Question removed.', 'success');
    runDuplicateScan();
}

// ============================================================
// ACTIVE FILTER CHIPS
// ============================================================
// One removable chip per active filter — lets an admin see everything
// that's currently narrowing the results at a glance, and drop any single
// one without clearing the whole search.
const FILTER_CHIP_LABELS = {
    q: v => `Search: "${v}"`,
    chapter: v => `Chapter: ${v}`,
    topic: v => `Topic: ${v}`,
    subTopic: v => `Sub Topic: ${v}`,
    book: v => `Book: ${v}`,
    difficulty: v => `Difficulty: ${v}`,
    type: v => `Type: ${v}`,
    marks: v => `Marks: ${v}`,
};

function activeFilterChipsHTML() {
    const s = window._qSearch;
    const chips = [];
    Object.keys(FILTER_CHIP_LABELS).forEach(field => {
        if (s[field]) chips.push({ field, label: FILTER_CHIP_LABELS[field](s[field]) });
    });
    if (window._questionSubjectFilter) {
        const label = window._questionSubjectFilter === 'unassigned'
            ? 'Subject: Unassigned'
            : `Subject: ${(window._subjects || []).find(x => x._id === window._questionSubjectFilter)?.name || '—'}`;
        chips.push({ field: 'subjectFilter', label });
    }
    if (chips.length === 0) return '';
    return `
        <div class="filter-chips">
            ${chips.map(c => `<span class="filter-chip">${escapeHtml(c.label)}<button onclick="removeFilterChip('${c.field}')" title="Remove this filter"><i class="fas fa-times"></i></button></span>`).join('')}
        </div>
    `;
}

function removeFilterChip(field) {
    if (field === 'subjectFilter') {
        filterQuestionsBySubject('');
        return;
    }
    window._qSearch[field] = '';
    window._qSearch.page = 1;
    if (field === 'q') {
        window._aiInterpretedNote = '';
    }
    loadQuestions();
}

// ============================================================
// SAVED SEARCHES
// ============================================================
// Names and stores the CURRENT filter combination (search text +
// advanced filters + subject + sort) so it can be re-applied in one click
// later — e.g. "Class 9 MCQs", "Board PYQs".

function currentSearchFilters() {
    const s = window._qSearch;
    return {
        q: s.q, chapter: s.chapter, topic: s.topic, subTopic: s.subTopic, book: s.book,
        difficulty: s.difficulty, type: s.type, marks: s.marks, sortBy: s.sortBy,
        subjectFilter: window._questionSubjectFilter || '',
    };
}

function hasAnyActiveFilter() {
    const f = currentSearchFilters();
    return Object.values(f).some(v => v);
}

async function saveCurrentSearch() {
    if (!hasAnyActiveFilter()) {
        showToast('Save Search', 'Set a search or filter first, then save it.', 'warning');
        return;
    }
    const name = prompt('Name this search (e.g. "Class 9 MCQs", "Board PYQs"):');
    if (!name || !name.trim()) return;

    const result = await apiCall('/questions/saved-searches', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), filters: currentSearchFilters() })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save search', 'error'); return; }
    showToast('Saved', `"${name.trim()}" saved`, 'success');
    window._savedSearches = [result.data, ...(window._savedSearches || [])];
    renderQuestions();
}

function applySavedSearch(id) {
    const saved = (window._savedSearches || []).find(x => x._id === id);
    if (!saved) return;
    apiCall(`/questions/saved-searches/${id}/use`, { method: 'POST' }).catch(() => {}); // fire-and-forget usage tracking
    const f = saved.filters || {};
    window._qSearch = {
        q: f.q || '', chapter: f.chapter || '', topic: f.topic || '', subTopic: f.subTopic || '',
        book: f.book || '', difficulty: f.difficulty || '', type: f.type || '', marks: f.marks || '',
        sortBy: f.sortBy || '', page: 1, limit: 20, advancedOpen: false,
    };
    window._questionSubjectFilter = f.subjectFilter || '';
    window._aiInterpretedNote = '';
    loadQuestions();
}

async function deleteSavedSearch(id, event) {
    if (event) event.stopPropagation(); // don't also trigger the chip's apply-click
    if (!confirm('Remove this saved search?')) return;
    await apiCall(`/questions/saved-searches/${id}`, { method: 'DELETE' });
    window._savedSearches = (window._savedSearches || []).filter(x => x._id !== id);
    renderQuestions();
}

function savedSearchChipsHTML() {
    const searches = window._savedSearches || [];
    if (searches.length === 0) return '';
    return `
        <div class="filter-chips" style="margin-bottom:6px;">
            ${searches.map(s => `
                <span class="filter-chip saved-search-chip" onclick="applySavedSearch('${s._id}')" title="Apply this saved search">
                    <i class="fas fa-star"></i> ${escapeHtml(s.name)}
                    <button onclick="deleteSavedSearch('${s._id}', event)" title="Remove"><i class="fas fa-times"></i></button>
                </span>
            `).join('')}
        </div>
    `;
}

// ============================================================
// TEXT HIGHLIGHTING
// ============================================================
// Wraps every case-insensitive match of the current search term in
// <mark> inside an already-escaped string. Must run AFTER escapeHtml (so
// it's matching/inserting into safe text, never raw user input) — never
// pass unescaped text in here.
function highlightSearchMatch(escapedText, rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q) return escapedText;
    const escapedQuery = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedQuery) return escapedText;
    return escapedText.replace(new RegExp(escapedQuery, 'gi'), match => `<mark>${match}</mark>`);
}

// "Showing 48 of 3,215 questions" — instant context on how narrow the
// current filters are. shownCount === total when browsing unpaginated
// (no active search/filter); they diverge once pagination kicks in.
function resultCountHTML() {
    const shownCount = allQuestions.length;
    const total = window._questionsTotal ?? shownCount;
    return `<div style="color:var(--muted);font-size:12px;margin-bottom:10px;">Showing ${shownCount.toLocaleString()} of ${total.toLocaleString()} question${total === 1 ? '' : 's'}</div>`;
}

function questionSearchToolbarHTML() {
    const s = window._qSearch;
    return `
        <div class="qsearch-bar">
            <div class="qsearch-input-wrap">
                <i class="fas fa-search"></i>
                <input type="text" id="questionSearchInput" placeholder="Search by Question, ID, Keyword, Option, Tag... or ask AI: 'easy polynomial questions'"
                       title="Ctrl+K to focus · Esc to clear · Enter for top suggestion"
                       value="${escapeHtml(s.q)}" oninput="handleQuestionSearchInput(this.value)"
                       onkeydown="handleQuestionSearchKeydown(event)"
                       onfocus="showRecentSearchesDropdown()"
                       onblur="setTimeout(() => { const b = document.getElementById('questionSearchSuggestions'); if (b) b.style.display='none'; }, 150)">
                ${s.q ? `<button class="qsearch-clear" onclick="clearQuestionSearch()" title="Clear search"><i class="fas fa-times"></i></button>` : ''}
                <div id="questionSearchSuggestions" class="search-suggestions"></div>
            </div>
            <button id="qAiSearchBtn" class="btn btn-secondary btn-sm" onclick="runAiQuestionSearch()" title="Ask in plain English, e.g. 'show hard MCQ of chapter 5'">
                <i class="fas fa-magic"></i> AI Search
            </button>
            <button class="btn btn-secondary btn-sm" onclick="toggleAdvancedFilters()">
                <i class="fas fa-sliders-h"></i> Filters
            </button>
            <button class="btn btn-secondary btn-sm" onclick="showDuplicateScanner()">
                <i class="fas fa-clone"></i> Find Duplicates
            </button>
            <button class="btn btn-secondary btn-sm" onclick="saveCurrentSearch()" title="Save this search combination for one-click reuse">
                <i class="fas fa-star"></i> Save Search
            </button>
            <button class="btn btn-secondary btn-sm" onclick="showSearchAnalytics()" title="Top keywords, zero-result searches, most-used saved searches">
                <i class="fas fa-chart-bar"></i> Search Analytics
            </button>
            <select class="status-filter-select" onchange="changeQuestionsSort(this.value)">
                <option value="">Sort: Default</option>
                <option value="newest" ${s.sortBy === 'newest' ? 'selected' : ''}>Newest first</option>
                <option value="oldest" ${s.sortBy === 'oldest' ? 'selected' : ''}>Oldest first</option>
                <option value="difficulty" ${s.sortBy === 'difficulty' ? 'selected' : ''}>Difficulty</option>
                <option value="marks" ${s.sortBy === 'marks' ? 'selected' : ''}>Marks (high-low)</option>
            </select>
        </div>
        ${savedSearchChipsHTML()}
        ${activeFilterChipsHTML()}
        ${window._aiInterpretedNote ? `
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--gold);margin-bottom:10px;">
            <i class="fas fa-magic"></i> ${escapeHtml(window._aiInterpretedNote)}
            <button class="qsearch-clear" style="position:static;" onclick="window._aiInterpretedNote='';renderQuestions();" title="Dismiss"><i class="fas fa-times"></i></button>
        </div>` : ''}
        ${s.advancedOpen ? `
        <div class="qsearch-advanced">
            <input type="text" id="qfChapter" placeholder="Chapter" value="${escapeHtml(s.chapter)}">
            <input type="text" id="qfBook" placeholder="Book" value="${escapeHtml(s.book)}">
            <input type="text" id="qfTopic" placeholder="Topic" value="${escapeHtml(s.topic)}">
            <input type="text" id="qfSubTopic" placeholder="Sub Topic" value="${escapeHtml(s.subTopic)}">
            <select id="qfDifficulty">
                <option value="">Any Difficulty</option>
                <option value="easy" ${s.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
                <option value="medium" ${s.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="hard" ${s.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
            </select>
            <select id="qfType">
                <option value="">Any Type</option>
                <option value="mcq" ${s.type === 'mcq' ? 'selected' : ''}>MCQ</option>
                <option value="subjective" ${s.type === 'subjective' ? 'selected' : ''}>Subjective</option>
                <option value="true-false" ${s.type === 'true-false' ? 'selected' : ''}>True/False</option>
                <option value="fill-in-blank" ${s.type === 'fill-in-blank' ? 'selected' : ''}>Fill in Blank</option>
                <option value="case-study" ${s.type === 'case-study' ? 'selected' : ''}>Case Study</option>
            </select>
            <input type="number" id="qfMarks" placeholder="Marks" min="0" step="0.5" value="${escapeHtml(String(s.marks))}">
            <button class="btn btn-gold btn-sm" onclick="applyAdvancedFilters()">Apply</button>
        </div>
        ` : ''}
    `;
}

function questionsPaginationHTML() {
    const p = window._questionsPagination;
    if (!p || p.pages <= 1) return '';
    return `
        <div class="qsearch-pagination">
            <button class="btn btn-secondary btn-sm" ${p.page <= 1 ? 'disabled' : ''} onclick="changeQuestionsPage(-1)"><i class="fas fa-chevron-left"></i> Prev</button>
            <span>Page ${p.page} of ${p.pages} &middot; ${p.total} results</span>
            <button class="btn btn-secondary btn-sm" ${p.page >= p.pages ? 'disabled' : ''} onclick="changeQuestionsPage(1)">Next <i class="fas fa-chevron-right"></i></button>
        </div>
    `;
}

function filterQuestionsByStatus() {
    window._questionStatusFilter = document.getElementById('questionStatusFilter').value;
    loadQuestions();
}

// Sets the active subject filter (a subject _id, the 'unassigned' sentinel
// for untagged questions, or '' for all subjects) and keeps the filter
// dropdown in sync — called both from that dropdown and from the subject
// quick-filter chips above the table.
function filterQuestionsBySubject(subjectId) {
    window._questionSubjectFilter = subjectId || '';
    const select = document.getElementById('questionSubjectFilter');
    if (select) select.value = window._questionSubjectFilter;
    loadQuestions();
}

async function transitionQuestionStatus(id, toStatus, label) {
    let note = '';
    if (toStatus === 'draft') {
        // Sending back to Draft (rejecting/unapproving) — worth capturing why.
        note = prompt(`Reason for "${label}" (optional, shown in the question's history):`) || '';
    }
    const result = await apiCall(`/questions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: toStatus, note }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update status', 'error'); return; }
    showToast('Success', result.message, 'success');
    loadQuestions();
}

async function showQuestionHistory(id) {
    const result = await apiCall(`/questions/${id}/history`);
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to load history', 'error'); return; }
    const history = result.data || [];
    const eventLabels = { created: '✨ Created', edited: '✏️ Content Edited', status_change: '🔀 Status Change' };
    showModal('Question History', 'Full change history for this question', `
        ${history.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No history recorded yet.</div>' : `
        <div style="max-height:400px;overflow-y:auto;">
            ${history.map(h => `
                <div style="padding:8px 0;border-bottom:1px solid var(--card-border);">
                    <div style="color:var(--white);font-size:13px;">
                        ${eventLabels[h.event] || h.event}
                        ${h.fromStatus && h.toStatus ? ` — ${QUESTION_STATUS_LABELS[h.fromStatus] || h.fromStatus} → ${QUESTION_STATUS_LABELS[h.toStatus] || h.toStatus}` : ''}
                        ${!h.fromStatus && h.toStatus ? ` — ${QUESTION_STATUS_LABELS[h.toStatus] || h.toStatus}` : ''}
                    </div>
                    ${h.summary ? `<div style="color:var(--muted);font-size:12px;">${escapeHtml(h.summary)}</div>` : ''}
                    ${h.note ? `<div style="color:var(--muted);font-size:12px;font-style:italic;">"${escapeHtml(h.note)}"</div>` : ''}
                    <div style="color:var(--muted);font-size:11px;">${escapeHtml(h.changedByName || 'System')} — ${new Date(h.createdAt).toLocaleString()}</div>
                </div>
            `).join('')}
        </div>
        `}
        <div style="margin-top:14px;text-align:right;"><button class="btn" onclick="closeModal()">Close</button></div>
    `, null);
    // This modal is view-only — hide the default Save button that showModal's footer normally has.
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';
}


// Collects the distinct chapter names already used across the question
// bank so the bulk "Chapter" field can offer autocomplete suggestions.
function suggestChapters() {
    const chapters = new Set();
    allQuestions.forEach(q => {
        const chapter = (q.chapter || '').trim();
        if (chapter && chapter.toLowerCase() !== 'uncategorized') {
            chapters.add(chapter);
        }
    });
    return Array.from(chapters).sort((a, b) => a.localeCompare(b));
}

// ============================================================
// SUBJECT-WISE HELPERS
// ============================================================
// Builds <optgroup>-grouped <option> tags for every active subject,
// grouped by class, for the question bank's subject dropdowns (Add/Edit
// modal, bulk reassignment, filter). Grouping by class disambiguates
// subjects that share the same name across different classes.
function getSubjectOptionsHTML(selectedId) {
    const classes = window._classes || [];
    const subjects = (window._subjects || []).filter(s => s.isActive !== false);
    const classNameFor = (classId) => {
        const cls = classes.find(c => c._id === classId);
        return cls ? (cls.displayName || cls.name) : 'Other';
    };

    const byClass = new Map();
    subjects.forEach(s => {
        const key = s.classId || '';
        if (!byClass.has(key)) byClass.set(key, []);
        byClass.get(key).push(s);
    });

    const orderedClassIds = Array.from(byClass.keys()).sort((a, b) => classNameFor(a).localeCompare(classNameFor(b)));

    return orderedClassIds.map(classId => {
        const subs = byClass.get(classId).slice().sort((a, b) => a.name.localeCompare(b.name));
        return `<optgroup label="${escapeHtml(classNameFor(classId))}">
            ${subs.map(s => `<option value="${s._id}" ${s._id === selectedId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
        </optgroup>`;
    }).join('');
}

// Small "Subject (Class)" label for the question table, or an "Unassigned"
// badge when the question has never been tagged with a subject.
function subjectLabelHTML(q) {
    const subject = q.subjectId ? (window._subjects || []).find(s => s._id === q.subjectId) : null;
    if (!subject) {
        // Subject is unassigned, but the question may still carry its own
        // classId (e.g. after a bulk "Class" update, which intentionally
        // clears subjectId but does set classId) — show that instead of
        // a bare "Unassigned" with no information at all.
        const ownClass = q.classId ? (window._classes || []).find(c => c._id === q.classId) : null;
        return `<span class="status-badge status-unassigned">Unassigned</span>${ownClass ? `<div style="color:var(--muted);font-size:11px;">${escapeHtml(ownClass.displayName || ownClass.name)}</div>` : ''}`;
    }
    const cls = (window._classes || []).find(c => c._id === subject.classId);
    return `${escapeHtml(subject.name)}${cls ? `<div style="color:var(--muted);font-size:11px;">${escapeHtml(cls.displayName || cls.name)}</div>` : ''}`;
}

// Clickable per-subject count chips above the table — the actual
// "manage the bank subject-wise" entry point: click a subject to see
// (and work through) just that subject's questions. Sourced from
// GET /questions/stats/by-subject, cached on window._questionSubjectStats.
function renderSubjectStatsBar() {
    const stats = window._questionSubjectStats || { subjects: [], unassigned: 0 };
    if (stats.subjects.length === 0 && !stats.unassigned) return '';

    const active = window._questionSubjectFilter || '';
    const totalCount = stats.subjects.reduce((sum, s) => sum + s.total, 0) + (stats.unassigned || 0);

    const chip = (id, label, count) => `
        <button class="btn ${active === id ? 'btn-gold' : 'btn-secondary'} btn-sm" style="width:auto;" onclick="filterQuestionsBySubject('${id}')">
            ${escapeHtml(label)} <span style="opacity:0.7;">(${count})</span>
        </button>`;

    return `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
            ${chip('', 'All Subjects', totalCount)}
            ${stats.subjects.map(s => chip(s.subjectId, `${s.subjectName} · ${s.className}`, s.total)).join('')}
            ${stats.unassigned ? chip('unassigned', '⚠️ Unassigned', stats.unassigned) : ''}
        </div>
    `;
}

function renderQuestions() {
    // Clear selection when re-rendering
    selectedQuestionIds.clear();

    // The search box lives inside contentArea, which this function fully
    // replaces (innerHTML) — so a re-render triggered by the debounced
    // search-as-you-type would otherwise yank focus out of the box on
    // every result. Capture and restore it around the re-render.
    const activeEl = document.activeElement;
    const wasSearchFocused = activeEl && activeEl.id === 'questionSearchInput';
    const caretPos = wasSearchFocused ? activeEl.selectionStart : null;

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>❓ Question Bank <span class="count">(${window._questionsTotal ?? allQuestions.length})</span></h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <select id="questionSubjectFilter" class="status-filter-select" onchange="filterQuestionsBySubject(this.value)">
                    <option value="" ${!window._questionSubjectFilter ? 'selected' : ''}>All Subjects</option>
                    <option value="unassigned" ${window._questionSubjectFilter === 'unassigned' ? 'selected' : ''}>⚠️ Unassigned only</option>
                    ${getSubjectOptionsHTML(window._questionSubjectFilter)}
                </select>
                <select id="questionStatusFilter" class="status-filter-select" onchange="filterQuestionsByStatus()">
                    <option value="" ${!window._questionStatusFilter ? 'selected' : ''}>All Statuses</option>
                    <option value="draft" ${window._questionStatusFilter === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="review" ${window._questionStatusFilter === 'review' ? 'selected' : ''}>In Review</option>
                    <option value="approved" ${window._questionStatusFilter === 'approved' ? 'selected' : ''}>Approved</option>
                    <option value="published" ${window._questionStatusFilter === 'published' ? 'selected' : ''}>Published</option>
                    <option value="archived" ${window._questionStatusFilter === 'archived' ? 'selected' : ''}>Archived</option>
                </select>
                <button class="btn btn-gold" onclick="showAddQuestionModal()"><i class="fas fa-plus"></i> Add Question</button>
                <button class="btn btn-secondary" onclick="showBulkAddQuestions()"><i class="fas fa-layer-group"></i> Bulk Add</button>
                <button class="btn btn-success" onclick="showImportModal()"><i class="fas fa-file-upload"></i> Import</button>
            </div>
        </div>

        ${questionSearchToolbarHTML()}

        ${resultCountHTML()}

        ${renderSubjectStatsBar()}

        <!-- Bulk Actions Bar - Improved -->
<div class="bulk-actions-bar" id="bulkActionsBar">
    <div class="bulk-actions-left">
        <span class="selected-count">
            <i class="fas fa-check-circle" style="color:var(--gold);"></i>
            <span id="selectedCount">0</span> questions selected
        </span>
    </div>
    <div class="bulk-actions-right">
        <div class="bulk-field-group">
            <select id="bulkFieldSelect" class="bulk-select">
                <option value="">Update Field...</option>
                <option value="chapter">📚 Chapter</option>
                <option value="marks">⭐ Marks</option>
                <option value="type">📝 Question Type</option>
                <option value="subject">📖 Subject</option>
                <option value="classId">🏫 Class</option>
            </select>
            
            <input type="text" id="bulkFieldValue" placeholder="Enter new value..." style="display:none;">
            
            <select id="bulkFieldSelectValue" style="display:none;">
                <option value="">Select type...</option>
                <option value="mcq">MCQ</option>
                <option value="subjective">Subjective</option>
                <option value="true-false">True/False</option>
                <option value="fill-in-blank">Fill in Blank</option>
                <option value="case-study">Case Study</option>
            </select>

            <select id="bulkFieldSubjectSelect" class="bulk-select" style="display:none;">
                <option value="">Select subject...</option>
            </select>

            <select id="bulkFieldClassSelect" class="bulk-select" style="display:none;">
                <option value="">Select class...</option>
            </select>
        </div>
        
        <div class="bulk-actions-buttons">
            ${hasPermission('questions:approve') ? `
            <button class="btn btn-bulk-approve btn-sm" onclick="bulkApproveQuestions()">
                <i class="fas fa-check-double"></i> Approve
            </button>` : ''}
            <button class="btn btn-bulk-update btn-sm" onclick="bulkUpdateQuestions()">
                <i class="fas fa-check"></i> Apply
            </button>
            <button class="btn btn-bulk-delete btn-sm" onclick="bulkDeleteQuestions()">
                <i class="fas fa-trash"></i> Delete
            </button>
            <button class="btn btn-bulk-clear btn-sm" onclick="clearSelection()">
                <i class="fas fa-times"></i> Clear
            </button>
        </div>
    </div>
</div>

        ${allQuestions.length === 0 ? `
            <div class="empty-state"><span class="icon">❓</span><strong>No Questions</strong><p>Click "Add Question" to create your first question.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px;">
                                <div class="select-all-cell">
                                    <input type="checkbox" class="table-checkbox" id="selectAllQuestions" onchange="toggleSelectAll()">
                                    <label class="select-all-label" for="selectAllQuestions">All</label>
                                </div>
                            </th>
                            <th style="width:50px;">#</th>
                            <th>Question</th>
                            <th style="width:140px;">Subject</th>
                            <th style="width:120px;">Chapter</th>
                            <th style="width:70px;">Marks</th>
                            <th style="width:100px;">Type</th>
                            <th style="width:90px;">Difficulty</th>
                            <th style="width:110px;">Status</th>
                            <th style="width:200px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="questionsTableBody">
                        ${allQuestions.map((q, index) => {
                            const isChecked = selectedQuestionIds.has(q._id);
                            return `
                                <tr>
                                    <td style="text-align:center;">
                                        <input type="checkbox" class="table-checkbox question-checkbox" 
                                               data-id="${q._id}" ${isChecked ? 'checked' : ''} 
                                               onchange="toggleQuestionSelect('${q._id}')">
                                    </td>
                                    <td>${index + 1}</td>
                                    <td onclick="openQuestionPreview('${q._id}')" style="cursor:pointer;" title="Click to preview">${highlightSearchMatch(escapeHtml(q.questionText || '').substring(0, 80), window._qSearch?.q)}${(q.questionText || '').length > 80 ? '...' : ''}</td>
                                    <td>${subjectLabelHTML(q)}</td>
                                    <td>${escapeHtml((q.chapter && q.chapter.trim()) || 'Uncategorized')}</td>
                                    <td>${q.marks || 1}</td>
                                    <td><span class="status-badge type-badge">${escapeHtml(q.type || 'mcq')}</span></td>
                                    <td><span class="status-badge ${q.difficulty === 'hard' ? 'status-inactive' : q.difficulty === 'easy' ? 'status-active' : 'type-badge'}">${escapeHtml(q.difficulty || 'medium')}</span></td>
                                    <td><span class="status-badge status-${q.status || 'draft'}">${QUESTION_STATUS_LABELS[q.status || 'draft']}</span></td>
                                    <td>
                                        <div class="actions">
                                            <button class="btn btn-success btn-sm" onclick="editQuestion('${q._id}')" title="Edit">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                            ${(q.availableTransitions || []).map(t => `
                                                <button class="btn btn-sm" onclick="transitionQuestionStatus('${q._id}', '${t.to}', '${escapeHtml(t.label)}')" title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</button>
                                            `).join('')}
                                            <button class="btn btn-sm" onclick="showQuestionHistory('${q._id}')" title="History">
                                                <i class="fas fa-history"></i>
                                            </button>
                                            <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q._id}')" title="Delete">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${questionsPaginationHTML()}
        `}
    `;
    
    updateBulkActionsBar();

    if (wasSearchFocused) {
        const input = document.getElementById('questionSearchInput');
        if (input) {
            input.focus();
            if (caretPos !== null) input.setSelectionRange(caretPos, caretPos);
        }
    }
}

// ============================================================
// BULK SELECTION FUNCTIONS
// ============================================================

function toggleQuestionSelect(id) {
    if (selectedQuestionIds.has(id)) {
        selectedQuestionIds.delete(id);
    } else {
        selectedQuestionIds.add(id);
    }
    updateBulkActionsBar();
    updateSelectAllState();
}

function toggleSelectAll() {
    const checkbox = document.getElementById('selectAllQuestions');
    if (checkbox.checked) {
        allQuestions.forEach(q => selectedQuestionIds.add(q._id));
    } else {
        selectedQuestionIds.clear();
    }
    document.querySelectorAll('.question-checkbox').forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateBulkActionsBar();
}

function updateSelectAllState() {
    const checkboxes = document.querySelectorAll('.question-checkbox');
    const checkedCount = document.querySelectorAll('.question-checkbox:checked').length;
    const selectAll = document.getElementById('selectAllQuestions');
    if (!selectAll) return;
    
    if (checkboxes.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
    }
    
    if (checkedCount === checkboxes.length) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
    } else if (checkedCount === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else {
        selectAll.checked = false;
        selectAll.indeterminate = true;
    }
}

function clearSelection() {
    selectedQuestionIds.clear();
    document.querySelectorAll('.question-checkbox').forEach(cb => cb.checked = false);
    const selectAll = document.getElementById('selectAllQuestions');
    if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    }
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = selectedQuestionIds.size;
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = count;
    
    if (bar) {
        if (count > 0) {
            bar.classList.add('active');
        } else {
            bar.classList.remove('active');
        }
    }
}

// ============================================================
// BULK UPDATE FIELD SELECTOR
// ============================================================
// NOTE: the bulk-actions bar (and its #bulkFieldSelect dropdown) is
// re-created every time renderQuestions() runs (its markup is injected
// via innerHTML), so a one-time DOMContentLoaded listener would only
// ever attach to the very first copy of the element - and since the
// Questions section isn't the default view, that element doesn't even
// exist yet when DOMContentLoaded fires. We use event delegation on
// `document` instead, which keeps working no matter how many times the
// section is re-rendered.
document.addEventListener('change', function(e) {
    if (!e.target || e.target.id !== 'bulkFieldSelect') return;

    const fieldSelect = e.target;
    const textInput = document.getElementById('bulkFieldValue');
    const selectInput = document.getElementById('bulkFieldSelectValue');
    const subjectSelect = document.getElementById('bulkFieldSubjectSelect');
    const classSelect = document.getElementById('bulkFieldClassSelect');
    const value = fieldSelect.value;

    // Reset visibility
    if (textInput) {
        textInput.style.display = 'none';
        textInput.value = '';
        textInput.removeAttribute('list');
        textInput.type = 'text';
    }
    if (selectInput) {
        selectInput.style.display = 'none';
        selectInput.value = '';
    }
    if (subjectSelect) {
        subjectSelect.style.display = 'none';
        subjectSelect.innerHTML = '<option value="">Select subject...</option>';
    }
    if (classSelect) {
        classSelect.style.display = 'none';
        classSelect.innerHTML = '<option value="">Select class...</option>';
    }

    if (value === 'type') {
        if (selectInput) {
            selectInput.style.display = 'inline-block';
        }
    } else if (value === 'chapter') {
        if (textInput) {
            textInput.style.display = 'inline-block';
            textInput.placeholder = 'Type chapter name or select from suggestions...';

            // Create datalist for auto-suggest
            const datalistId = 'chapterSuggestions';
            let datalist = document.getElementById(datalistId);
            if (!datalist) {
                datalist = document.createElement('datalist');
                datalist.id = datalistId;
                document.body.appendChild(datalist);
            }

            // Update suggestions from existing questions
            const chapters = suggestChapters();
            datalist.innerHTML = chapters.map(c =>
                `<option value="${escapeHtml(c)}">`
            ).join('');

            // If no chapters exist, add default options
            if (chapters.length === 0) {
                datalist.innerHTML = `
                    <option value="Chapter 1">Chapter 1</option>
                    <option value="Chapter 2">Chapter 2</option>
                    <option value="Chapter 3">Chapter 3</option>
                    <option value="Chapter 4">Chapter 4</option>
                    <option value="Chapter 5">Chapter 5</option>
                    <option value="Uncategorized">Uncategorized</option>
                `;
            }

            textInput.setAttribute('list', datalistId);
        }
    } else if (value === 'marks') {
        if (textInput) {
            textInput.style.display = 'inline-block';
            textInput.placeholder = 'Enter marks (e.g., 1, 2, 5)';
            textInput.type = 'number';
            textInput.min = '1';
            textInput.max = '10';
        }
    } else if (value === 'subject') {
        if (subjectSelect) {
            subjectSelect.style.display = 'inline-block';
            subjectSelect.innerHTML = '<option value="">Select subject...</option>' + getSubjectOptionsHTML('');
        }
    } else if (value === 'classId') {
        if (classSelect) {
            classSelect.style.display = 'inline-block';
            const classes = window._classes || [];
            classSelect.innerHTML = '<option value="">Select class...</option>' +
                classes.map(c => `<option value="${c._id}">${escapeHtml(c.displayName || c.name)}</option>`).join('');
        }
    } else if (value) {
        if (textInput) {
            textInput.style.display = 'inline-block';
            textInput.placeholder = `Enter new ${value}...`;
        }
    }
});

async function bulkUpdateQuestions() {
    const fieldSelect = document.getElementById('bulkFieldSelect');
    const textInput = document.getElementById('bulkFieldValue');
    const selectInput = document.getElementById('bulkFieldSelectValue');
    const subjectSelect = document.getElementById('bulkFieldSubjectSelect');
    const classSelect = document.getElementById('bulkFieldClassSelect');
    
    const field = fieldSelect ? fieldSelect.value : '';
    let value = textInput ? textInput.value.trim() : '';
    const selectValue = selectInput ? selectInput.value : '';
    const subjectValue = subjectSelect ? subjectSelect.value : '';
    const classValue = classSelect ? classSelect.value : '';
    
    if (field === 'type') {
        value = selectValue;
    } else if (field === 'subject') {
        value = subjectValue;
    } else if (field === 'classId') {
        value = classValue;
    }
    
    if (!field || !value) {
        showToast('Error', 'Please select a field and enter a value', 'error');
        return;
    }
    
    if (selectedQuestionIds.size === 0) {
        showToast('Error', 'No questions selected', 'error');
        return;
    }
    
    // For subject/class reassignment, show the name (not the raw id) in
    // the confirmation prompt.
    let confirmValue = value;
    if (field === 'subject') {
        confirmValue = (window._subjects || []).find(s => s._id === value)?.name || value;
    } else if (field === 'classId') {
        const cls = (window._classes || []).find(c => c._id === value);
        confirmValue = cls ? (cls.displayName || cls.name) : value;
    }
    const confirmMessage = field === 'classId'
        ? `Are you sure you want to move ${selectedQuestionIds.size} questions to ${confirmValue}?\n\nTheir Subject will be cleared (set to Unassigned) since it may not belong to this class — reassign it afterwards from the Subject filter or a bulk Subject update.`
        : `Are you sure you want to update ${selectedQuestionIds.size} questions?\n\nField: ${field}\nNew Value: ${confirmValue}`;
    if (!confirm(confirmMessage)) {
        return;
    }
    
    const ids = Array.from(selectedQuestionIds);
    const updates = ids.map(id => {
        const update = { id };
        if (field === 'subject') {
            update.subjectId = value;
        } else if (field === 'classId') {
            update.classId = value;
        } else {
            update[field] = field === 'marks' ? parseFloat(value) : value;
        }
        return update;
    });
    
    try {
        const response = await apiCall('/questions/bulk-update', {
            method: 'POST',
            body: JSON.stringify({ updates })
        });
        
        if (response && response.success) {
            const changedCount = response.data?.changed ?? 0;
            if (changedCount === 0) {
                // Request succeeded but nothing actually matched/changed —
                // most likely an _id mismatch between frontend and DB.
                showToast('Warning', 'Server said 0 questions were changed. Check that question IDs match the database.', 'error');
            } else {
                showToast('Success', `${changedCount} questions updated`, 'success');
            }
            // Clear selection and reset dropdowns
            clearSelection();
            if (fieldSelect) fieldSelect.value = '';
            if (textInput) { textInput.value = ''; textInput.style.display = 'none'; }
            if (selectInput) { selectInput.value = ''; selectInput.style.display = 'none'; }
            if (subjectSelect) { subjectSelect.value = ''; subjectSelect.style.display = 'none'; }
            loadQuestions();
        } else {
            // response is null (network/parse error already toasted inside
            // apiCall) or the server explicitly returned success:false —
            // always surface that to the user instead of failing silently.
            if (response) {
                showToast('Error', response.message || 'Failed to update questions', 'error');
            }
        }
    } catch (error) {
        showToast('Error', error.message || 'Failed to update questions', 'error');
    }
}

// ============================================================
// BULK DELETE FUNCTION
// ============================================================

async function bulkDeleteQuestions() {
    if (selectedQuestionIds.size === 0) {
        showToast('Error', 'No questions selected', 'error');
        return;
    }
    
    if (!confirm(`⚠️ Are you sure you want to DELETE ${selectedQuestionIds.size} questions?\n\nThis action CANNOT be undone!`)) {
        return;
    }
    
    if (!confirm(`Final confirmation: Delete ${selectedQuestionIds.size} questions permanently?`)) {
        return;
    }
    
    const ids = Array.from(selectedQuestionIds);
    
    try {
        const response = await apiCall('/questions/bulk-delete', {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
        
        if (response && response.success) {
            showToast('Success', `${response.data?.deleted || ids.length} questions deleted`, 'success');
            clearSelection();
            loadQuestions();
        } else if (response) {
            showToast('Error', response.message || 'Failed to delete questions', 'error');
        }
    } catch (error) {
        showToast('Error', error.message || 'Failed to delete questions', 'error');
    }
}

// ============================================================
// BULK APPROVE FUNCTION
// ============================================================
// Moves every selected question currently "In Review" to "Approved" in one
// go. Questions in any other status are left alone — the server reports how
// many were skipped and why, since silently no-op'ing on the rest of the
// selection would be confusing.

async function bulkApproveQuestions() {
    if (selectedQuestionIds.size === 0) {
        showToast('Error', 'No questions selected', 'error');
        return;
    }

    if (!confirm(`Approve ${selectedQuestionIds.size} selected question(s)?\n\nOnly questions currently "In Review" will move to "Approved" — others will be skipped.`)) {
        return;
    }

    const ids = Array.from(selectedQuestionIds);

    try {
        const response = await apiCall('/questions/bulk-approve', {
            method: 'PUT',
            body: JSON.stringify({ ids })
        });

        if (response && response.success) {
            showToast('Success', response.message, response.data?.skipped?.length ? 'warning' : 'success');
            clearSelection();
            loadQuestions();
        } else if (response) {
            showToast('Error', response.message || 'Failed to approve questions', 'error');
        }
    } catch (error) {
        showToast('Error', error.message || 'Failed to approve questions', 'error');
    }
}

// ============================================================
// KEYBOARD SHORTCUTS FOR BULK ACTIONS
// ============================================================
document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isTypingContext = active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
    );
    const modalIsOpen = document.getElementById('modalOverlay').classList.contains('active');

    // Ctrl+A - Select all (only when not typing anywhere, e.g. inside the
    // rich text editor, and not while a modal is open)
    if (e.ctrlKey && e.key === 'a') {
        if (isTypingContext || modalIsOpen) return;
        e.preventDefault();
        const selectAll = document.getElementById('selectAllQuestions');
        if (selectAll) {
            selectAll.checked = true;
            toggleSelectAll();
        }
    }
    
    // Escape - Clear selection / close modal
    if (e.key === 'Escape') {
        if (modalIsOpen) {
            closeModal();
        } else if (selectedQuestionIds.size > 0) {
            clearSelection();
            showToast('Selection Cleared', '', 'info');
        }
    }
    
    // Delete key - Bulk delete (never while typing or with a modal open)
    if (e.key === 'Delete' && selectedQuestionIds.size > 0) {
        if (isTypingContext || modalIsOpen) return;
        e.preventDefault();
        bulkDeleteQuestions();
    }
});

// ============================================================
// RICH TEXT EDITOR FUNCTIONS (keep existing)
// ============================================================
function richEditorHTML(id, placeholder, initialContent) {
    initialContent = initialContent || '';
    const symbols = ['±','×','÷','≠','≈','≤','≥','∞','√','∑','∫','π','α','β','γ','Δ','θ','λ','μ','σ','φ','ω','Ω','°','½','¼','¾','→','←','↔','⇒','∈','∉','⊂','∪','∩','∅','∴','∵','∝','⊥','∠','′','″','·','…'];
    const equations = [
        { label: 'a⁄b', type: 'fraction', title: 'Fraction' },
        { label: '√x', type: 'sqrt', title: 'Square root' },
        { label: 'xⁿ', type: 'power', title: 'Power / exponent' },
        { label: 'xₙ', type: 'sub', title: 'Subscript index' },
        { label: '∑', type: 'sum', title: 'Summation' },
        { label: '∫', type: 'integral', title: 'Integral' }
    ];
    return `
        <div class="rich-editor">
            <div class="rich-editor-toolbar">
                <button type="button" title="Bold" onmousedown="event.preventDefault()" onclick="execFormat('${id}','bold')"><i class="fas fa-bold"></i></button>
                <button type="button" title="Italic" onmousedown="event.preventDefault()" onclick="execFormat('${id}','italic')"><i class="fas fa-italic"></i></button>
                <button type="button" title="Underline" onmousedown="event.preventDefault()" onclick="execFormat('${id}','underline')"><i class="fas fa-underline"></i></button>
                <span class="sep"></span>
                <button type="button" title="Bullet list" onmousedown="event.preventDefault()" onclick="execFormat('${id}','insertUnorderedList')"><i class="fas fa-list-ul"></i></button>
                <button type="button" title="Numbered list" onmousedown="event.preventDefault()" onclick="execFormat('${id}','insertOrderedList')"><i class="fas fa-list-ol"></i></button>
                <span class="sep"></span>
                <button type="button" title="Superscript" onmousedown="event.preventDefault()" onclick="execFormat('${id}','superscript')"><i class="fas fa-superscript"></i></button>
                <button type="button" title="Subscript" onmousedown="event.preventDefault()" onclick="execFormat('${id}','subscript')"><i class="fas fa-subscript"></i></button>
                <span class="sep"></span>
                <button type="button" title="Insert link" onmousedown="event.preventDefault()" onclick="insertRichLink('${id}')"><i class="fas fa-link"></i></button>
                <button type="button" title="Insert image" onmousedown="event.preventDefault()" onclick="insertRichImage('${id}')"><i class="fas fa-image"></i></button>
                <button type="button" title="Insert table" onmousedown="event.preventDefault()" onclick="insertRichTable('${id}')"><i class="fas fa-table"></i></button>
                <span class="sep"></span>
                <div class="rich-popup-wrap">
                    <button type="button" title="Insert equation" onmousedown="event.preventDefault()" onclick="toggleRichPopup('${id}_eqPopup', this)">∑</button>
                    <div class="rich-popup" id="${id}_eqPopup">
                        <div class="rich-popup-label">Equation templates</div>
                        <div class="rich-popup-grid cols-3">
                            ${equations.map(e => `<button type="button" title="${e.title}" onmousedown="event.preventDefault()" onclick="insertRichEquation('${id}','${e.type}')">${e.label}</button>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="rich-popup-wrap">
                    <button type="button" title="Insert symbol" onmousedown="event.preventDefault()" onclick="toggleRichPopup('${id}_symPopup', this)">Ω</button>
                    <div class="rich-popup" id="${id}_symPopup">
                        <div class="rich-popup-label">Symbols</div>
                        <div class="rich-popup-grid">
                            ${symbols.map(s => `<button type="button" onmousedown="event.preventDefault()" onclick="insertRichSymbol('${id}','${s}')">${s}</button>`).join('')}
                        </div>
                    </div>
                </div>
                <span class="sep"></span>
                <button type="button" title="Clear formatting" onmousedown="event.preventDefault()" onclick="execFormat('${id}','removeFormat')"><i class="fas fa-eraser"></i></button>
            </div>
            <div class="rich-editor-content" id="${id}" contenteditable="true" data-placeholder="${placeholder}">${initialContent}</div>
        </div>
    `;
}

function execFormat(id, command) {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus();
    document.execCommand(command, false, null);
}

function insertRichLink(id) {
    const url = prompt('Enter URL:');
    if (!url) return;
    const el = document.getElementById(id);
    el.focus();
    document.execCommand('createLink', false, url);
}

function insertRichImage(id) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const el = document.getElementById(id);
            el.focus();
            document.execCommand('insertImage', false, e.target.result);
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function getRichEditorContent(id) {
    const el = document.getElementById(id);
    return el ? el.innerHTML.trim() : '';
}

function toggleRichPopup(popupId, btnEl) {
    const popup = document.getElementById(popupId);
    if (!popup) return;
    const wasOpen = popup.classList.contains('open');
    document.querySelectorAll('.rich-popup.open').forEach(p => p.classList.remove('open'));
    if (wasOpen) return;

    popup.classList.add('open');
    if (btnEl) {
        const rect = btnEl.getBoundingClientRect();
        popup.style.top = (rect.bottom + 6) + 'px';
        popup.style.left = rect.left + 'px';
        requestAnimationFrame(() => {
            const pRect = popup.getBoundingClientRect();
            let left = parseFloat(popup.style.left);
            let top = parseFloat(popup.style.top);
            if (pRect.right > window.innerWidth - 8) {
                left = Math.max(8, window.innerWidth - pRect.width - 8);
            }
            if (pRect.bottom > window.innerHeight - 8) {
                top = Math.max(8, rect.top - pRect.height - 6);
            }
            popup.style.left = left + 'px';
            popup.style.top = top + 'px';
        });
    }
}

document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.rich-popup-wrap')) {
        document.querySelectorAll('.rich-popup.open').forEach(p => p.classList.remove('open'));
    }
});

function insertRichSymbol(id, symbol) {
    const el = document.getElementById(id);
    el.focus();
    document.execCommand('insertText', false, symbol);
}

function insertRichTable(id) {
    const rowsStr = prompt('Number of rows:', '2');
    if (!rowsStr) return;
    const colsStr = prompt('Number of columns:', '2');
    if (!colsStr) return;
    const rows = Math.max(1, Math.min(20, parseInt(rowsStr) || 2));
    const cols = Math.max(1, Math.min(10, parseInt(colsStr) || 2));
    let html = '<table>';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
            html += r === 0 ? '<th>Header</th>' : '<td>Cell</td>';
        }
        html += '</tr>';
    }
    html += '</table><p><br></p>';
    const el = document.getElementById(id);
    el.focus();
    document.execCommand('insertHTML', false, html);
}

function insertRichEquation(id, type) {
    const el = document.getElementById(id);
    el.focus();
    let html = '';
    switch (type) {
        case 'fraction':
            html = '<span style="display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;font-size:0.85em;line-height:1.15;margin:0 3px;"><span style="border-bottom:1px solid currentColor;padding:0 4px;">a</span><span style="padding:0 4px;">b</span></span>&nbsp;';
            break;
        case 'sqrt':
            html = '√(x)';
            break;
        case 'power':
            html = 'x<sup>n</sup>';
            break;
        case 'sub':
            html = 'x<sub>n</sub>';
            break;
        case 'sum':
            html = '∑<sub>i=1</sub><sup>n</sup>&nbsp;';
            break;
        case 'integral':
            html = '∫<sub>a</sub><sup>b</sup>&nbsp;';
            break;
    }
    if (html) document.execCommand('insertHTML', false, html);
}

// ============================================================
// SHOW ADD QUESTION MODAL
// ============================================================
function showAddQuestionModal() {
    // Pre-select whichever subject is currently filtered/active, so adding
    // a question while browsing a subject's bucket tags it there by default.
    const currentSubjectFilter = (window._questionSubjectFilter && window._questionSubjectFilter !== 'unassigned')
        ? window._questionSubjectFilter : '';

    showModal('Add Question', 'Create a new question with rich text formatting', `
        <div class="form-group">
            <label>Subject *</label>
            <select id="qSubject">
                <option value="">Select subject...</option>
                ${getSubjectOptionsHTML(currentSubjectFilter)}
            </select>
        </div>
        <div class="form-group">
            <label>Question Type *</label>
            <select id="qType">
                ${questionTypeOptionsHTML('mcq')}
            </select>
        </div>
        <div class="form-group">
            <label>Question Text * <span style="color:var(--muted);font-size:11px;">(Bold, Italic, Lists, Links, Images supported)</span></label>
            ${richEditorHTML('qText', 'Type your question here...')}
        </div>
        <div class="form-group">
            <label>Chapter</label>
            <input type="text" id="qChapter" placeholder="e.g., Chapter 1: Real Numbers">
        </div>
        <div class="form-group">
            <label style="color:var(--muted);font-size:12px;">Content Hierarchy (optional — helps with search & filtering)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <input type="text" id="qBook" placeholder="Book">
                <input type="text" id="qTopic" placeholder="Topic">
                <input type="text" id="qSubTopic" placeholder="Sub Topic">
                <input type="text" id="qLearningOutcome" placeholder="Learning Outcome">
            </div>
        </div>
        <div class="form-group">
            <label>Options (one per line, first is correct)</label>
            <textarea id="qOptions" rows="4" placeholder="Option A&#10;Option B&#10;Option C&#10;Option D"></textarea>
            <div style="color:var(--muted);font-size:12px;margin-top:4px;">First option will be marked as correct.</div>
        </div>
        <div class="form-group">
            <label>Marks *</label>
            <input type="number" id="qMarks" value="1">
        </div>
        <div class="form-group">
            <label>Difficulty</label>
            <select id="qDifficulty">
                <option value="easy">Easy</option>
                <option value="medium" selected>Medium</option>
                <option value="hard">Hard</option>
            </select>
        </div>
        <div class="form-group">
            <label>Explanation (Optional - Rich Text)</label>
            ${richEditorHTML('qExplanation', 'Explain the correct answer...')}
        </div>
    `, async () => {
        const subjectId = document.getElementById('qSubject').value;
        const questionText = getRichEditorContent('qText');
        const explanation = getRichEditorContent('qExplanation');
        const chapter = document.getElementById('qChapter').value.trim();
        const optionsText = document.getElementById('qOptions').value.trim();
        const marks = parseInt(document.getElementById('qMarks').value);
        const difficulty = document.getElementById('qDifficulty').value;
        const type = document.getElementById('qType').value || 'mcq';

        if (!questionText || !optionsText) {
            showToast('Error', 'Question and options are required', 'error');
            return;
        }

        const options = optionsText.split('\n').filter(o => o.trim());
        if (options.length < 2) {
            showToast('Error', 'At least 2 options required', 'error');
            return;
        }

        const optionsData = options.map((text, index) => ({
            text: text.trim(),
            isCorrect: index === 0
        }));

        const proceed = await confirmNotDuplicate(questionText, subjectId, chapter);
        if (!proceed) return;

        const result = await apiCall('/questions', {
            method: 'POST',
            body: JSON.stringify({
                questionText: questionText,
                chapter: chapter || 'Uncategorized',
                subjectId: subjectId,
                book: document.getElementById('qBook').value.trim(),
                topic: document.getElementById('qTopic').value.trim(),
                subTopic: document.getElementById('qSubTopic').value.trim(),
                learningOutcome: document.getElementById('qLearningOutcome').value.trim(),
                options: optionsData,
                correctAnswer: options[0].trim(),
                explanation: explanation,
                marks: marks || 1,
                type: type,
                difficulty: difficulty
            })
        });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add question', 'error'); return; }

        showToast('Success', 'Question added with rich text formatting', 'success');
        closeModal();
        loadQuestions();
    });
}

// ============================================================
// EDIT QUESTION
// ============================================================
async function editQuestion(id) {
    const question = allQuestions.find(q => q._id === id);
    if (!question) return;

    showModal('Edit Question', 'Update question with rich text formatting', `
        <div class="form-group">
            <label>Subject *</label>
            <select id="editQSubject">
                <option value="">Select subject...</option>
                ${getSubjectOptionsHTML(question.subjectId || '')}
            </select>
        </div>
        <div class="form-group">
            <label>Question Type *</label>
            <select id="editQType">
                ${questionTypeOptionsHTML(question.type || 'mcq')}
            </select>
        </div>
        <div class="form-group">
            <label>Question Text *</label>
            ${richEditorHTML('editQText', 'Type your question here...', question.questionText || '')}
        </div>
        <div class="form-group">
            <label>Chapter</label>
            <input type="text" id="editQChapter" value="${escapeHtml(question.chapter || '')}">
        </div>
        <div class="form-group">
            <label style="color:var(--muted);font-size:12px;">Content Hierarchy (optional — helps with search & filtering)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <input type="text" id="editQBook" placeholder="Book" value="${escapeHtml(question.book || '')}">
                <input type="text" id="editQTopic" placeholder="Topic" value="${escapeHtml(question.topic || '')}">
                <input type="text" id="editQSubTopic" placeholder="Sub Topic" value="${escapeHtml(question.subTopic || '')}">
                <input type="text" id="editQLearningOutcome" placeholder="Learning Outcome" value="${escapeHtml(question.learningOutcome || '')}">
            </div>
        </div>
        <div class="form-group">
            <label>Options (one per line, first is correct)</label>
            <textarea id="editQOptions" rows="4">${question.options ? question.options.map(o => escapeHtml(o.text)).join('\n') : ''}</textarea>
        </div>
        <div class="form-group">
            <label>Marks *</label>
            <input type="number" id="editQMarks" value="${question.marks || 1}">
        </div>
        <div class="form-group">
            <label>Difficulty</label>
            <select id="editQDifficulty">
                <option value="easy" ${question.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
                <option value="medium" ${!question.difficulty || question.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="hard" ${question.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
            </select>
        </div>
        <div class="form-group">
            <label>Explanation (Optional)</label>
            ${richEditorHTML('editQExplanation', 'Explain the correct answer...', question.explanation || '')}
        </div>
        <div class="form-group">
            <label><input type="checkbox" id="editQActive" ${question.isActive !== false ? 'checked' : ''}> Active</label>
        </div>
    `, async () => {
        const subjectId = document.getElementById('editQSubject').value;
        const questionText = getRichEditorContent('editQText');
        const explanation = getRichEditorContent('editQExplanation');
        const chapter = document.getElementById('editQChapter').value.trim();
        const optionsText = document.getElementById('editQOptions').value.trim();
        const marks = parseInt(document.getElementById('editQMarks').value);
        const difficulty = document.getElementById('editQDifficulty').value;
        const isActive = document.getElementById('editQActive').checked;
        const type = document.getElementById('editQType').value || 'mcq';

        if (!questionText || !optionsText) {
            showToast('Error', 'Question and options are required', 'error');
            return;
        }

        const options = optionsText.split('\n').filter(o => o.trim());
        if (options.length < 2) {
            showToast('Error', 'At least 2 options required', 'error');
            return;
        }

        const optionsData = options.map((text, index) => ({
            text: text.trim(),
            isCorrect: index === 0
        }));

        const proceed = await confirmNotDuplicate(questionText, subjectId, chapter, id);
        if (!proceed) return;

        const result = await apiCall(`/questions/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                questionText: questionText,
                chapter: chapter || 'Uncategorized',
                subjectId: subjectId,
                book: document.getElementById('editQBook').value.trim(),
                topic: document.getElementById('editQTopic').value.trim(),
                subTopic: document.getElementById('editQSubTopic').value.trim(),
                learningOutcome: document.getElementById('editQLearningOutcome').value.trim(),
                options: optionsData,
                correctAnswer: options[0].trim(),
                explanation: explanation,
                marks: marks || 1,
                type: type,
                difficulty: difficulty,
                isActive: isActive
            })
        });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update question', 'error'); return; }

        showToast('Success', 'Question updated with rich text', 'success');
        closeModal();
        loadQuestions();
    });
}

async function deleteQuestion(id) {
    if (!confirm('Delete this question?')) return;
    const result = await apiCall(`/questions/${id}`, { method: 'DELETE' });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to delete question', 'error');
        return;
    }
    showToast('Success', 'Question deleted', 'success');
    loadQuestions();
}

// ============================================================
// BULK ADD QUESTIONS — structured form (one card per MCQ,
// A/B/C/D option inputs, radio button picks the correct one)
// ============================================================
let bulkQuestionIndex = 0;

function bulkOptionRowHTML(qIdx, optIdx, label, isChecked, value) {
    return `
        <div class="bulk-q-option ${isChecked ? 'is-correct' : ''}" id="bulkQ_${qIdx}_opt_${optIdx}_row">
            <input type="radio" name="bulkQ_${qIdx}_correct" value="${optIdx}" ${isChecked ? 'checked' : ''} onchange="updateBulkOptionHighlight(${qIdx})">
            <span class="option-label">${label}</span>
            <input type="text" id="bulkQ_${qIdx}_opt_${optIdx}" placeholder="Option ${label}" value="${escapeHtml(value || '')}">
        </div>
    `;
}

function bulkQuestionCardHTML(qIdx, data) {
    data = data || {};
    const options = data.options || ['', '', '', ''];
    const correct = data.correct !== undefined ? data.correct : 0;
    return `
        <div class="bulk-q-card" id="bulkQCard_${qIdx}" data-index="${qIdx}">
            <div class="bulk-q-card-header">
                <span class="bulk-q-title">Question <span class="bulk-q-num">${qIdx + 1}</span></span>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeBulkQuestionCard(${qIdx})"><i class="fas fa-trash"></i></button>
            </div>
            <div class="form-group">
                <textarea id="bulkQ_${qIdx}_text" rows="2" placeholder="Type the question here...">${escapeHtml(data.text || '')}</textarea>
            </div>
            <div class="bulk-q-options">
                ${['A','B','C','D'].map((label, i) => bulkOptionRowHTML(qIdx, i, label, i === correct, options[i])).join('')}
            </div>
            <div style="color:var(--muted);font-size:11px;margin-top:6px;">
                <i class="fas fa-info-circle"></i> Select the radio button next to the correct option.
            </div>
        </div>
    `;
}

function updateBulkOptionHighlight(qIdx) {
    for (let i = 0; i < 4; i++) {
        const row = document.getElementById(`bulkQ_${qIdx}_opt_${i}_row`);
        const radio = document.querySelector(`input[name="bulkQ_${qIdx}_correct"][value="${i}"]`);
        if (row && radio) row.classList.toggle('is-correct', radio.checked);
    }
}

function renumberBulkQuestions() {
    const cards = document.querySelectorAll('#bulkQuestionsContainer .bulk-q-card');
    cards.forEach((card, i) => {
        const numEl = card.querySelector('.bulk-q-num');
        if (numEl) numEl.textContent = i + 1;
    });
}

function addBulkQuestionCard(data) {
    const container = document.getElementById('bulkQuestionsContainer');
    if (!container) return;
    const idx = bulkQuestionIndex++;
    container.insertAdjacentHTML('beforeend', bulkQuestionCardHTML(idx, data));
    renumberBulkQuestions();
}

function removeBulkQuestionCard(idx) {
    const container = document.getElementById('bulkQuestionsContainer');
    const cards = container ? container.querySelectorAll('.bulk-q-card') : [];
    if (cards.length <= 1) {
        showToast('Error', 'At least one question is required', 'error');
        return;
    }
    const card = document.getElementById(`bulkQCard_${idx}`);
    if (card) card.remove();
    renumberBulkQuestions();
}

function clearBulkQuestions() {
    const container = document.getElementById('bulkQuestionsContainer');
    if (!container) return;
    container.innerHTML = '';
    bulkQuestionIndex = 0;
    addBulkQuestionCard();
    showToast('Cleared', 'Form reset', 'info');
}

function loadBulkSample() {
    const container = document.getElementById('bulkQuestionsContainer');
    if (!container) return;
    container.innerHTML = '';
    bulkQuestionIndex = 0;
    const samples = [
        { text: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct: 1 },
        { text: 'Which of these is a prime number?', options: ['4', '6', '7', '9'], correct: 2 },
        { text: 'What is the capital of India?', options: ['Mumbai', 'Delhi', 'Kolkata', 'Chennai'], correct: 1 }
    ];
    samples.forEach(s => addBulkQuestionCard(s));
    showToast('Sample Loaded', '3 sample questions loaded', 'success');
}

function showBulkAddQuestions() {
    bulkQuestionIndex = 0;
    const currentSubjectFilter = (window._questionSubjectFilter && window._questionSubjectFilter !== 'unassigned')
        ? window._questionSubjectFilter : '';

    showModal('📝 Bulk Add Questions', 'Fill in as many MCQs as you like, then save them all at once', `
        <div class="form-row">
            <div class="form-group">
                <label>Subject *</label>
                <select id="bulkSubject">
                    <option value="">Select subject...</option>
                    ${getSubjectOptionsHTML(currentSubjectFilter)}
                </select>
            </div>
            <div class="form-group">
                <label>Chapter *</label>
                <input type="text" id="bulkChapter" placeholder="e.g., Chapter 1: Real Numbers" value="Bulk Import">
            </div>
            <div class="form-group">
                <label>Marks per question</label>
                <input type="number" id="bulkMarks" value="1" min="1">
            </div>
        </div>

        <div id="bulkQuestionsContainer" class="bulk-q-list"></div>

        <button type="button" class="bulk-add-question-btn" onclick="addBulkQuestionCard()">
            <i class="fas fa-plus"></i> Add Another Question
        </button>

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" onclick="loadBulkSample()" style="width:auto;background:rgba(79,110,247,0.1);color:var(--gold);">
                <i class="fas fa-file-import"></i> Load Sample
            </button>
            <button class="btn btn-secondary" onclick="clearBulkQuestions()" style="width:auto;color:var(--muted);">
                <i class="fas fa-eraser"></i> Clear All
            </button>
        </div>
    `, async () => {
        const subjectId = document.getElementById('bulkSubject').value;
        const chapter = document.getElementById('bulkChapter').value.trim();
        const marks = parseInt(document.getElementById('bulkMarks').value) || 1;

        if (!subjectId || !chapter) {
            showToast('Error', 'Subject and chapter are required', 'error');
            return;
        }

        const cards = document.querySelectorAll('#bulkQuestionsContainer .bulk-q-card');
        if (cards.length === 0) {
            showToast('Error', 'Add at least one question', 'error');
            return;
        }

        const questionsToSubmit = [];
        const incompleteNumbers = [];

        cards.forEach((card, displayIdx) => {
            const idx = card.dataset.index;
            const textEl = document.getElementById(`bulkQ_${idx}_text`);
            const questionText = textEl ? textEl.value.trim() : '';
            const optionTexts = [0, 1, 2, 3].map(i => {
                const el = document.getElementById(`bulkQ_${idx}_opt_${i}`);
                return el ? el.value.trim() : '';
            });
            const correctRadio = document.querySelector(`input[name="bulkQ_${idx}_correct"]:checked`);
            const correctIdx = correctRadio ? parseInt(correctRadio.value) : 0;
            const hasAllOptions = optionTexts.every(t => t.length > 0);

            if (!questionText || !hasAllOptions) {
                incompleteNumbers.push(displayIdx + 1);
                return;
            }

            const optionsData = optionTexts.map((text, i) => ({ text, isCorrect: i === correctIdx }));
            questionsToSubmit.push({
                questionText,
                chapter,
                subjectId,
                options: optionsData,
                correctAnswer: optionTexts[correctIdx],
                marks,
                type: 'mcq'
            });
        });

        if (incompleteNumbers.length > 0) {
            showToast('Error', `Question ${incompleteNumbers.join(', ')} ${incompleteNumbers.length > 1 ? 'are' : 'is'} incomplete — fill in the question text and all 4 options.`, 'error');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        for (const q of questionsToSubmit) {
            try {
                const res = await apiCall('/questions', { method: 'POST', body: JSON.stringify(q) });
                if (res && res.success !== false) successCount++;
                else errorCount++;
            } catch (e) {
                errorCount++;
            }
        }

        if (successCount > 0) {
            showToast('Success', `${successCount} question${successCount > 1 ? 's' : ''} added${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
            closeModal();
            loadQuestions();
        } else {
            showToast('Error', 'Failed to add questions', 'error');
        }
    });

    // Start with one empty question card
    addBulkQuestionCard();
}

// ============================================================
// IMPORT QUESTIONS MODAL
// ============================================================
function showImportModal() {
    const currentSubjectFilter = (window._questionSubjectFilter && window._questionSubjectFilter !== 'unassigned')
        ? window._questionSubjectFilter : '';

    showModal('Import Questions', 'Upload PDF, DOCX, or TXT file to import questions', `
        <div class="form-group">
            <label>Subject <span style="color:var(--muted);font-size:11px;">(tags every imported question — leave blank to assign later)</span></label>
            <select id="importSubject">
                <option value="">No subject yet</option>
                ${getSubjectOptionsHTML(currentSubjectFilter)}
            </select>
        </div>
        <div class="form-group">
            <label>Chapter *</label>
            <input type="text" id="importChapter" placeholder="e.g., Chapter 1: Real Numbers" value="Imported Questions">
        </div>
        <div class="form-group">
            <label>Upload File (PDF, DOCX, TXT) *</label>
            <input type="file" id="importFile" accept=".pdf,.docx,.txt" style="padding:8px;">
            <div style="color:var(--muted);font-size:12px;margin-top:4px;">
                Supported formats: PDF, DOCX, TXT<br>
                File size limit: 10MB
            </div>
        </div>
        <div id="importPreview" style="display:none;margin-top:12px;padding:12px;background:var(--input-bg);border-radius:var(--radius-sm);border:1px solid var(--card-border);max-height:200px;overflow-y:auto;">
            <h4 style="color:var(--gold);font-size:14px;">Preview</h4>
            <div id="importPreviewContent" style="font-size:13px;color:var(--text);white-space:pre-wrap;"></div>
        </div>
        <div style="margin-top:8px;">
            <button class="btn btn-secondary" onclick="previewImport()" style="width:auto;">
                <i class="fas fa-eye"></i> Preview
            </button>
        </div>
    `, async () => {
        const subjectId = document.getElementById('importSubject').value;
        const chapter = document.getElementById('importChapter').value.trim();
        const fileInput = document.getElementById('importFile');
        
        if (!chapter) {
            showToast('Error', 'Chapter name is required', 'error');
            return;
        }
        
        if (!fileInput.files || fileInput.files.length === 0) {
            showToast('Error', 'Please select a file to upload', 'error');
            return;
        }
        
        const file = fileInput.files[0];
        if (file.size > 10 * 1024 * 1024) {
            showToast('Error', 'File size exceeds 10MB limit', 'error');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('chapter', chapter);
        if (subjectId) formData.append('subjectId', subjectId);
        
        const btn = document.querySelector('#modalSaveBtn');
        btn.disabled = true;
        btn.textContent = 'Importing...';
        
        try {
            const response = await fetch('/api/import/questions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                showToast('Success', data.message || 'Questions imported successfully', 'success');
                closeModal();
                loadQuestions();
            } else {
                showToast('Error', data.message || 'Failed to import questions', 'error');
            }
        } catch (error) {
            console.error('Import error:', error);
            showToast('Error', 'Failed to import questions: ' + error.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Save';
        }
    });
}

async function previewImport() {
    const fileInput = document.getElementById('importFile');
    
    if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Error', 'Please select a file', 'error');
        return;
    }
    
    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/import/preview', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            const previewDiv = document.getElementById('importPreview');
            const contentDiv = document.getElementById('importPreviewContent');
            previewDiv.style.display = 'block';
            
            let html = `
                <div><strong>Total Questions Detected:</strong> ${data.data.totalQuestions}</div>
                <div style="margin-top:8px;">
                    <strong>Preview:</strong>
                    <div style="background:rgba(20,30,60,0.03);padding:8px;border-radius:4px;margin-top:4px;font-family:monospace;font-size:12px;max-height:100px;overflow-y:auto;">
                        ${escapeHtml(data.data.preview || 'No preview available')}
                    </div>
                </div>
            `;
            
            if (data.data.tables && data.data.tables.length > 0) {
                html += `<div style="margin-top:8px;"><strong>Tables Detected:</strong> ${data.data.tables.length}</div>`;
            }
            
            if (data.data.images && data.data.images.length > 0) {
                html += `<div style="margin-top:8px;"><strong>Images Detected:</strong> ${data.data.images.length}</div>`;
            }
            
            if (data.data.detectedQuestions && data.data.detectedQuestions.length > 0) {
                html += `<div style="margin-top:8px;"><strong>Sample Questions:</strong>`;
                data.data.detectedQuestions.slice(0, 3).forEach(q => {
                    html += `
                        <div style="background:rgba(20,30,60,0.02);padding:6px;border-radius:4px;margin-top:4px;font-size:12px;">
                            Q${escapeHtml(String(q.questionNumber || '?'))}: ${escapeHtml((q.questionText || '').substring(0, 100))}${q.questionText && q.questionText.length > 100 ? '...' : ''}
                            ${q.options && q.options.length > 0 ? `<br>Options: ${escapeHtml(q.options.map(o => o.text).join(', '))}` : ''}
                        </div>
                    `;
                });
                html += `</div>`;
            }
            
            contentDiv.innerHTML = html;
            showToast('Success', 'Preview generated successfully', 'success');
        } else {
            showToast('Error', data.message || 'Failed to preview', 'error');
        }
    } catch (error) {
        console.error('Preview error:', error);
        showToast('Error', 'Failed to preview file: ' + error.message, 'error');
    }
}
// ============================================================
// RIGHT-SIDE PREVIEW PANEL
// ============================================================
// Click a question in the table to open a fast preview/quick-edit panel
// on the right, instead of the full modal — Overview / Hierarchy / History
// tabs, with an inline Save so small corrections don't need the full
// Edit Question modal.

// The Preview Panel can be opened from either the Question Bank or the AI
// Review Queue (both call openQuestionPreview). Refresh whichever one is
// actually on screen instead of always calling loadQuestions() — that
// would silently swap the AI Review Queue's content out from under the
// admin if the panel was opened from there.
async function refreshQuestionListView() {
    if (window.currentSection === 'ai-review-queue' && typeof window.loadAIReviewQueue === 'function') {
        await window.loadAIReviewQueue();
    } else {
        await loadQuestions();
    }
}

window._previewState = { id: null, tab: 'overview', history: [], analytics: null };

async function openQuestionPreview(id) {
    let question = allQuestions.find(q => q._id === id);
    if (!question) {
        // Not on the currently loaded page (e.g. opened via a stale
        // reference) — fetch it directly instead of failing silently.
        const res = await apiCall(`/questions/${id}`);
        question = res?.data;
    }
    if (!question) { showToast('Error', 'Question not found', 'error'); return; }

    window._previewState = { id, tab: 'overview', history: [], analytics: null };
    renderQuestionPreviewPanel(question);

    const historyRes = await apiCall(`/questions/${id}/history`);
    window._previewState.history = historyRes?.data || [];
    if (window._previewState.id === id) renderQuestionPreviewPanel(question);
}

function closeQuestionPreview() {
    const panel = document.getElementById('qPreviewPanel');
    const backdrop = document.getElementById('qPreviewBackdrop');
    if (panel) panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    window._previewState = { id: null, tab: 'overview', history: [], analytics: null };
}

async function switchPreviewTab(tab) {
    window._previewState.tab = tab;
    const question = allQuestions.find(q => q._id === window._previewState.id);
    if (!question) return;
    if (tab === 'analytics' && !window._previewState.analytics) {
        renderQuestionPreviewPanel(question); // show loading state first
        const res = await apiCall(`/questions/${question._id}/analytics`);
        window._previewState.analytics = res?.data || null;
    }
    renderQuestionPreviewPanel(question);
}

function renderQuestionPreviewPanel(question) {
    let root = document.getElementById('qPreviewRoot');
    if (!root) {
        root = document.createElement('div');
        root.id = 'qPreviewRoot';
        document.body.appendChild(root);
    }
    const s = window._previewState;
    const subject = (window._subjects || []).find(sub => sub._id === question.subjectId);

    root.innerHTML = `
        <div id="qPreviewBackdrop" class="qpreview-backdrop open" onclick="closeQuestionPreview()"></div>
        <div id="qPreviewPanel" class="qpreview-panel open">
            <div class="qpreview-header">
                <h3>Question Preview</h3>
                <button class="qsearch-clear" style="position:static;font-size:16px;" onclick="closeQuestionPreview()"><i class="fas fa-times"></i></button>
            </div>
            <div class="qpreview-tabs">
                <button class="qpreview-tab ${s.tab === 'overview' ? 'active' : ''}" onclick="switchPreviewTab('overview')">Overview</button>
                <button class="qpreview-tab ${s.tab === 'hierarchy' ? 'active' : ''}" onclick="switchPreviewTab('hierarchy')">Hierarchy</button>
                <button class="qpreview-tab ${s.tab === 'analytics' ? 'active' : ''}" onclick="switchPreviewTab('analytics')">Analytics</button>
                <button class="qpreview-tab ${s.tab === 'history' ? 'active' : ''}" onclick="switchPreviewTab('history')">History (${s.history.length})</button>
            </div>
            <div class="qpreview-body">
                ${s.tab === 'overview' ? previewOverviewHTML(question) : ''}
                ${s.tab === 'hierarchy' ? previewHierarchyHTML(question, subject) : ''}
                ${s.tab === 'analytics' ? previewAnalyticsHTML() : ''}
                ${s.tab === 'history' ? previewHistoryHTML(question) : ''}
            </div>
        </div>
    `;
}

function previewOverviewHTML(q) {
    return `
        <div class="form-group">
            <label>Question</label>
            <textarea id="pvQuestionText" rows="3">${escapeHtml(q.questionText || '')}</textarea>
        </div>
        <div class="form-group">
            <label>Options</label>
            <textarea id="pvOptions" rows="4">${(q.options || []).map(o => o.text).join('\n')}</textarea>
        </div>
        <div class="form-group">
            <label>Correct Answer</label>
            <input type="text" id="pvCorrectAnswer" value="${escapeHtml(q.correctAnswer || '')}">
        </div>
        <div class="form-group">
            <label>Explanation</label>
            <textarea id="pvExplanation" rows="2">${escapeHtml(q.explanation || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div class="form-group">
                <label>Difficulty</label>
                <select id="pvDifficulty">
                    <option value="easy" ${q.difficulty === 'easy' ? 'selected' : ''}>Easy</option>
                    <option value="medium" ${!q.difficulty || q.difficulty === 'medium' ? 'selected' : ''}>Medium</option>
                    <option value="hard" ${q.difficulty === 'hard' ? 'selected' : ''}>Hard</option>
                </select>
            </div>
            <div class="form-group">
                <label>Marks</label>
                <input type="number" id="pvMarks" value="${q.marks || 1}">
            </div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">Status: <strong>${escapeHtml(STATUS_LABELS_JS[q.status] || q.status || 'draft')}</strong>${q.generatedByAI ? ' · <i class="fas fa-magic"></i> AI-generated' : ''}</div>
        <button class="btn btn-gold btn-sm" onclick="saveQuestionPreviewQuickEdit('${q._id}')"><i class="fas fa-save"></i> Save Changes</button>
    `;
}

const STATUS_LABELS_JS = { draft: 'Draft', review: 'In Review', approved: 'Approved', published: 'Published', archived: 'Archived' };

function previewHierarchyHTML(q, subject) {
    return `
        <div class="form-group"><label>Class</label><input type="text" disabled value="${escapeHtml((window._classes || []).find(c => c._id === q.classId)?.displayName || (window._classes || []).find(c => c._id === q.classId)?.name || '—')}"></div>
        <div class="form-group"><label>Subject</label><input type="text" disabled value="${escapeHtml(subject?.name || 'Unassigned')}"></div>
        <div class="form-group"><label>Book</label><input type="text" id="pvBook" value="${escapeHtml(q.book || '')}"></div>
        <div class="form-group"><label>Chapter</label><input type="text" id="pvChapter" value="${escapeHtml(q.chapter || '')}"></div>
        <div class="form-group"><label>Topic</label><input type="text" id="pvTopic" value="${escapeHtml(q.topic || '')}"></div>
        <div class="form-group"><label>Sub Topic</label><input type="text" id="pvSubTopic" value="${escapeHtml(q.subTopic || '')}"></div>
        <div class="form-group"><label>Learning Outcome</label><input type="text" id="pvLearningOutcome" value="${escapeHtml(q.learningOutcome || '')}"></div>
        <button class="btn btn-gold btn-sm" onclick="saveQuestionPreviewHierarchy('${q._id}')"><i class="fas fa-save"></i> Save Hierarchy</button>
    `;
}

function previewAnalyticsHTML() {
    const a = window._previewState.analytics;
    if (!a) return `<div style="color:var(--muted);font-size:13px;"><i class="fas fa-spinner fa-spin"></i> Loading analytics...</div>`;
    if (a.timesUsed === 0) {
        return `<div style="color:var(--muted);font-size:13px;">This question hasn't been attempted by any student in a Test yet${a.testsUsedIn > 0 ? ` (used in ${a.testsUsedIn} test(s), no attempts recorded yet)` : ' (not added to any test yet)'}.</div>`;
    }
    return `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div class="analytics-stat"><div class="analytics-stat-value">${a.timesUsed}</div><div class="analytics-stat-label">Times Used</div></div>
            <div class="analytics-stat"><div class="analytics-stat-value">${a.correctPct}%</div><div class="analytics-stat-label">Correct</div></div>
            <div class="analytics-stat"><div class="analytics-stat-value">${a.wrongPct}%</div><div class="analytics-stat-label">Wrong</div></div>
            <div class="analytics-stat"><div class="analytics-stat-value">${a.avgTimeSeconds}s</div><div class="analytics-stat-label">Avg. Time</div></div>
            <div class="analytics-stat"><div class="analytics-stat-value">${a.difficultyIndex}</div><div class="analytics-stat-label">Difficulty Index</div></div>
            <div class="analytics-stat"><div class="analytics-stat-value">${a.testsUsedIn}</div><div class="analytics-stat-label">Tests Used In</div></div>
        </div>
        <div style="color:var(--muted);font-size:11px;">Difficulty Index = % of students who got it wrong (higher = harder). Based on Test attempts only — Practice Mode attempts aren't counted yet.</div>
    `;
}

function previewHistoryHTML(q) {
    const history = window._previewState.history;
    if (history.length === 0) return `<div style="color:var(--muted);font-size:13px;">No history yet.</div>`;
    return history.map(h => `
        <div style="border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:10px;margin-bottom:8px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>${escapeHtml(h.event === 'status_change' ? `${STATUS_LABELS_JS[h.fromStatus] || h.fromStatus} \u2192 ${STATUS_LABELS_JS[h.toStatus] || h.toStatus}` : (h.summary || h.event))}</strong>
                <span style="color:var(--muted);">${h.createdAt ? new Date(h.createdAt).toLocaleString() : ''}</span>
            </div>
            <div style="color:var(--muted);margin-top:4px;">by ${escapeHtml(h.changedByName || 'System')}${h.note ? ` \u2014 ${escapeHtml(h.note)}` : ''}</div>
            ${h.event === 'edited' && h.snapshot ? `<button class="btn btn-sm" style="margin-top:6px;" onclick="restoreQuestionVersion('${q._id}', '${h._id}')"><i class="fas fa-history"></i> Restore this version</button>` : ''}
        </div>
    `).join('');
}

async function saveQuestionPreviewQuickEdit(id) {
    const optionsText = document.getElementById('pvOptions').value.trim();
    const options = optionsText.split('\n').filter(o => o.trim()).map(text => ({ text: text.trim(), isCorrect: text.trim() === document.getElementById('pvCorrectAnswer').value.trim() }));

    const result = await apiCall(`/questions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
            questionText: document.getElementById('pvQuestionText').value.trim(),
            options,
            correctAnswer: document.getElementById('pvCorrectAnswer').value.trim(),
            explanation: document.getElementById('pvExplanation').value.trim(),
            difficulty: document.getElementById('pvDifficulty').value,
            marks: parseInt(document.getElementById('pvMarks').value) || 1,
        })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Question updated', 'success');
    await refreshQuestionListView();
    openQuestionPreview(id);
}

async function saveQuestionPreviewHierarchy(id) {
    const result = await apiCall(`/questions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
            book: document.getElementById('pvBook').value.trim(),
            chapter: document.getElementById('pvChapter').value.trim(),
            topic: document.getElementById('pvTopic').value.trim(),
            subTopic: document.getElementById('pvSubTopic').value.trim(),
            learningOutcome: document.getElementById('pvLearningOutcome').value.trim(),
        })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Hierarchy updated', 'success');
    await refreshQuestionListView();
    openQuestionPreview(id);
}

async function restoreQuestionVersion(id, historyId) {
    if (!confirm('Restore this version? The question will be sent back to Draft for re-review.')) return;
    const result = await apiCall(`/questions/${id}/history/${historyId}/restore`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to restore', 'error'); return; }
    showToast('Restored', result.message || 'Version restored', 'success');
    await refreshQuestionListView();
    openQuestionPreview(id);
}