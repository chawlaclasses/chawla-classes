// public/admin/js/ai-tools.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

let aiActiveTab = 'question-gen';
window._aiSelectedStudent = null;
window._aiExplainSource = null; // { questionId } if explaining a bank question

async function loadAITools() {
    showLoading();
    try {
        const [classesRes, subjectsRes] = await Promise.all([apiCall('/classes'), apiCall('/subjects')]);
        window._classes = classesRes?.data || [];
        window._subjects = subjectsRes?.data || [];
        renderAITools();
    } catch (error) {
        showError('Failed to load AI Tools', error.message);
    }
}

const AI_TABS = [
    { id: 'question-gen', label: '🧠 Question Generator' },
    { id: 'paper-gen', label: '📝 Paper Generator' },
    { id: 'explain', label: '💡 Answer Explanation' },
    { id: 'predict', label: '📈 Performance Prediction' },
    { id: 'weak-topics', label: '🎯 Weak Topic Recommendation' },
];

function renderAITools() {
    contentArea.innerHTML = `
        <div class="toolbar"><h2>🤖 AI Tools</h2></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
            ${AI_TABS.map(t => `<button class="btn ${aiActiveTab === t.id ? 'btn-gold' : 'btn-secondary'} btn-sm" onclick="switchAITab('${t.id}')">${t.label}</button>`).join('')}
        </div>
        <div id="aiTabContent"></div>
    `;
    renderAITabContent();
}

function switchAITab(tabId) {
    aiActiveTab = tabId;
    renderAITools();
}

function renderAITabContent() {
    const el = document.getElementById('aiTabContent');
    if (aiActiveTab === 'question-gen') return renderQuestionGenTab(el);
    if (aiActiveTab === 'paper-gen') return renderPaperGenTab(el);
    if (aiActiveTab === 'explain') return renderExplainTab(el);
    if (aiActiveTab === 'predict') return renderPredictTab(el);
    if (aiActiveTab === 'weak-topics') return renderWeakTopicsTab(el);
}

// ── Question Generator ──────────────────────────────────────────────────

function renderQuestionGenTab(el) {
    el.innerHTML = `
        <div class="builder-panel" style="max-width:600px;">
            <h3>🧠 AI Question Generator</h3>
            <div class="form-group"><label>Chapter / Topic *</label><input type="text" id="qgChapter" placeholder="e.g., Trigonometric Ratios"></div>
            <div class="form-row">
                <div class="form-group"><label>Difficulty</label>
                    <select id="qgDifficulty">
                        <option value="mixed">Mixed</option>
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </div>
                <div class="form-group"><label>Count</label><input type="number" id="qgCount" value="5" min="1" max="20"></div>
                <div class="form-group"><label>Marks Each</label><input type="number" id="qgMarks" value="1" min="1"></div>
            </div>
            <button class="btn btn-gold" onclick="generateAIQuestions()" id="qgGenerateBtn"><i class="fas fa-magic"></i> Generate Questions</button>
            <div id="qgResult" style="margin-top:16px;"></div>
        </div>
    `;
}

async function generateAIQuestions() {
    const chapter = document.getElementById('qgChapter').value.trim();
    const difficulty = document.getElementById('qgDifficulty').value;
    const count = document.getElementById('qgCount').value;
    const marks = document.getElementById('qgMarks').value;
    if (!chapter) { showToast('Error', 'Chapter/topic is required', 'error'); return; }

    const btn = document.getElementById('qgGenerateBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
    const resultEl = document.getElementById('qgResult');
    resultEl.innerHTML = '';

    const result = await apiCall('/ai/generate-questions', { method: 'POST', body: JSON.stringify({ chapter, difficulty, count, marks }) });
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> Generate Questions';

    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to generate questions', 'error'); return; }
    showToast('Success', result.message, 'success');
    resultEl.innerHTML = `
        <p style="font-size:12px;color:var(--gold);margin-bottom:8px;">Saved as drafts — review and approve them from the Questions page.</p>
        <div class="builder-list">
            ${result.data.map(q => `
                <div class="builder-card" style="cursor:default;">
                    <div class="builder-card-body">
                        <div class="builder-card-text">${escapeHtml(q.questionText)}</div>
                        <div class="builder-card-meta"><span class="diff-chip ${q.difficulty}">${q.difficulty}</span></div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ── Paper Generator ──────────────────────────────────────────────────────

function renderPaperGenTab(el) {
    const subjects = window._subjects || [];
    const classes = window._classes || [];
    el.innerHTML = `
        <div class="builder-panel" style="max-width:600px;">
            <h3>📝 AI Paper Generator</h3>
            <div class="form-group"><label>Test Title *</label><input type="text" id="pgTitle" placeholder="e.g., Trigonometry Unit Test"></div>
            <div class="form-row">
                <div class="form-group"><label>Subject *</label>
                    <select id="pgSubject">
                        <option value="">Select subject</option>
                        ${subjects.map(s => {
                            const cls = classes.find(c => c._id === s.classId);
                            return `<option value="${s._id}" data-class="${s.classId}">${escapeHtml(s.name)} — ${escapeHtml(cls?.displayName || cls?.name || '')}</option>`;
                        }).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Duration (min)</label><input type="number" id="pgDuration" value="60"></div>
            </div>
            <div class="form-group"><label>Chapter / Topic *</label><input type="text" id="pgChapter" placeholder="e.g., Trigonometric Ratios"></div>
            <div class="form-row">
                <div class="form-group"><label>Easy</label><input type="number" id="pgEasy" value="3" min="0"></div>
                <div class="form-group"><label>Medium</label><input type="number" id="pgMedium" value="4" min="0"></div>
                <div class="form-group"><label>Hard</label><input type="number" id="pgHard" value="3" min="0"></div>
                <div class="form-group"><label>Marks/Q</label><input type="number" id="pgMarksEach" value="1" min="1"></div>
            </div>
            <button class="btn btn-gold" onclick="generateAIPaper()" id="pgGenerateBtn"><i class="fas fa-magic"></i> Generate Paper</button>
            <div id="pgResult" style="margin-top:16px;"></div>
        </div>
    `;
}

async function generateAIPaper() {
    const title = document.getElementById('pgTitle').value.trim();
    const subjectSelect = document.getElementById('pgSubject');
    const subjectId = subjectSelect.value;
    const classId = subjectSelect.selectedOptions[0]?.dataset.class;
    const chapter = document.getElementById('pgChapter').value.trim();
    const duration = document.getElementById('pgDuration').value;
    const easy = document.getElementById('pgEasy').value;
    const medium = document.getElementById('pgMedium').value;
    const hard = document.getElementById('pgHard').value;
    const marksPerQuestion = document.getElementById('pgMarksEach').value;

    if (!title || !subjectId || !chapter) { showToast('Error', 'Title, subject and chapter are required', 'error'); return; }

    const btn = document.getElementById('pgGenerateBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating paper…';
    const resultEl = document.getElementById('pgResult');
    resultEl.innerHTML = '';

    const result = await apiCall('/ai-v2/generate-paper', {
        method: 'POST',
        body: JSON.stringify({ title, classId, subjectId, chapter, duration, marksPerQuestion, difficultyMix: { easy, medium, hard } })
    });
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> Generate Paper';

    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to generate paper', 'error'); return; }
    showToast('Success', result.message, 'success');
    resultEl.innerHTML = `
        <div class="builder-card" style="cursor:pointer;" onclick="switchSection('tests'); setTimeout(() => openTestBuilder('${result.data.test._id}'), 200);">
            <div class="builder-card-body">
                <div class="builder-card-text"><strong>${escapeHtml(result.data.test.title)}</strong></div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px;">${result.data.questionsGenerated} questions · ${result.data.test.totalMarks} marks · Draft — click to open in Test Builder</div>
            </div>
        </div>
    `;
}

// ── Answer Explanation ──────────────────────────────────────────────────

function renderExplainTab(el) {
    el.innerHTML = `
        <div class="builder-panel" style="max-width:600px;">
            <h3>💡 AI Answer Explanation</h3>
            <div class="form-group"><label>Search an existing bank question (optional)</label>
                <input type="text" id="exSearch" placeholder="Type to search…" oninput="aiExplainSearch(this.value)">
                <div id="exSearchResults"></div>
            </div>
            <p style="font-size:12px;color:var(--muted);">Or fill in manually:</p>
            <div class="form-group"><label>Question Text *</label><textarea id="exQuestionText" rows="2"></textarea></div>
            <div class="form-group"><label>Options (one per line)</label><textarea id="exOptions" rows="3" placeholder="Option A\nOption B\nOption C\nOption D"></textarea></div>
            <div class="form-group"><label>Correct Answer *</label><input type="text" id="exCorrectAnswer" placeholder="Exact text of the correct option"></div>
            <button class="btn btn-gold" onclick="generateAIExplanation()" id="exGenerateBtn"><i class="fas fa-magic"></i> Generate Explanation</button>
            <div id="exResult" style="margin-top:16px;"></div>
        </div>
    `;
}

let exSearchTimer = null;
function aiExplainSearch(query) {
    clearTimeout(exSearchTimer);
    const resultsEl = document.getElementById('exSearchResults');
    if (!query || query.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    exSearchTimer = setTimeout(async () => {
        const res = await apiCall('/questions');
        const matches = (res?.data || []).filter(q => q.questionText.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);
        resultsEl.innerHTML = matches.map(q => `
            <div class="builder-card" style="margin-top:6px;" onclick='aiExplainSelectQuestion(${JSON.stringify(q._id)}, ${JSON.stringify(q.questionText)}, ${JSON.stringify((q.options||[]).map(o=>o.text).join("\\n"))}, ${JSON.stringify(q.correctAnswer)})'>
                <div class="builder-card-body"><div class="builder-card-text">${escapeHtml(q.questionText)}</div></div>
            </div>
        `).join('') || `<div style="font-size:12px;color:var(--muted);padding:6px;">No match found</div>`;
    }, 300);
}

function aiExplainSelectQuestion(id, text, optionsText, correctAnswer) {
    window._aiExplainSource = { questionId: id };
    document.getElementById('exQuestionText').value = text;
    document.getElementById('exOptions').value = optionsText;
    document.getElementById('exCorrectAnswer').value = correctAnswer;
    document.getElementById('exSearchResults').innerHTML = '';
}

async function generateAIExplanation() {
    const questionText = document.getElementById('exQuestionText').value.trim();
    const optionsRaw = document.getElementById('exOptions').value.trim();
    const correctAnswer = document.getElementById('exCorrectAnswer').value.trim();
    if (!questionText || !correctAnswer) { showToast('Error', 'Question text and correct answer are required', 'error'); return; }

    const options = optionsRaw ? optionsRaw.split('\n').filter(Boolean).map(t => ({ text: t.trim(), isCorrect: t.trim() === correctAnswer })) : [];
    const source = window._aiExplainSource;

    const btn = document.getElementById('exGenerateBtn');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
    const resultEl = document.getElementById('exResult');

    const body = source?.questionId
        ? { questionId: source.questionId, save: true }
        : { questionText, options, correctAnswer };
    const result = await apiCall('/ai/explain-question', { method: 'POST', body: JSON.stringify(body) });
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> Generate Explanation';

    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to generate explanation', 'error'); return; }
    resultEl.innerHTML = `
        <div class="doubt-detail-card">
            <p>${escapeHtml(result.data.explanation)}</p>
            ${source?.questionId ? `<p style="font-size:11px;color:var(--gold);margin-top:8px;">✓ Saved to this question in the Question Bank</p>` : ''}
        </div>
    `;
}

// ── Performance Prediction & Weak Topics (shared student picker) ────────

function aiStudentPickerHtml(inputId, resultsId) {
    return `<div class="form-group"><label>Student *</label>
        <input type="text" id="${inputId}" placeholder="Type a name to search…" oninput="aiSearchStudent(this.value, '${resultsId}')">
        <div id="${resultsId}"></div>
    </div>`;
}

let aiStudentSearchTimer = null;
function aiSearchStudent(query, resultsId) {
    clearTimeout(aiStudentSearchTimer);
    const resultsEl = document.getElementById(resultsId);
    if (!query || query.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    aiStudentSearchTimer = setTimeout(async () => {
        const res = await apiCall('/students-list');
        const matches = (res?.data || []).filter(s => s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
        resultsEl.innerHTML = matches.map(s => `
            <div class="builder-card" style="margin-top:6px;" onclick='aiSelectStudentFor("${resultsId}", ${JSON.stringify(s._id)}, ${JSON.stringify(s.name)})'>
                <div class="builder-card-body"><div class="builder-card-text">${escapeHtml(s.name)} <span style="color:var(--muted);font-size:11px;">(${escapeHtml(s.class)})</span></div></div>
            </div>
        `).join('') || `<div style="font-size:12px;color:var(--muted);padding:6px;">No match found</div>`;
    }, 300);
}

function aiSelectStudentFor(resultsId, studentId, name) {
    window._aiSelectedStudent = studentId;
    const inputId = resultsId.replace('Results', 'Input');
    const input = document.getElementById(inputId);
    if (input) input.value = name;
    document.getElementById(resultsId).innerHTML = '';
}

function renderPredictTab(el) {
    el.innerHTML = `
        <div class="builder-panel" style="max-width:600px;">
            <h3>📈 AI Performance Prediction</h3>
            ${aiStudentPickerHtml('predictInput', 'predictResults')}
            <button class="btn btn-gold" onclick="runPerformancePrediction()"><i class="fas fa-chart-line"></i> Predict</button>
            <div id="predictOutput" style="margin-top:16px;"></div>
        </div>
    `;
}

async function runPerformancePrediction() {
    if (!window._aiSelectedStudent) { showToast('Error', 'Select a student first', 'error'); return; }
    const outputEl = document.getElementById('predictOutput');
    outputEl.innerHTML = '<p style="color:var(--muted);font-size:13px;">Loading…</p>';

    const result = await apiCall(`/ai/predict-performance/${window._aiSelectedStudent}`);
    if (!result || !result.success) { outputEl.innerHTML = `<p style="color:#dc2626;">Failed to load prediction</p>`; return; }

    const p = result.data;
    if (!p.hasEnoughData) {
        outputEl.innerHTML = `<p style="color:var(--muted);font-size:13px;">${escapeHtml(p.message)}</p>`;
        return;
    }

    const riskColor = p.riskLevel === 'high' ? '#dc2626' : p.riskLevel === 'medium' ? 'var(--gold)' : '#16a34a';
    outputEl.innerHTML = `
        <div class="doubt-detail-card">
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
                <div><div style="font-size:26px;font-weight:800;color:var(--gold);">${p.predictedNextScore}</div><div style="font-size:11px;color:var(--muted);">Predicted Next Score</div></div>
                <div><div style="font-size:26px;font-weight:800;color:${riskColor};text-transform:capitalize;">${p.riskLevel}</div><div style="font-size:11px;color:var(--muted);">Risk Level</div></div>
                <div><div style="font-size:26px;font-weight:800;color:var(--white);">${p.confidence}%</div><div style="font-size:11px;color:var(--muted);">Confidence</div></div>
            </div>
            <p style="margin-top:12px;font-size:13px;">Current average: <strong>${p.currentAverage}</strong> · Trend: <strong style="text-transform:capitalize;">${p.recentTrend}</strong> · Based on ${p.totalTests} tests</p>
            ${p.narrative ? `<p style="margin-top:10px;color:var(--text);font-style:italic;">"${escapeHtml(p.narrative)}"</p>` : ''}
        </div>
    `;
}

function renderWeakTopicsTab(el) {
    el.innerHTML = `
        <div class="builder-panel" style="max-width:600px;">
            <h3>🎯 AI Weak Topic Recommendation</h3>
            ${aiStudentPickerHtml('weakInput', 'weakResults')}
            <button class="btn btn-gold" onclick="runWeakTopics()"><i class="fas fa-bullseye"></i> Get Recommendations</button>
            <div id="weakOutput" style="margin-top:16px;"></div>
        </div>
    `;
}

async function runWeakTopics() {
    if (!window._aiSelectedStudent) { showToast('Error', 'Select a student first', 'error'); return; }
    const outputEl = document.getElementById('weakOutput');
    outputEl.innerHTML = '<p style="color:var(--muted);font-size:13px;">Loading…</p>';

    const result = await apiCall(`/ai/weak-topics/${window._aiSelectedStudent}`);
    if (!result || !result.success) { outputEl.innerHTML = `<p style="color:#dc2626;">Failed to load recommendations</p>`; return; }

    const { topics, message } = result.data;
    if (!topics || topics.length === 0) {
        outputEl.innerHTML = `<p style="color:var(--muted);font-size:13px;">${escapeHtml(message || 'No weak topics detected.')}</p>`;
        return;
    }

    outputEl.innerHTML = topics.map(t => `
        <div class="doubt-detail-card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <strong>${escapeHtml(t.subject)}</strong>
                <span class="priority-chip priority-high">${t.accuracy}% accuracy</span>
            </div>
            <p style="font-size:12px;color:var(--muted);margin-top:6px;">${t.questionsAttempted} questions attempted · ${t.availablePracticeQuestions} practice questions available in bank</p>
            ${t.aiTip ? `<p style="margin-top:8px;color:var(--text);font-size:13px;">💡 ${escapeHtml(t.aiTip)}</p>` : ''}
        </div>
    `).join('');
}