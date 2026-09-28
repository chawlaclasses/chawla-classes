// public/admin/js/test-builder.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

let builderTestId = null;
let builderTest = null;
let builderQuestions = [];      // testQuestions currently attached, in order
let builderBankQuestions = [];  // full question bank (approved/published only)
let builderSelectedBankIds = new Set();
let builderReorderFromIndex = null;

async function openTestBuilder(testId) {
    showLoading();
    try {
        const [testRes, tqRes, bankRes] = await Promise.all([
            apiCall(`/tests/${testId}/preview`),
            apiCall(`/tests/${testId}/questions`),
            apiCall(`/questions`),
        ]);
        if (!testRes || !testRes.success) {
            showError('Failed to load test', testRes?.message || '');
            return;
        }
        builderTestId = testId;
        builderTest = testRes.data.test;
        builderQuestions = (tqRes?.data || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
        builderBankQuestions = (bankRes?.data || []).filter(q => ['approved', 'published'].includes(q.status || 'draft'));
        builderSelectedBankIds.clear();
        renderTestBuilder();
    } catch (error) {
        showError('Failed to load test builder', error.message);
    }
}

function builderChapterOptions(selected) {
    const chapters = Array.from(new Set(builderBankQuestions.map(q => (q.chapter || '').trim()).filter(Boolean))).sort();
    return `<option value="">All Chapters</option>` +
        chapters.map(c => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function renderTestBuilder() {
    const attachedBankIds = new Set(builderQuestions.map(q => q.bankQuestionId).filter(Boolean));

    contentArea.innerHTML = `
        <div class="builder-header">
            <div>
                <button class="btn btn-secondary btn-sm" onclick="loadTests()"><i class="fas fa-arrow-left"></i> Back to Tests</button>
                <h2 style="margin-top:8px;">🧩 ${escapeHtml(builderTest.title)}</h2>
            </div>
            <div class="builder-summary">
                <span class="badge">Questions: <strong id="builderQCount">${builderQuestions.length}</strong></span>
                <span class="badge">Total Marks: <strong id="builderMarksTotal">${builderQuestions.reduce((s, q) => s + (Number(q.marks) || 0), 0)}</strong></span>
                <span class="badge">Status: <strong>${builderTest.isPublished ? 'Published' : 'Draft'}</strong></span>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" onclick="previewTestBuilder()"><i class="fas fa-eye"></i> Preview</button>
                <button class="btn ${builderTest.isPublished ? 'btn-danger' : 'btn-success'}" onclick="builderTogglePublish()">
                    <i class="fas fa-${builderTest.isPublished ? 'eye-slash' : 'upload'}"></i> ${builderTest.isPublished ? 'Unpublish' : 'Publish'}
                </button>
            </div>
        </div>

        <div class="builder-grid">
            <div class="builder-panel">
                <h3>📚 Question Bank <span class="count">(${builderBankQuestions.length} available)</span></h3>
                <div class="builder-filters">
                    <input type="text" id="builderBankSearch" placeholder="Search question text…" oninput="refreshBuilderBankList()">
                    <select id="builderBankChapter" onchange="refreshBuilderBankList()">${builderChapterOptions('')}</select>
                    <select id="builderBankDifficulty" onchange="refreshBuilderBankList()">
                        <option value="">All Difficulties</option>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-size:12px;color:var(--muted);">Drag a question to the right, or select multiple →</span>
                    <button class="btn btn-gold btn-sm" id="builderAddSelectedBtn" onclick="addSelectedBankQuestions()" disabled>Add Selected (0)</button>
                </div>
                <div class="builder-list" id="builderBankList"
                     ondragover="event.preventDefault();"
                     ondrop="onBuilderDrop(event)"></div>
            </div>

            <div class="builder-panel">
                <h3>📝 Test Questions <span class="count">(${builderQuestions.length})</span></h3>
                <div style="font-size:12px;color:var(--muted);">Drag rows to reorder. Marks total updates automatically.</div>
                <div class="builder-list" id="builderQuestionsList"
                     ondragover="event.preventDefault(); document.getElementById('builderQuestionsList').classList.add('dropzone-active');"
                     ondragleave="document.getElementById('builderQuestionsList').classList.remove('dropzone-active');"
                     ondrop="onBuilderDrop(event)"></div>
            </div>
        </div>

        <div class="builder-random-panel">
            <div class="form-group"><label>🎲 Easy</label><input type="number" id="builderMixEasy" value="0" min="0"></div>
            <div class="form-group"><label>Medium</label><input type="number" id="builderMixMedium" value="0" min="0"></div>
            <div class="form-group"><label>Hard</label><input type="number" id="builderMixHard" value="0" min="0"></div>
            <div class="form-group"><label>Chapter (optional)</label>
                <select id="builderMixChapter">${builderChapterOptions('')}</select>
            </div>
            <button class="btn btn-gold" onclick="addRandomQuestions()"><i class="fas fa-dice"></i> Add Random Questions</button>
        </div>
    `;

    refreshBuilderBankList(attachedBankIds);
    renderBuilderQuestionsList();
}

function refreshBuilderBankList() {
    const search = (document.getElementById('builderBankSearch')?.value || '').toLowerCase().trim();
    const chapter = document.getElementById('builderBankChapter')?.value || '';
    const difficulty = document.getElementById('builderBankDifficulty')?.value || '';
    const attachedBankIds = new Set(builderQuestions.map(q => q.bankQuestionId).filter(Boolean));

    const filtered = builderBankQuestions.filter(q => {
        if (attachedBankIds.has(q._id)) return false;
        if (search && !q.questionText.toLowerCase().includes(search)) return false;
        if (chapter && q.chapter !== chapter) return false;
        if (difficulty && (q.difficulty || 'medium') !== difficulty) return false;
        return true;
    });

    const list = document.getElementById('builderBankList');
    if (!list) return;
    list.innerHTML = filtered.length === 0
        ? `<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">No matching questions. Try clearing filters.</div>`
        : filtered.map(q => `
            <div class="builder-card" draggable="true" ondragstart="onBankDragStart(event, '${q._id}')">
                <input type="checkbox" class="table-checkbox" onchange="toggleBankSelect('${q._id}', this.checked)" ${builderSelectedBankIds.has(q._id) ? 'checked' : ''}>
                <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
                <div class="builder-card-body">
                    <div class="builder-card-text">${escapeHtml(q.questionText)}</div>
                    <div class="builder-card-meta">
                        <span class="diff-chip ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
                        <span style="font-size:10px;color:var(--muted);">${escapeHtml(q.chapter || 'Uncategorized')} · ${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''}</span>
                    </div>
                </div>
            </div>
        `).join('');
}

function toggleBankSelect(id, checked) {
    if (checked) builderSelectedBankIds.add(id); else builderSelectedBankIds.delete(id);
    const btn = document.getElementById('builderAddSelectedBtn');
    if (btn) {
        btn.textContent = `Add Selected (${builderSelectedBankIds.size})`;
        btn.disabled = builderSelectedBankIds.size === 0;
    }
}

async function addSelectedBankQuestions() {
    const ids = Array.from(builderSelectedBankIds);
    if (ids.length === 0) return;
    await addBankQuestionsToTest(ids);
    builderSelectedBankIds.clear();
}

function onBankDragStart(e, id) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'bank', id }));
}

function onReorderDragStart(e, index) {
    e.stopPropagation();
    builderReorderFromIndex = index;
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'reorder', index }));
}

function onReorderDrop(e, targetIndex) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('builderQuestionsList')?.classList.remove('dropzone-active');
    let data = {};
    try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (err) { /* ignore */ }
    if (data.type === 'reorder') {
        const [moved] = builderQuestions.splice(data.index, 1);
        builderQuestions.splice(targetIndex, 0, moved);
        renderBuilderQuestionsList();
        persistBuilderOrder();
    } else if (data.type === 'bank') {
        addBankQuestionsToTest([data.id]);
    }
}

function onBuilderDrop(e) {
    e.preventDefault();
    document.getElementById('builderQuestionsList')?.classList.remove('dropzone-active');
    let data = {};
    try { data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (err) { /* ignore */ }
    if (data.type === 'bank') addBankQuestionsToTest([data.id]);
}

function renderBuilderQuestionsList() {
    const list = document.getElementById('builderQuestionsList');
    if (!list) return;
    list.innerHTML = builderQuestions.length === 0
        ? `<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">No questions yet — add from the bank or use Random Selection below.</div>`
        : builderQuestions.map((q, i) => `
            <div class="builder-card" draggable="true"
                 ondragstart="onReorderDragStart(event, ${i})"
                 ondragover="event.preventDefault();"
                 ondrop="onReorderDrop(event, ${i})">
                <span class="drag-handle"><i class="fas fa-grip-vertical"></i></span>
                <div class="builder-card-body">
                    <div class="builder-card-text"><strong>${i + 1}.</strong> ${escapeHtml(q.questionText)}</div>
                    <div class="builder-card-meta">
                        <span class="diff-chip ${q.difficulty || 'medium'}">${q.difficulty || 'medium'}</span>
                        <span style="font-size:10px;color:var(--muted);">${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''}</span>
                    </div>
                </div>
                <button class="btn btn-danger btn-sm" onclick="removeBuilderQuestion('${q._id}')"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
    updateBuilderSummary();
}

function updateBuilderSummary() {
    const countEl = document.getElementById('builderQCount');
    const marksEl = document.getElementById('builderMarksTotal');
    if (countEl) countEl.textContent = builderQuestions.length;
    if (marksEl) marksEl.textContent = builderQuestions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
}

async function persistBuilderOrder() {
    const orderedIds = builderQuestions.map(q => q._id);
    await apiCall(`/tests/${builderTestId}/questions/reorder`, { method: 'PUT', body: JSON.stringify({ orderedIds }) });
}

async function addBankQuestionsToTest(ids) {
    const result = await apiCall(`/tests/${builderTestId}/questions/bank`, { method: 'POST', body: JSON.stringify({ questionIds: ids }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add question(s)', 'error'); return; }
    builderQuestions = builderQuestions.concat(result.data.added);
    showToast('Success', result.message, 'success');
    refreshBuilderBankList();
    renderBuilderQuestionsList();
}

async function addRandomQuestions() {
    const difficultyMix = {
        easy: parseInt(document.getElementById('builderMixEasy').value) || 0,
        medium: parseInt(document.getElementById('builderMixMedium').value) || 0,
        hard: parseInt(document.getElementById('builderMixHard').value) || 0,
    };
    const chapter = document.getElementById('builderMixChapter').value;
    if (difficultyMix.easy + difficultyMix.medium + difficultyMix.hard === 0) {
        showToast('Error', 'Enter at least one question count', 'error'); return;
    }
    const result = await apiCall(`/tests/${builderTestId}/questions/random`, {
        method: 'POST',
        body: JSON.stringify({ difficultyMix, chapter: chapter || undefined })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add random questions', 'error'); return; }
    builderQuestions = builderQuestions.concat(result.data.added);
    showToast(result.data.shortfalls?.length ? 'Partial' : 'Success', result.message, result.data.shortfalls?.length ? 'warning' : 'success');
    refreshBuilderBankList();
    renderBuilderQuestionsList();
}

async function removeBuilderQuestion(id) {
    const result = await apiCall(`/tests/${builderTestId}/questions/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to remove question', 'error'); return; }
    builderQuestions = builderQuestions.filter(q => q._id !== id);
    refreshBuilderBankList();
    renderBuilderQuestionsList();
}

async function builderTogglePublish() {
    const action = builderTest.isPublished ? 'unpublish' : 'publish';
    const result = await apiCall(`/tests/${builderTestId}/${action}`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || `Failed to ${action} test`, 'error'); return; }
    builderTest.isPublished = !builderTest.isPublished;
    showToast('Success', `Test ${action}ed`, 'success');
    renderTestBuilder();
}

// Preview Before Publish — renders the test roughly as a student would see
// it (question, options, marks) with the correct option highlighted for the
// admin's benefit, so mistakes can be caught before going live.
function previewTestBuilder() {
    const totalMarks = builderQuestions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
    const body = `
        <div style="margin-bottom:10px;color:var(--muted);font-size:13px;">
            ${builderQuestions.length} questions · ${totalMarks} marks · ${builderTest.duration} minutes
        </div>
        ${builderQuestions.length === 0 ? '<div style="color:var(--muted);">No questions added yet.</div>' : builderQuestions.map((q, i) => `
            <div class="preview-question">
                <div style="color:var(--white);font-size:14px;"><strong>Q${i + 1}.</strong> ${escapeHtml(q.questionText)} <span style="color:var(--muted);font-size:11px;">(${q.marks || 1} mark${(q.marks || 1) > 1 ? 's' : ''})</span></div>
                ${(q.options || []).map(opt => `
                    <div class="preview-option ${opt.isCorrect ? 'correct' : ''}">
                        ${opt.isCorrect ? '<i class="fas fa-check-circle"></i> ' : ''}${escapeHtml(opt.text || '')}
                    </div>
                `).join('')}
            </div>
        `).join('')}
    `;
    showModal(`Preview: ${builderTest.title}`, 'This is how the test will appear once published', body, null);
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';
}

// ============================================================
// ============================================================
// HOMEWORK MODULE (Admin)
