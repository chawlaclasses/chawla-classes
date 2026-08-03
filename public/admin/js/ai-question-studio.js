// public/admin/js/ai-question-studio.js
//
// AI Question Studio — new module, additive to the admin panel. Same
// conventions as every other public/admin/js/*.js file (global-scope
// classic script, contentArea.innerHTML rendering, apiCall/showToast/
// showModal helpers) so it drops into the existing <script src> load
// order (see dashboard.html) without needing a bundler or ES modules.
//
// Workflow enforced end-to-end, per spec:
//   Generate/Extract -> Preview -> Admin Review -> Approve -> Save
// Nothing reaches the Question Bank until an admin explicitly approves
// it in the Preview step and clicks Save — see routes/admin/ai-question-studio.js.

// ============================================================
// STATE
// ============================================================
window._studio = window._studio || {
    step: 'form',              // 'form' | 'progress' | 'preview'
    source: 'ai-generate',      // ai-generate | pdf-import | image-ocr | text-input | manual
    classes: [],
    subjects: [],
    academic: { classId: '', subjectId: '', book: '', chapter: '', topic: '', subTopic: '', learningOutcome: '', examType: '', academicSession: '', language: 'english' },
    generation: { numQuestions: 10, marksEach: 1, estimatedTime: 15, bloom: { remember: 20, understand: 20, apply: 20, analyze: 20, evaluate: 10, create: 10 } },
    questionTypes: ['mcq'],
    pattern: 'cbse',
    difficulty: { easy: 4, medium: 4, hard: 2, very_hard: 0 },
    prompt: '',
    advanced: {
        creativity: 50, accuracy: 70, diversity: 50, difficultyStrictness: 50,
        duplicateDetection: true, generateExplanation: true, generateHint: false,
        generateStepSolution: false, generateDiagramSuggestion: false,
        generateWrongOptions: true, generateAlternateQuestion: false,
    },
    negativeInstructions: '',
    tags: [],
    outputFormat: 'question_bank',
    saveDestination: 'review_queue',
    extractText: '',
    manualDraft: null,
    previewQuestions: [],
    selected: {},           // tempId -> true
    duplicates: {},         // tempId -> { duplicatePercent, similarityPercent, existingQuestion }
    lastSummary: null,
};

const STUDIO_QUESTION_TYPES = [
    { id: 'mcq', label: 'MCQ' },
    { id: 'subjective', label: 'Subjective' },
    { id: 'assertion-reason', label: 'Assertion Reason' },
    { id: 'case-study', label: 'Case Study' },
    { id: 'fill-in-blank', label: 'Fill in Blanks' },
    { id: 'true-false', label: 'True False' },
    { id: 'match-following', label: 'Match the Following' },
    { id: 'numerical', label: 'Numerical' },
    { id: 'diagram-based', label: 'Diagram Based' },
];

const STUDIO_PATTERNS = [
    ['ncert', 'NCERT'], ['cbse', 'CBSE'], ['competency_based', 'Competency Based'],
    ['board_pattern', 'Board Pattern'], ['sample_paper', 'Sample Paper'],
    ['previous_year', 'Previous Year'], ['olympiad', 'Olympiad'], ['custom', 'Custom'],
];

const STUDIO_PRESET_TAGS = ['NCERT', 'PYQ', 'Revision', 'Homework', 'Practice', 'Board', 'Important', 'Competency'];

const STUDIO_PROGRESS_STAGES = [
    'Preparing Prompt', 'Checking Existing Questions', 'Generating Questions',
    'Checking Duplicates', 'Preparing Preview', 'Completed',
];

// ============================================================
// AUTOSAVE / RESUME SESSION
// ============================================================
// Everything the admin has typed/generated is periodically mirrored to
// localStorage so a closed tab/crashed browser during a long editing
// session (form-filling, a 100-question generation run, reviewing a big
// Preview) never loses work. This is local to the browser, not a
// server-side draft — see CHANGES.md if a shared/cross-device draft
// (backed by the 'questions' collection like everything else) is wanted
// instead; that's a bigger change (new endpoint + collection) so it
// wasn't folded in silently here.
const STUDIO_STORAGE_KEY = 'chawlaClasses_aiQuestionStudio_session_v1';
const STUDIO_AUTOSAVE_MS = 25000; // 20-30s, per the "don't lose 30 minutes of work" ask
let _studioAutosaveTimer = null;

function studioSerializableState() {
    const s = window._studio;
    return {
        savedAt: Date.now(),
        source: s.source, academic: s.academic, generation: s.generation, questionTypes: s.questionTypes,
        pattern: s.pattern, difficulty: s.difficulty, prompt: s.prompt, advanced: s.advanced,
        negativeInstructions: s.negativeInstructions, tags: s.tags, outputFormat: s.outputFormat,
        saveDestination: s.saveDestination, extractText: s.extractText,
        previewQuestions: s.previewQuestions, selected: s.selected, duplicates: s.duplicates,
        // 'progress' is a transient in-flight state — never resumable, so
        // it's downgraded to 'form' before persisting.
        step: s.step === 'progress' ? 'form' : s.step,
        lastSummary: s.lastSummary,
    };
}

function studioSaveSessionToStorage() {
    try {
        const state = studioSerializableState();
        // Skip persisting a genuinely empty session — avoids the Resume
        // prompt firing for an admin who just opened the module and typed
        // nothing yet.
        const hasContent = state.previewQuestions.length > 0
            || (state.academic.chapter || '').trim()
            || (state.academic.topic || '').trim()
            || (state.prompt || '').trim()
            || (state.extractText || '').trim();
        if (!hasContent) { localStorage.removeItem(STUDIO_STORAGE_KEY); return; }
        localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        // localStorage can throw (private browsing, quota full) — autosave
        // is best-effort and should never break the Studio itself.
    }
}

function studioLoadSessionFromStorage() {
    try {
        const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        return null;
    }
}

function studioClearSession() {
    try { localStorage.removeItem(STUDIO_STORAGE_KEY); } catch (err) { /* best-effort */ }
}

function studioStartAutosave() {
    studioStopAutosave();
    _studioAutosaveTimer = setInterval(studioSaveSessionToStorage, STUDIO_AUTOSAVE_MS);
    if (!window._studioUnloadHooked) {
        // Belt-and-braces: also save the instant the tab is actually
        // closing, so the admin never loses up to STUDIO_AUTOSAVE_MS of
        // work between the last periodic save and the close.
        window.addEventListener('beforeunload', studioSaveSessionToStorage);
        window._studioUnloadHooked = true;
    }
}
function studioStopAutosave() {
    if (_studioAutosaveTimer) { clearInterval(_studioAutosaveTimer); _studioAutosaveTimer = null; }
}

function studioApplySession(saved) {
    const s = window._studio;
    Object.assign(s, {
        source: saved.source || s.source,
        academic: { ...s.academic, ...saved.academic },
        generation: { ...s.generation, ...saved.generation },
        questionTypes: saved.questionTypes || s.questionTypes,
        pattern: saved.pattern || s.pattern,
        difficulty: { ...s.difficulty, ...saved.difficulty },
        prompt: saved.prompt || '',
        advanced: { ...s.advanced, ...saved.advanced },
        negativeInstructions: saved.negativeInstructions || '',
        tags: saved.tags || [],
        outputFormat: saved.outputFormat || s.outputFormat,
        saveDestination: saved.saveDestination || s.saveDestination,
        extractText: saved.extractText || '',
        previewQuestions: saved.previewQuestions || [],
        selected: saved.selected || {},
        duplicates: saved.duplicates || {},
        lastSummary: saved.lastSummary || null,
        step: saved.step || 'form',
    });
}

// Shows the "Resume previous session?" prompt on top of a freshly
// rendered blank form. Rendering the fresh form first (rather than only
// on dismiss) means dismissing this prompt via the shared modal's
// existing Cancel button just leaves the admin looking at a normal new
// session — no separate "start new" render path to keep in sync.
function renderStudioResumePrompt(savedSession) {
    window._studio.step = 'form';
    renderStudio();

    const when = new Date(savedSession.savedAt).toLocaleString();
    const questionCount = (savedSession.previewQuestions || []).length;
    showModal(
        'Resume previous AI Studio session?',
        `Autosaved ${when}`,
        `<p>You have an unfinished AI Question Studio session${questionCount ? ` with <b>${questionCount}</b> question(s) already in Preview` : ''}.</p>
         <p style="color:var(--muted);font-size:12.5px;">Resuming restores your form, prompt, and Preview exactly as you left them.</p>`,
        () => {
            studioApplySession(savedSession);
            resetStudioModalChrome();
            closeModal();
            renderStudio();
        }
    );

    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Resume';

    // The Cancel button is shared across every modal in the app — relabel
    // it for this prompt only, and use a one-time (`{ once: true }`)
    // listener rather than overwriting its existing onclick="closeModal()"
    // attribute, so it's back to normal "Cancel" behavior for the very
    // next unrelated modal anywhere else in the admin panel.
    const cancelBtn = document.querySelector('#modalOverlay .btn-secondary');
    if (cancelBtn) {
        cancelBtn.textContent = 'Start New';
        cancelBtn.addEventListener('click', function studioStartNewOnce() {
            studioClearSession();
            resetStudioModalChrome();
        }, { once: true });
    }
}

function resetStudioModalChrome() {
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.textContent = 'Save';
    const cancelBtn = document.querySelector('#modalOverlay .btn-secondary');
    if (cancelBtn) cancelBtn.textContent = 'Cancel';
}

// ============================================================
// ENTRY POINT (wired into navigation.js's sectionLoaders)
// ============================================================
async function loadAIQuestionStudio() {
    ensureStudioStyles();
    showLoading();
    try {
        const [classesRes, subjectsRes] = await Promise.all([apiCall('/classes'), apiCall('/subjects')]);
        window._studio.classes = classesRes?.data || [];
        window._studio.subjects = subjectsRes?.data || [];

        const savedSession = studioLoadSessionFromStorage();
        const savedHasContent = savedSession && (
            (savedSession.previewQuestions || []).length > 0
            || (savedSession.academic?.chapter || '').trim()
            || (savedSession.academic?.topic || '').trim()
            || (savedSession.prompt || '').trim()
        );

        if (savedHasContent) {
            renderStudioResumePrompt(savedSession);
        } else {
            window._studio.step = 'form';
            renderStudio();
        }
        studioStartAutosave();
    } catch (error) {
        showError('Failed to load AI Question Studio', error.message);
    }
}

function renderStudio() {
    const s = window._studio;
    if (s.step === 'progress') return renderStudioProgress();
    if (s.step === 'preview') return renderStudioPreview();
    return renderStudioForm();
}

// ============================================================
// SMALL HELPERS
// ============================================================
function studioSet(path, value) {
    const parts = path.split('.');
    let obj = window._studio;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
}
function studioGet(path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), window._studio);
}
function studioNum(id) {
    const el = document.getElementById(id);
    return el ? (parseFloat(el.value) || 0) : 0;
}
function studioSubjectsForClass(classId) {
    if (!classId) return window._studio.subjects;
    return window._studio.subjects.filter(s => s.classId === classId);
}

// ============================================================
// STYLES (injected once — additive, doesn't touch dashboard.html's own
// <style> block; follows the same CSS variables that block defines)
// ============================================================
function ensureStudioStyles() {
    if (document.getElementById('aiQuestionStudioStyles')) return;
    const style = document.createElement('style');
    style.id = 'aiQuestionStudioStyles';
    style.textContent = `
        .studio-section { background: var(--surface); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 16px; margin-bottom: 14px; }
        .studio-section h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 10px; display:flex; align-items:center; gap:6px; }
        .studio-source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 8px; }
        .studio-source-card { border: 2px solid var(--card-border); border-radius: 10px; padding: 12px 8px; text-align: center; cursor: pointer; font-size: 12.5px; font-weight: 600; transition: all .15s; }
        .studio-source-card.active { border-color: var(--gold); background: var(--gold-glow); color: var(--gold); }
        .studio-source-card .icon { display:block; font-size: 20px; margin-bottom: 6px; }
        .studio-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .studio-grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
        .studio-grid-4 { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
        @media (max-width: 720px) { .studio-grid-2, .studio-grid-3, .studio-grid-4 { grid-template-columns: 1fr 1fr; } }
        .studio-chip-select { display: flex; flex-wrap: wrap; gap: 6px; }
        .studio-chip { border: 1px solid var(--card-border); border-radius: 999px; padding: 5px 12px; font-size: 12px; cursor: pointer; background: var(--card-bg); }
        .studio-chip.active { background: var(--gold); border-color: var(--gold); color: #1a1a1a; font-weight: 700; }
        .studio-diff-total { font-size: 12px; margin-top: 4px; }
        .studio-diff-total.ok { color: var(--success); } .studio-diff-total.bad { color: var(--danger); }
        .studio-slider-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
        .studio-slider-row label { min-width: 150px; font-size: 12.5px; }
        .studio-slider-row input[type=range] { flex:1; }
        .studio-slider-row .val { width: 34px; text-align:right; font-size: 12px; color: var(--gold); font-weight:700; }
        .studio-toggle-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: 6px; margin-top: 6px; }
        .studio-toggle { display:flex; align-items:center; gap:8px; font-size: 12.5px; }
        .studio-progress-wrap { max-width: 520px; margin: 40px auto; text-align:center; }
        .studio-progress-track { height: 8px; background: var(--card-bg); border-radius: 999px; overflow:hidden; margin: 18px 0; }
        .studio-progress-fill { height:100%; background: linear-gradient(90deg, var(--gold-dim), var(--gold)); transition: width .4s; }
        .studio-progress-stage { font-size: 12.5px; color: var(--muted); margin-top: 4px; }
        .studio-preview-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; margin-bottom: 12px; }
        .studio-bulk-bar { display:flex; flex-wrap:wrap; gap:6px; }
        .studio-cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(320px,1fr)); gap: 12px; }
        .studio-card { background: var(--surface); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 12px; font-size: 12.5px; }
        .studio-card.approved { border-color: var(--success); }
        .studio-card.rejected { opacity: .55; border-color: var(--danger); }
        .studio-card-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px; }
        .studio-card-text { max-height: 90px; overflow-y:auto; line-height:1.4; }
        .studio-badges { display:flex; flex-wrap:wrap; gap:4px; margin: 6px 0; }
        .studio-badge { font-size: 10px; padding: 2px 7px; border-radius: 999px; background: var(--card-bg); color: var(--muted); }
        .studio-badge.quality { background: var(--gold-glow); color: var(--gold); }
        .studio-dup-banner { background: rgba(239,68,68,0.1); border: 1px solid var(--danger); border-radius: 8px; padding: 6px 8px; font-size: 11.5px; margin: 6px 0; }
        .studio-card-actions { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }
        .studio-card-actions button { font-size: 11px; padding: 3px 8px; }
        .studio-summary-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(110px,1fr)); gap:10px; text-align:center; }
        .studio-summary-grid .num { font-size: 22px; font-weight: 800; color: var(--gold); }
        .studio-summary-grid .lbl { font-size: 11px; color: var(--muted); }
        .studio-tag-input { display:flex; gap:6px; }
    `;
    document.head.appendChild(style);
}

// ============================================================
// SECTION 1-11 FORM (AI Generate path shows everything; other sources
// show a trimmed form — see renderStudioSourceBody)
// ============================================================
function renderStudioForm() {
    const s = window._studio;
    contentArea.innerHTML = `
        <div class="toolbar"><h2><i class="fas fa-hat-wizard"></i> AI Question Studio</h2></div>

        <div class="studio-section">
            <h4>1. Question Source</h4>
            <div class="studio-source-grid">
                ${studioSourceCard('ai-generate', '🧠', 'AI Generate')}
                ${studioSourceCard('pdf-import', '📄', 'PDF Import')}
                ${studioSourceCard('image-ocr', '🖼️', 'Image OCR')}
                ${studioSourceCard('text-input', '📝', 'Text Input')}
                ${studioSourceCard('manual', '✍️', 'Manual')}
            </div>
        </div>

        <div id="studioSourceBody"></div>
    `;
    renderStudioSourceBody();
}

function studioSourceCard(id, icon, label) {
    const active = window._studio.source === id ? 'active' : '';
    return `<div class="studio-source-card ${active}" onclick="switchStudioSource('${id}')"><span class="icon">${icon}</span>${label}</div>`;
}

function switchStudioSource(id) {
    window._studio.source = id;
    renderStudioForm();
}

function renderStudioSourceBody() {
    const el = document.getElementById('studioSourceBody');
    const s = window._studio;
    if (s.source === 'ai-generate') { el.innerHTML = studioAcademicSectionHtml() + studioGenerationSectionsHtml(); return; }
    if (s.source === 'manual') { el.innerHTML = studioAcademicSectionHtml(true) + studioManualFormHtml(); return; }
    el.innerHTML = studioAcademicSectionHtml(true) + studioImportBodyHtml();
}

// ---- Section 2: Academic Information ----
function studioAcademicSectionHtml(minimal) {
    const s = window._studio;
    const classOptions = s.classes.map(c => `<option value="${c._id}" ${s.academic.classId === c._id ? 'selected' : ''}>${escapeHtml(c.displayName || c.name)}</option>`).join('');
    const subjectOptions = studioSubjectsForClass(s.academic.classId).map(sub => `<option value="${sub._id}" ${s.academic.subjectId === sub._id ? 'selected' : ''}>${escapeHtml(sub.name)}</option>`).join('');
    return `
        <div class="studio-section">
            <h4>2. Academic Information</h4>
            <div class="studio-grid-3">
                <div class="form-group"><label>Class *</label>
                    <select id="stuClass" onchange="studioSet('academic.classId', this.value); renderStudioForm();">
                        <option value="">Select class</option>${classOptions}
                    </select>
                </div>
                <div class="form-group"><label>Subject *</label>
                    <select id="stuSubject" onchange="studioSet('academic.subjectId', this.value)">
                        <option value="">Select subject</option>${subjectOptions}
                    </select>
                </div>
                <div class="form-group"><label>Book</label><input id="stuBook" value="${escapeHtml(s.academic.book)}" oninput="studioSet('academic.book', this.value)" placeholder="e.g. NCERT Science"></div>
            </div>
            <div class="studio-grid-3">
                <div class="form-group"><label>Chapter *</label><input id="stuChapter" value="${escapeHtml(s.academic.chapter)}" oninput="studioSet('academic.chapter', this.value)" placeholder="e.g. Light — Reflection & Refraction"></div>
                <div class="form-group"><label>Topic</label><input value="${escapeHtml(s.academic.topic)}" oninput="studioSet('academic.topic', this.value)"></div>
                <div class="form-group"><label>Sub Topic</label><input value="${escapeHtml(s.academic.subTopic)}" oninput="studioSet('academic.subTopic', this.value)"></div>
            </div>
            ${minimal ? '' : `
            <div class="studio-grid-3">
                <div class="form-group"><label>Learning Outcome</label><input value="${escapeHtml(s.academic.learningOutcome)}" oninput="studioSet('academic.learningOutcome', this.value)"></div>
                <div class="form-group"><label>Exam Type</label><input value="${escapeHtml(s.academic.examType)}" oninput="studioSet('academic.examType', this.value)" placeholder="e.g. Unit Test, Board Exam"></div>
                <div class="form-group"><label>Academic Session</label><input value="${escapeHtml(s.academic.academicSession)}" oninput="studioSet('academic.academicSession', this.value)" placeholder="e.g. 2026-27"></div>
            </div>
            <div class="form-group" style="max-width:220px;"><label>Language</label>
                <select onchange="studioSet('academic.language', this.value)">
                    <option value="english" ${s.academic.language === 'english' ? 'selected' : ''}>English</option>
                    <option value="hindi" ${s.academic.language === 'hindi' ? 'selected' : ''}>Hindi</option>
                    <option value="bilingual" ${s.academic.language === 'bilingual' ? 'selected' : ''}>Bilingual</option>
                </select>
            </div>`}
        </div>
    `;
}

// ---- Sections 3–11 (AI Generate only) ----
function studioGenerationSectionsHtml() {
    const s = window._studio;
    return `
        <div class="studio-section">
            <h4>3. Question Generation</h4>
            <div class="studio-grid-3">
                <div class="form-group"><label>Number of Questions</label><input type="number" min="1" max="100" id="stuNumQ" value="${s.generation.numQuestions}" oninput="studioOnNumQChange(this.value)"></div>
                <div class="form-group"><label>Marks Each</label><input type="number" min="1" value="${s.generation.marksEach}" oninput="studioSet('generation.marksEach', parseInt(this.value)||1)"></div>
                <div class="form-group"><label>Estimated Time (min)</label><input type="number" min="1" value="${s.generation.estimatedTime}" oninput="studioSet('generation.estimatedTime', parseInt(this.value)||1)"></div>
            </div>
            <label style="font-size:12px;color:var(--muted);margin-top:6px;display:block;">Bloom's Taxonomy weighting (%)</label>
            <div class="studio-grid-3">
                ${['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'].map(k => `
                    <div class="form-group"><label style="text-transform:capitalize;">${k}</label>
                        <input type="number" min="0" max="100" value="${s.generation.bloom[k]}" oninput="studioSet('generation.bloom.${k}', parseInt(this.value)||0)">
                    </div>
                `).join('')}
            </div>
        </div>

        <div class="studio-section">
            <h4>4. Question Types <span style="font-weight:400;color:var(--muted);text-transform:none;">(select one or more)</span></h4>
            <div class="studio-chip-select">
                ${STUDIO_QUESTION_TYPES.map(t => `<div class="studio-chip ${s.questionTypes.includes(t.id) ? 'active' : ''}" onclick="toggleStudioType('${t.id}')">${t.label}</div>`).join('')}
            </div>
        </div>

        <div class="studio-section">
            <h4>5. Generation Pattern</h4>
            <select onchange="studioSet('pattern', this.value)" style="max-width:260px;">
                ${STUDIO_PATTERNS.map(([id, label]) => `<option value="${id}" ${s.pattern === id ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
        </div>

        <div class="studio-section">
            <h4>6. Difficulty Distribution</h4>
            <div class="studio-grid-4">
                ${['easy', 'medium', 'hard', 'very_hard'].map(k => `
                    <div class="form-group"><label style="text-transform:capitalize;">${k.replace('_', ' ')}</label>
                        <input type="number" min="0" id="stuDiff_${k}" value="${s.difficulty[k]}" oninput="studioOnDiffChange('${k}', this.value)">
                    </div>
                `).join('')}
            </div>
            <div id="stuDiffTotal" class="studio-diff-total"></div>
        </div>

        <div class="studio-section">
            <h4>7. AI Prompt</h4>
            <textarea rows="3" placeholder="e.g. Generate competency based questions. Avoid repeated questions. Create original questions. Generate detailed explanation. Generate hints. Generate stepwise solution." oninput="studioSet('prompt', this.value)">${escapeHtml(s.prompt)}</textarea>
        </div>

        <div class="studio-section">
            <h4>8. Advanced AI Controls</h4>
            ${studioSlider('Creativity', 'advanced.creativity', s.advanced.creativity)}
            ${studioSlider('Accuracy', 'advanced.accuracy', s.advanced.accuracy)}
            ${studioSlider('Question Diversity', 'advanced.diversity', s.advanced.diversity)}
            ${studioSlider('Difficulty Strictness', 'advanced.difficultyStrictness', s.advanced.difficultyStrictness)}
            <div class="studio-toggle-grid">
                ${studioToggle('Duplicate Detection', 'advanced.duplicateDetection', s.advanced.duplicateDetection)}
                ${studioToggle('Generate Explanation', 'advanced.generateExplanation', s.advanced.generateExplanation)}
                ${studioToggle('Generate Hint', 'advanced.generateHint', s.advanced.generateHint)}
                ${studioToggle('Generate Step Solution', 'advanced.generateStepSolution', s.advanced.generateStepSolution)}
                ${studioToggle('Generate Diagram Suggestion', 'advanced.generateDiagramSuggestion', s.advanced.generateDiagramSuggestion)}
                ${studioToggle('Generate Wrong Options (plausible distractors)', 'advanced.generateWrongOptions', s.advanced.generateWrongOptions)}
                ${studioToggle('Generate Alternate Question', 'advanced.generateAlternateQuestion', s.advanced.generateAlternateQuestion)}
            </div>
        </div>

        <div class="studio-section">
            <h4>9. Negative Instructions</h4>
            <textarea rows="2" placeholder="One per line — e.g. Avoid duplicate questions. Avoid copied NCERT text. Avoid wrong numerical values." oninput="studioSet('negativeInstructions', this.value)">${escapeHtml(s.negativeInstructions)}</textarea>
        </div>

        <div class="studio-section">
            <h4>10. Tags</h4>
            <div class="studio-chip-select" style="margin-bottom:8px;">
                ${STUDIO_PRESET_TAGS.map(t => `<div class="studio-chip ${s.tags.includes(t) ? 'active' : ''}" onclick="toggleStudioTag('${t}')">${t}</div>`).join('')}
            </div>
            <div class="studio-tag-input">
                <input id="stuCustomTag" placeholder="Custom tag…" style="max-width:200px;">
                <button class="btn btn-secondary btn-sm" onclick="addStudioCustomTag()">Add</button>
            </div>
        </div>

        <div class="studio-section">
            <h4>11 &amp; 12. Output Format &amp; Save Destination</h4>
            <div class="studio-grid-2">
                <div class="form-group"><label>Output Format</label>
                    <select onchange="studioSet('outputFormat', this.value)">
                        <option value="question_bank" ${s.outputFormat === 'question_bank' ? 'selected' : ''}>Question Bank Ready</option>
                        <option value="json" ${s.outputFormat === 'json' ? 'selected' : ''}>JSON</option>
                        <option value="printable" ${s.outputFormat === 'printable' ? 'selected' : ''}>Printable</option>
                        <option value="html" ${s.outputFormat === 'html' ? 'selected' : ''}>HTML</option>
                        <option value="pdf" ${s.outputFormat === 'pdf' ? 'selected' : ''}>PDF</option>
                    </select>
                </div>
                <div class="form-group"><label>Save Destination</label>
                    <select onchange="studioSet('saveDestination', this.value)">
                        <option value="draft" ${s.saveDestination === 'draft' ? 'selected' : ''}>Draft</option>
                        <option value="review_queue" ${s.saveDestination === 'review_queue' ? 'selected' : ''}>Review Queue</option>
                        <option value="question_bank" ${s.saveDestination === 'question_bank' ? 'selected' : ''}>Question Bank</option>
                        <option value="export_only" ${s.saveDestination === 'export_only' ? 'selected' : ''}>Export Only</option>
                    </select>
                </div>
            </div>
        </div>

        <button class="btn btn-gold" style="width:100%;padding:12px;font-size:14px;" onclick="runStudioGenerate()"><i class="fas fa-magic"></i> Generate Questions</button>
    `;
}

function studioSlider(label, path, value) {
    return `<div class="studio-slider-row"><label>${label}</label>
        <input type="range" min="0" max="100" value="${value}" oninput="studioSet('${path}', parseInt(this.value)); this.nextElementSibling.textContent = this.value;">
        <span class="val">${value}</span></div>`;
}
function studioToggle(label, path, checked) {
    const id = 'tgl_' + path.replace(/\./g, '_');
    return `<label class="studio-toggle" for="${id}"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} onchange="studioSet('${path}', this.checked)"> ${label}</label>`;
}

function toggleStudioType(id) {
    const s = window._studio;
    if (s.questionTypes.includes(id)) s.questionTypes = s.questionTypes.filter(t => t !== id);
    else s.questionTypes.push(id);
    renderStudioForm();
}
function toggleStudioTag(tag) {
    const s = window._studio;
    if (s.tags.includes(tag)) s.tags = s.tags.filter(t => t !== tag);
    else s.tags.push(tag);
    renderStudioForm();
}
function addStudioCustomTag() {
    const input = document.getElementById('stuCustomTag');
    const val = (input.value || '').trim();
    if (!val) return;
    if (!window._studio.tags.includes(val)) window._studio.tags.push(val);
    renderStudioForm();
}

function studioOnNumQChange(val) {
    studioSet('generation.numQuestions', parseInt(val) || 0);
    studioAutoBalanceDifficulty();
}
function studioOnDiffChange(key, val) {
    studioSet(`difficulty.${key}`, Math.max(0, parseInt(val) || 0));
    studioUpdateDiffTotal();
}
function studioAutoBalanceDifficulty() {
    const n = window._studio.generation.numQuestions || 0;
    const base = Math.floor(n / 3);
    window._studio.difficulty = { easy: base + (n - base * 3 > 0 ? 1 : 0), medium: base + (n - base * 3 > 1 ? 1 : 0), hard: base, very_hard: 0 };
    ['easy', 'medium', 'hard', 'very_hard'].forEach(k => { const el = document.getElementById('stuDiff_' + k); if (el) el.value = window._studio.difficulty[k]; });
    studioUpdateDiffTotal();
}
function studioUpdateDiffTotal() {
    const s = window._studio;
    const total = ['easy', 'medium', 'hard', 'very_hard'].reduce((a, k) => a + (s.difficulty[k] || 0), 0);
    const el = document.getElementById('stuDiffTotal');
    if (!el) return;
    const target = s.generation.numQuestions || total;
    el.className = 'studio-diff-total ' + (total === target ? 'ok' : 'bad');
    el.textContent = `Total: ${total} / ${target} question(s)${total === target ? ' ✓' : ' — adjust so this matches Number of Questions'}`;
}

// ---- Manual source form ----
function studioManualFormHtml() {
    return `
        <div class="studio-section">
            <h4>Manual Question Entry</h4>
            <div class="form-group"><label>Question Type</label>
                <select id="stuManType">${STUDIO_QUESTION_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Question Text *</label><textarea id="stuManText" rows="2"></textarea></div>
            <div class="form-group"><label>Options (one per line, MCQ-like types only)</label><textarea id="stuManOptions" rows="4" placeholder="Option A\nOption B\nOption C\nOption D"></textarea></div>
            <div class="studio-grid-3">
                <div class="form-group"><label>Correct Answer</label><input id="stuManAnswer"></div>
                <div class="form-group"><label>Difficulty</label>
                    <select id="stuManDiff"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option><option value="very_hard">Very Hard</option></select>
                </div>
                <div class="form-group"><label>Marks</label><input id="stuManMarks" type="number" value="1" min="1"></div>
            </div>
            <div class="form-group"><label>Explanation</label><textarea id="stuManExplanation" rows="2"></textarea></div>
            <button class="btn btn-gold" onclick="addManualStudioQuestion()"><i class="fas fa-plus"></i> Add to Preview</button>
        </div>
    `;
}

function addManualStudioQuestion() {
    const s = window._studio;
    const type = document.getElementById('stuManType').value;
    const questionText = document.getElementById('stuManText').value.trim();
    const optionsRaw = document.getElementById('stuManOptions').value.trim();
    const correctAnswer = document.getElementById('stuManAnswer').value.trim();
    const difficulty = document.getElementById('stuManDiff').value;
    const marks = parseInt(document.getElementById('stuManMarks').value) || 1;
    const explanation = document.getElementById('stuManExplanation').value.trim();

    if (!questionText) { showToast('Error', 'Question text is required', 'error'); return; }

    const options = optionsRaw ? optionsRaw.split('\n').filter(Boolean).map(t => ({ text: t.trim(), isCorrect: t.trim() === correctAnswer })) : [];

    const q = {
        tempId: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        questionText, type, options, correctAnswer, difficulty, marks, explanation,
        chapter: s.academic.chapter || '', subjectId: s.academic.subjectId || null, classId: s.academic.classId || null,
        tags: s.tags.slice(), source: 'manual', aiConfidence: null, qualityScore: null, estimatedAccuracy: null,
        approved: false, rejected: false, bookmarked: false,
    };
    s.previewQuestions.push(q);
    showToast('Added', 'Question added to Preview — scroll down or click Preview to review it.', 'success');
    // Jump straight to Preview so the manually-typed question still goes
    // through the same Approve/Save gate as every other source.
    s.step = 'preview';
    renderStudio();
}

// ---- PDF Import / Image OCR / Text Input body ----
function studioImportBodyHtml() {
    const s = window._studio;
    if (s.source === 'text-input') {
        return `
            <div class="studio-section">
                <h4>Paste Text</h4>
                <textarea rows="10" placeholder="Paste question paper text here…" oninput="studioSet('extractText', this.value)">${escapeHtml(s.extractText)}</textarea>
                <button class="btn btn-gold" style="margin-top:8px;" onclick="runStudioExtract()"><i class="fas fa-magic"></i> Extract Questions</button>
            </div>
        `;
    }
    const label = s.source === 'pdf-import' ? 'Upload PDF / DOCX / TXT' : 'Upload a photo or scan (PNG/JPG)';
    const accept = s.source === 'pdf-import' ? '.pdf,.docx,.txt' : 'image/*';
    return `
        <div class="studio-section">
            <h4>${label}</h4>
            <input type="file" id="stuFileInput" accept="${accept}">
            <button class="btn btn-gold" style="margin-top:8px;" onclick="runStudioExtract()"><i class="fas fa-magic"></i> Extract Questions</button>
        </div>
    `;
}

// ============================================================
// PROGRESS BAR (Section 18)
// ============================================================
function renderStudioProgress() {
    contentArea.innerHTML = `
        <div class="studio-progress-wrap">
            <h3><i class="fas fa-magic"></i> Generating…</h3>
            <div class="studio-progress-track"><div class="studio-progress-fill" id="stuProgFill" style="width:0%;"></div></div>
            <div class="studio-progress-stage" id="stuProgStage">${STUDIO_PROGRESS_STAGES[0]}</div>
        </div>
    `;
}

function studioAdvanceProgress(stageIndex) {
    const fill = document.getElementById('stuProgFill');
    const stage = document.getElementById('stuProgStage');
    if (!fill || !stage) return;
    const pct = Math.round(((stageIndex + 1) / STUDIO_PROGRESS_STAGES.length) * 100);
    fill.style.width = pct + '%';
    stage.textContent = STUDIO_PROGRESS_STAGES[stageIndex];
}

// ============================================================
// GENERATE (AI Generate source)
// ============================================================
async function runStudioGenerate() {
    const s = window._studio;
    if (!s.academic.classId || !s.academic.subjectId) { showToast('Error', 'Class and Subject are required', 'error'); return; }
    if (!s.academic.chapter.trim()) { showToast('Error', 'Chapter is required', 'error'); return; }
    if (!s.questionTypes.length) { showToast('Error', 'Select at least one Question Type', 'error'); return; }

    const classData = s.classes.find(c => c._id === s.academic.classId);
    const subjectData = s.subjects.find(sub => sub._id === s.academic.subjectId);

    s.step = 'progress';
    renderStudio();
    studioAdvanceProgress(0);
    const stageTimer = setInterval(() => {
        const stageEl = document.getElementById('stuProgStage');
        if (!stageEl) { clearInterval(stageTimer); return; }
        const idx = STUDIO_PROGRESS_STAGES.indexOf(stageEl.textContent);
        if (idx >= 0 && idx < STUDIO_PROGRESS_STAGES.length - 2) studioAdvanceProgress(idx + 1);
    }, 900);

    const negativeInstructions = s.negativeInstructions.split('\n').map(l => l.trim()).filter(Boolean);

    const payload = {
        academic: {
            classId: s.academic.classId, subjectId: s.academic.subjectId,
            subjectName: subjectData?.name, classLevel: classData?.displayName || classData?.name,
            book: s.academic.book, chapter: s.academic.chapter, topic: s.academic.topic,
            subTopic: s.academic.subTopic, learningOutcome: s.academic.learningOutcome,
            examType: s.academic.examType, academicSession: s.academic.academicSession,
        },
        generation: { numQuestions: s.generation.numQuestions, marksEach: s.generation.marksEach, bloom: s.generation.bloom },
        questionTypes: s.questionTypes,
        pattern: s.pattern,
        difficultyDistribution: s.difficulty,
        prompt: s.prompt,
        advanced: s.advanced,
        negativeInstructions,
        tags: s.tags,
        language: s.academic.language,
    };

    const result = await apiCall('/ai-question-studio/generate', { method: 'POST', body: JSON.stringify(payload) });
    clearInterval(stageTimer);

    if (!result || !result.success) {
        showToast('Error', result?.message || 'Generation failed', 'error');
        s.step = 'form';
        renderStudio();
        return;
    }

    studioAdvanceProgress(STUDIO_PROGRESS_STAGES.length - 1);
    if (result.warning) showToast('Note', result.warning, 'info');

    s.previewQuestions = result.data.questions;
    s.selected = {};
    s.duplicates = {};
    studioSaveSessionToStorage(); // don't wait for the next 25s tick — a freshly generated batch is exactly the kind of work a crash shouldn't lose

    setTimeout(async () => {
        if (s.advanced.duplicateDetection) {
            await runStudioDuplicateCheck();
        }
        s.step = 'preview';
        renderStudio();
        showToast('Done', result.message, 'success');
    }, 500);
}

// ============================================================
// EXTRACT (PDF Import / Image OCR / Text Input sources)
// ============================================================
async function runStudioExtract() {
    const s = window._studio;
    const fileInput = document.getElementById('stuFileInput');
    const hasFile = fileInput && fileInput.files && fileInput.files[0];

    if (!hasFile && (!s.extractText || !s.extractText.trim())) {
        showToast('Error', 'Upload a file or paste text first', 'error');
        return;
    }

    s.step = 'progress';
    renderStudio();
    studioAdvanceProgress(2);

    const classData = s.classes.find(c => c._id === s.academic.classId);
    const subjectData = s.subjects.find(sub => sub._id === s.academic.subjectId);

    const formData = new FormData();
    if (hasFile) formData.append('file', fileInput.files[0]);
    else formData.append('text', s.extractText);
    formData.append('chapter', s.academic.chapter || '');
    formData.append('subjectName', subjectData?.name || 'General');
    formData.append('classLevel', classData?.displayName || classData?.name || '');

    let result;
    try {
        const res = await fetch(`${API_BASE}/ai-question-studio/extract`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }, // no Content-Type — browser sets multipart boundary for FormData
            body: formData,
        });
        result = await res.json();
    } catch (err) {
        showToast('Error', 'Server error. Please try again.', 'error');
        s.step = 'form';
        renderStudio();
        return;
    }

    if (!result || !result.success) {
        showToast('Error', result?.message || 'Extraction failed', 'error');
        s.step = 'form';
        renderStudio();
        return;
    }

    studioAdvanceProgress(STUDIO_PROGRESS_STAGES.length - 1);
    s.previewQuestions = result.data.questions.map(q => ({ ...q, chapter: q.chapter || s.academic.chapter, subjectId: s.academic.subjectId, classId: s.academic.classId }));
    s.selected = {};
    s.duplicates = {};

    setTimeout(() => {
        s.step = 'preview';
        renderStudio();
        showToast('Done', result.message, 'success');
    }, 400);
}

// ============================================================
// DUPLICATE CHECK (Section 14)
// ============================================================
async function runStudioDuplicateCheck() {
    const s = window._studio;
    if (!s.previewQuestions.length) return;
    const items = s.previewQuestions.map(q => ({ tempId: q.tempId, questionText: q.questionText }));
    const result = await apiCall('/ai-question-studio/duplicate-check', {
        method: 'POST',
        body: JSON.stringify({ items, subjectId: s.academic.subjectId, chapter: s.academic.chapter }),
    });
    if (result && result.success) {
        const map = {};
        result.data.forEach(r => { if (r.existingQuestion) map[r.tempId] = r; });
        s.duplicates = map;
    }
}

// ============================================================
// PREVIEW (Section 13, 14, 15, 16, 17)
// ============================================================
function renderStudioPreview() {
    const s = window._studio;
    const total = s.previewQuestions.length;
    const approved = s.previewQuestions.filter(q => q.approved).length;
    const rejected = s.previewQuestions.filter(q => q.rejected).length;
    const duplicates = Object.keys(s.duplicates).length;
    const selectedCount = Object.values(s.selected).filter(Boolean).length;

    contentArea.innerHTML = `
        <div class="toolbar"><h2><i class="fas fa-hat-wizard"></i> AI Question Studio — Preview</h2>
            <button class="btn btn-secondary btn-sm" onclick="backToStudioForm()"><i class="fas fa-arrow-left"></i> Back</button>
        </div>

        <div class="studio-section">
            <h4>17. Summary</h4>
            <div class="studio-summary-grid">
                <div><div class="num">${total}</div><div class="lbl">Generated</div></div>
                <div><div class="num">${approved}</div><div class="lbl">Approved</div></div>
                <div><div class="num">${rejected}</div><div class="lbl">Rejected</div></div>
                <div><div class="num">${duplicates}</div><div class="lbl">Duplicates</div></div>
                <div><div class="num">${s.lastSummary ? s.lastSummary.saved : '—'}</div><div class="lbl">Saved</div></div>
            </div>
        </div>

        <div class="studio-preview-toolbar">
            <div class="studio-bulk-bar">
                <button class="btn btn-secondary btn-sm" onclick="studioSelectAll(true)">Select All</button>
                <button class="btn btn-secondary btn-sm" onclick="studioSelectAll(false)">Clear Selection</button>
                <button class="btn btn-gold btn-sm" onclick="studioApproveAll()">Approve All</button>
                <button class="btn btn-secondary btn-sm" onclick="studioRejectAll()">Reject All</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBulkAction('approve')">Approve Selected</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBulkAction('reject')">Reject Selected</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBulkAction('regenerate')">Regenerate Selected</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBulkAction('delete')">Delete Selected</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBulkAction('export')">Export Selected</button>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
                <select id="stuSaveDest" onchange="studioSet('saveDestination', this.value)" style="max-width:170px;">
                    <option value="draft" ${s.saveDestination === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="review_queue" ${s.saveDestination === 'review_queue' ? 'selected' : ''}>Review Queue</option>
                    <option value="question_bank" ${s.saveDestination === 'question_bank' ? 'selected' : ''}>Question Bank</option>
                    <option value="export_only" ${s.saveDestination === 'export_only' ? 'selected' : ''}>Export Only</option>
                </select>
                <button class="btn btn-gold" onclick="runStudioSave()"><i class="fas fa-save"></i> Save (${approved})</button>
            </div>
        </div>

        <div class="studio-cards">${s.previewQuestions.map(studioCardHtml).join('') || '<p style="color:var(--muted);">No questions in preview yet.</p>'}</div>
    `;
    studioTypesetMath(contentArea);
}

// Re-runs MathJax over freshly-injected HTML. Needed because MathJax only
// typesets on page load by default — it has no idea contentArea.innerHTML
// (or a modal body) was just replaced with new question text, so every
// place that injects LaTeX-bearing text (question cards, the Preview
// modal, the "existing duplicate" modal) has to explicitly ask it to look
// again. No-op if MathJax hasn't finished loading yet (rare, since its
// <script> tag is in <head>, but the CDN could be briefly slow).
function studioTypesetMath(root) {
    if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
        try { window.MathJax.typesetPromise([root || contentArea]); } catch (err) { /* best-effort — a render glitch here shouldn't break the Studio */ }
    }
}

function studioCardHtml(q) {
    const s = window._studio;
    const cls = q.approved ? 'approved' : (q.rejected ? 'rejected' : '');
    const dup = s.duplicates[q.tempId];
    return `
        <div class="studio-card ${cls}" data-temp-id="${q.tempId}">
            <div class="studio-card-top">
                <input type="checkbox" ${s.selected[q.tempId] ? 'checked' : ''} onchange="studioToggleSelect('${q.tempId}', this.checked)">
                <span style="font-weight:600;">${escapeHtml((q.type || 'mcq').toUpperCase())}</span>
                ${q.bookmarked ? '<span title="Bookmarked">🔖</span>' : ''}
            </div>
            <div class="studio-card-text">${escapeHtml(q.questionText || '')}</div>
            <div class="studio-badges">
                <span class="diff-chip ${(q.difficulty || 'medium').replace('very_hard', 'hard')}">${escapeHtml(q.difficulty || 'medium')}</span>
                ${q.marks ? `<span class="studio-badge">${q.marks} mark(s)</span>` : ''}
                ${q.aiConfidence != null ? `<span class="studio-badge quality">AI ${q.aiConfidence}%</span>` : ''}
                ${q.qualityScore != null ? `<span class="studio-badge quality">Quality ${q.qualityScore}</span>` : ''}
                ${q.estimatedAccuracy != null ? `<span class="studio-badge">Est. accuracy ${q.estimatedAccuracy}%</span>` : ''}
                ${q.needsAnswerKey ? `<span class="studio-badge" style="color:var(--danger);">Needs answer key</span>` : ''}
            </div>
            ${dup ? `
                <div class="studio-dup-banner">
                    ⚠️ ${dup.similarityPercent}% similar to an existing question: "${escapeHtml((dup.existingQuestion.questionText || '').slice(0, 70))}…"
                    <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">
                        <button class="btn btn-secondary btn-sm" onclick="studioOpenExisting('${q.tempId}')">Open Existing</button>
                        <button class="btn btn-secondary btn-sm" onclick="studioDuplicateAction('${q.tempId}','skip')">Skip</button>
                        <button class="btn btn-secondary btn-sm" onclick="studioDuplicateAction('${q.tempId}','save_anyway')">Save Anyway</button>
                    </div>
                </div>` : ''}
            <div class="studio-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="studioPreviewQuestion('${q.tempId}')">Preview</button>
                <button class="btn btn-secondary btn-sm" onclick="studioEditQuestion('${q.tempId}')">Edit</button>
                <button class="btn btn-secondary btn-sm" onclick="studioRegenerateOne('${q.tempId}')">Regenerate</button>
                <button class="btn btn-secondary btn-sm" onclick="studioBookmark('${q.tempId}')">Bookmark</button>
                <button class="btn btn-gold btn-sm" onclick="studioApprove('${q.tempId}')">Approve</button>
                <button class="btn btn-secondary btn-sm" onclick="studioReject('${q.tempId}')">Reject</button>
                <button class="btn btn-secondary btn-sm" onclick="studioDeleteQuestion('${q.tempId}')">Delete</button>
            </div>
        </div>
    `;
}

function backToStudioForm() {
    window._studio.step = 'form';
    renderStudio();
}

function studioFindQuestion(tempId) {
    return window._studio.previewQuestions.find(q => q.tempId === tempId);
}

function studioToggleSelect(tempId, checked) {
    window._studio.selected[tempId] = checked;
}
function studioSelectAll(value) {
    const s = window._studio;
    s.previewQuestions.forEach(q => { s.selected[q.tempId] = value; });
    renderStudio();
}

function studioApprove(tempId) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    if (q.needsAnswerKey && !q.correctAnswer) {
        showToast('Error', 'This question needs an answer key before it can be approved — click Edit.', 'error');
        return;
    }
    q.approved = true; q.rejected = false;
    renderStudio();
}
function studioReject(tempId) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    q.approved = false; q.rejected = true;
    renderStudio();
}
function studioApproveAll() {
    const s = window._studio;
    if (!s.previewQuestions.length) return;
    let blocked = 0;
    s.previewQuestions.forEach(q => {
        if (q.needsAnswerKey && !q.correctAnswer) { blocked++; return; }
        q.approved = true; q.rejected = false;
    });
    renderStudio();
    if (blocked > 0) showToast('Note', `${blocked} question(s) need an answer key before they can be approved — edit them individually.`, 'info');
}
function studioRejectAll() {
    const s = window._studio;
    if (!s.previewQuestions.length) return;
    s.previewQuestions.forEach(q => { q.approved = false; q.rejected = true; });
    renderStudio();
}
function studioBookmark(tempId) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    q.bookmarked = !q.bookmarked;
    renderStudio();
}
function studioDeleteQuestion(tempId) {
    const s = window._studio;
    s.previewQuestions = s.previewQuestions.filter(q => q.tempId !== tempId);
    delete s.selected[tempId];
    delete s.duplicates[tempId];
    renderStudio();
}

function studioDuplicateAction(tempId, action) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    if (action === 'skip') { q.duplicateAction = 'skip'; q.rejected = true; q.approved = false; }
    else { q.duplicateAction = 'save_anyway'; delete window._studio.duplicates[tempId]; }
    renderStudio();
}
function studioOpenExisting(tempId) {
    const dup = window._studio.duplicates[tempId];
    if (!dup) return;
    showModal('Existing Question', `${dup.similarityPercent}% similar — currently ${escapeHtml(dup.existingQuestion.status || 'draft')}`, `
        <div class="form-group"><label>Question Text</label><p>${escapeHtml(dup.existingQuestion.questionText)}</p></div>
    `, null);
    document.getElementById('modalSaveBtn').style.display = 'none';
    studioTypesetMath(document.getElementById('modalBody'));
}

function studioPreviewQuestion(tempId) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    const optionsHtml = (q.options || []).map((o, i) => `<p>${String.fromCharCode(65 + i)}. ${escapeHtml(o.text || o)} ${o.isCorrect ? '✅' : ''}</p>`).join('');
    showModal('Question Preview', (q.type || 'mcq').toUpperCase(), `
        <div class="form-group"><label>Question</label><p>${escapeHtml(q.questionText)}</p></div>
        ${q.caseText ? `<div class="form-group"><label>Case Text</label><p>${escapeHtml(q.caseText)}</p></div>` : ''}
        ${q.assertion ? `<div class="form-group"><label>Assertion</label><p>${escapeHtml(q.assertion)}</p><label>Reason</label><p>${escapeHtml(q.reason || '')}</p></div>` : ''}
        ${optionsHtml}
        ${q.correctAnswer ? `<div class="form-group"><label>Correct Answer</label><p>${escapeHtml(String(q.correctAnswer))}</p></div>` : ''}
        ${q.explanation ? `<div class="form-group"><label>Explanation</label><p>${escapeHtml(q.explanation)}</p></div>` : ''}
        ${q.hint ? `<div class="form-group"><label>Hint</label><p>${escapeHtml(q.hint)}</p></div>` : ''}
        ${q.stepSolution ? `<div class="form-group"><label>Step Solution</label><p>${escapeHtml(q.stepSolution)}</p></div>` : ''}
    `, null);
    document.getElementById('modalSaveBtn').style.display = 'none';
    studioTypesetMath(document.getElementById('modalBody'));
}

function studioEditQuestion(tempId) {
    const q = studioFindQuestion(tempId);
    if (!q) return;
    const optionsText = (q.options || []).map(o => o.text || o).join('\n');
    showModal('Edit Question', 'Update the question before approving it', `
        <div class="form-group"><label>Question Text</label><textarea id="stuEditText" rows="3">${escapeHtml(q.questionText)}</textarea></div>
        <div class="form-group"><label>Options (one per line, if applicable)</label><textarea id="stuEditOptions" rows="4">${escapeHtml(optionsText)}</textarea></div>
        <div class="form-group"><label>Correct Answer</label><input id="stuEditAnswer" value="${escapeHtml(String(q.correctAnswer || ''))}"></div>
        <div class="form-group"><label>Explanation</label><textarea id="stuEditExplanation" rows="2">${escapeHtml(q.explanation || '')}</textarea></div>
    `, () => {
        q.questionText = document.getElementById('stuEditText').value.trim();
        const optLines = document.getElementById('stuEditOptions').value.split('\n').map(l => l.trim()).filter(Boolean);
        const newAnswer = document.getElementById('stuEditAnswer').value.trim();
        if (optLines.length) q.options = optLines.map(t => ({ text: t, isCorrect: t === newAnswer }));
        q.correctAnswer = newAnswer;
        q.explanation = document.getElementById('stuEditExplanation').value.trim();
        if (q.needsAnswerKey && newAnswer) q.needsAnswerKey = false;
        closeModal();
        renderStudio();
        showToast('Saved', 'Question updated', 'success');
    });
}

async function studioRegenerateOne(tempId) {
    const s = window._studio;
    const q = studioFindQuestion(tempId);
    if (!q) return;
    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    const result = await apiCall('/ai-question-studio/regenerate', {
        method: 'POST',
        body: JSON.stringify({
            type: q.type, difficulty: q.difficulty,
            academic: { chapter: q.chapter, subjectId: q.subjectId, classId: q.classId },
            pattern: s.pattern, bloom: s.generation.bloom, advanced: s.advanced,
            negativeInstructions: s.negativeInstructions.split('\n').filter(Boolean), tags: s.tags,
            language: s.academic.language, prompt: s.prompt,
            excludeTexts: s.previewQuestions.map(x => x.questionText),
        }),
    });

    if (!result || !result.success) {
        showToast('Error', result?.message || 'Could not regenerate', 'error');
        renderStudio();
        return;
    }
    const idx = s.previewQuestions.findIndex(x => x.tempId === tempId);
    if (idx !== -1) s.previewQuestions[idx] = { ...result.data, chapter: q.chapter, subjectId: q.subjectId, classId: q.classId };
    delete s.duplicates[tempId];
    renderStudio();
    showToast('Regenerated', 'Question replaced', 'success');
}

async function studioBulkAction(action) {
    const s = window._studio;
    const ids = Object.keys(s.selected).filter(id => s.selected[id]);
    if (!ids.length) { showToast('Error', 'Select at least one question first', 'error'); return; }

    if (action === 'approve') ids.forEach(id => { const q = studioFindQuestion(id); if (q && !(q.needsAnswerKey && !q.correctAnswer)) { q.approved = true; q.rejected = false; } });
    else if (action === 'reject') ids.forEach(id => { const q = studioFindQuestion(id); if (q) { q.rejected = true; q.approved = false; } });
    else if (action === 'delete') { s.previewQuestions = s.previewQuestions.filter(q => !ids.includes(q.tempId)); ids.forEach(id => { delete s.selected[id]; delete s.duplicates[id]; }); }
    else if (action === 'regenerate') { for (const id of ids) await studioRegenerateOneSilent(id); }
    else if (action === 'export') { await studioExport(s.previewQuestions.filter(q => ids.includes(q.tempId))); return; }

    renderStudio();
}

async function studioRegenerateOneSilent(tempId) {
    const s = window._studio;
    const q = studioFindQuestion(tempId);
    if (!q) return;
    const result = await apiCall('/ai-question-studio/regenerate', {
        method: 'POST',
        body: JSON.stringify({
            type: q.type, difficulty: q.difficulty,
            academic: { chapter: q.chapter, subjectId: q.subjectId, classId: q.classId },
            pattern: s.pattern, bloom: s.generation.bloom, advanced: s.advanced,
            negativeInstructions: s.negativeInstructions.split('\n').filter(Boolean), tags: s.tags,
            language: s.academic.language, prompt: s.prompt,
            excludeTexts: s.previewQuestions.map(x => x.questionText),
        }),
    });
    if (result && result.success) {
        const idx = s.previewQuestions.findIndex(x => x.tempId === tempId);
        if (idx !== -1) s.previewQuestions[idx] = { ...result.data, chapter: q.chapter, subjectId: q.subjectId, classId: q.classId };
    }
}

// ============================================================
// SAVE (Section 12/17)
// ============================================================
async function runStudioSave() {
    const s = window._studio;
    const approvedCount = s.previewQuestions.filter(q => q.approved).length;
    if (!approvedCount) { showToast('Error', 'Approve at least one question before saving', 'error'); return; }

    const result = await apiCall('/ai-question-studio/save', {
        method: 'POST',
        body: JSON.stringify({ items: s.previewQuestions, destination: s.saveDestination }),
    });

    if (!result || !result.success) { showToast('Error', result?.message || 'Save failed', 'error'); return; }

    s.lastSummary = result.data.summary;
    studioSaveSessionToStorage();
    showToast('Saved', result.message, 'success');

    if (s.saveDestination === 'export_only') {
        await studioExport(s.previewQuestions.filter(q => q.approved));
    }
    renderStudio();
}

// ============================================================
// EXPORT (Section 11)
// ============================================================
async function studioExport(items) {
    if (!items || !items.length) { showToast('Error', 'Nothing selected to export', 'error'); return; }
    const format = window._studio.outputFormat === 'question_bank' ? 'json' : window._studio.outputFormat;

    if (format === 'json') {
        const result = await apiCall('/ai-question-studio/export', { method: 'POST', body: JSON.stringify({ items, format }) });
        if (result && result.success) {
            const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
            studioDownloadBlob(blob, `ai-question-studio-${Date.now()}.json`);
        }
        return;
    }

    // html/printable/pdf all return non-JSON bodies — use a raw fetch.
    try {
        const res = await fetch(`${API_BASE}/ai-question-studio/export`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, format }),
        });
        const blob = await res.blob();
        if (format === 'pdf') studioDownloadBlob(blob, `ai-question-studio-${Date.now()}.pdf`);
        else { const url = URL.createObjectURL(blob); window.open(url, '_blank'); }
    } catch (err) {
        showToast('Error', 'Export failed', 'error');
    }
}

function studioDownloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
