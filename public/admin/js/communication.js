// public/admin/js/communication.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

const COMM_TARGET_LABELS = {
    class: 'Class',
    batch: 'Batch',
    individual: 'Individual Student',
    pending_fees: 'Students with Pending Fees',
    absent_today: 'Absent Today',
};

async function loadCommunication() {
    showLoading();
    try {
        const [classesRes, batchesRes, historyRes] = await Promise.all([
            apiCall('/classes'),
            apiCall('/communication/batches'),
            apiCall('/communication/history'),
        ]);
        window._classes = classesRes?.data || [];
        window._commBatches = batchesRes?.data || [];
        window._commHistory = historyRes?.data || [];
        renderCommunication();
    } catch (error) {
        showError('Failed to load Communication Center', error.message);
    }
}

function renderCommunication() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📢 Communication Center</h2>
        </div>
        <div class="builder-grid">
            <div class="builder-panel">
                <h3>✉️ Compose</h3>
                <div class="form-group"><label>Title *</label><input type="text" id="commTitle" placeholder="e.g., Fee Due Reminder"></div>
                <div class="form-group"><label>Message *</label><textarea id="commMessage" rows="4" placeholder="Type your message…"></textarea></div>

                <div class="form-group">
                    <label>Channels *</label>
                    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="comm-channel" value="push" checked> 🔔 Push (in-app)</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="comm-channel" value="email"> 📧 Email</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="comm-channel" value="whatsapp"> 💬 WhatsApp</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="comm-channel" value="sms"> 📱 SMS</label>
                    </div>
                    <p style="font-size:11px;color:var(--muted);margin-top:4px;">Email/WhatsApp/SMS need SMTP/Twilio configured in .env — otherwise they're logged but not actually sent.</p>
                </div>

                <div class="form-group">
                    <label>Target By *</label>
                    <select id="commTargetType" onchange="renderCommTargetSubfield()">
                        ${Object.entries(COMM_TARGET_LABELS).map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
                    </select>
                </div>
                <div id="commTargetSubfield"></div>

                <div style="display:flex;align-items:center;gap:10px;margin:10px 0;">
                    <button class="btn btn-secondary btn-sm" onclick="previewCommTargets()"><i class="fas fa-users"></i> Preview Recipients</button>
                    <span id="commPreviewResult" style="font-size:13px;color:var(--muted);"></span>
                </div>

                <button class="btn btn-gold" onclick="sendCommunication()"><i class="fas fa-paper-plane"></i> Send</button>
            </div>

            <div class="builder-panel">
                <h3>🕒 Recent Sends</h3>
                <div class="builder-list" style="max-height:600px;">
                    ${(window._commHistory || []).length === 0 ? `<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">No broadcasts sent yet.</div>` : (window._commHistory || []).map(b => `
                        <div class="builder-card" style="cursor:default;">
                            <div class="builder-card-body">
                                <div class="builder-card-text"><strong>${escapeHtml(b.title)}</strong></div>
                                <div style="font-size:12px;color:var(--text);margin-top:4px;">${escapeHtml(b.message.slice(0, 100))}${b.message.length > 100 ? '…' : ''}</div>
                                <div class="builder-card-meta">
                                    ${b.channels.map(c => `<span class="diff-chip medium">${c}</span>`).join('')}
                                    <span style="font-size:10px;color:var(--muted);">${COMM_TARGET_LABELS[b.targetType] || b.targetType} · ${b.recipientCount} recipient(s) · ${new Date(b.createdAt).toLocaleString('en-IN')}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    renderCommTargetSubfield();
}

function renderCommTargetSubfield() {
    const targetType = document.getElementById('commTargetType').value;
    const container = document.getElementById('commTargetSubfield');
    const classes = window._classes || [];
    const batches = window._commBatches || [];

    if (targetType === 'class') {
        container.innerHTML = `
            <div class="form-group"><label>Class</label>
                <select id="commTargetValue">
                    ${classes.map(c => `<option value="${c._id}">${escapeHtml(c.displayName || c.name)}</option>`).join('')}
                </select>
            </div>`;
    } else if (targetType === 'batch') {
        container.innerHTML = batches.length === 0
            ? `<p style="font-size:12px;color:var(--muted);">No batches assigned to any student yet — set a student's Batch from the Students page first.</p>`
            : `<div class="form-group"><label>Batch</label>
                <select id="commTargetValue">${batches.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}</select>
               </div>`;
    } else if (targetType === 'individual') {
        container.innerHTML = `<div class="form-group"><label>Student</label><input type="text" id="commIndividualSearch" placeholder="Type a name to search…" oninput="commSearchStudent(this.value)"><div id="commStudentResults"></div></div>`;
    } else {
        // pending_fees / absent_today need no extra field
        container.innerHTML = targetType === 'absent_today'
            ? `<p style="font-size:12px;color:var(--muted);">Targets everyone marked "Absent" in today's attendance.</p>`
            : `<p style="font-size:12px;color:var(--muted);">Targets everyone with at least one unpaid fee installment.</p>`;
    }
    document.getElementById('commPreviewResult').textContent = '';
    window._commSelectedIndividual = null;
}

let commSearchTimer = null;
function commSearchStudent(query) {
    clearTimeout(commSearchTimer);
    const resultsEl = document.getElementById('commStudentResults');
    if (!query || query.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    commSearchTimer = setTimeout(async () => {
        const res = await apiCall('/students-list');
        const matches = (res?.data || []).filter(s => s.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
        resultsEl.innerHTML = matches.map(s => `
            <div class="builder-card" style="margin-top:6px;" onclick="commSelectStudent('${s._id}', '${escapeHtml(s.name).replace(/'/g, "\\'")}')">
                <div class="builder-card-body"><div class="builder-card-text">${escapeHtml(s.name)} <span style="color:var(--muted);font-size:11px;">(${escapeHtml(s.class)})</span></div></div>
            </div>
        `).join('') || `<div style="font-size:12px;color:var(--muted);padding:6px;">No match found</div>`;
    }, 300);
}

function commSelectStudent(id, name) {
    window._commSelectedIndividual = id;
    document.getElementById('commIndividualSearch').value = name;
    document.getElementById('commStudentResults').innerHTML = '';
}

function getCommTargetValue() {
    const targetType = document.getElementById('commTargetType').value;
    if (targetType === 'individual') return window._commSelectedIndividual || '';
    const el = document.getElementById('commTargetValue');
    return el ? el.value : '';
}

async function previewCommTargets() {
    const targetType = document.getElementById('commTargetType').value;
    const targetValue = getCommTargetValue();
    const resultEl = document.getElementById('commPreviewResult');
    resultEl.textContent = 'Loading…';

    const params = new URLSearchParams({ targetType });
    if (targetValue) params.set('targetValue', targetValue);
    const result = await apiCall(`/communication/targets/preview?${params.toString()}`);
    if (!result || !result.success) { resultEl.textContent = 'Failed to preview'; return; }

    resultEl.textContent = result.data.count === 0
        ? 'No students match this target.'
        : `${result.data.count} student(s): ${result.data.students.slice(0, 5).map(s => s.name).join(', ')}${result.data.count > 5 ? '…' : ''}`;
}

async function sendCommunication() {
    const title = document.getElementById('commTitle').value.trim();
    const message = document.getElementById('commMessage').value.trim();
    const channels = Array.from(document.querySelectorAll('.comm-channel:checked')).map(el => el.value);
    const targetType = document.getElementById('commTargetType').value;
    const targetValue = getCommTargetValue();

    if (!title || !message) { showToast('Error', 'Title and message are required', 'error'); return; }
    if (channels.length === 0) { showToast('Error', 'Select at least one channel', 'error'); return; }
    if ((targetType === 'class' || targetType === 'batch' || targetType === 'individual') && !targetValue) {
        showToast('Error', 'Select a target', 'error'); return;
    }
    if (!confirm(`Send "${title}" via ${channels.join(', ')}? This cannot be undone.`)) return;

    const result = await apiCall('/communication/send', {
        method: 'POST',
        body: JSON.stringify({ title, message, channels, targetType, targetValue })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send', 'error'); return; }
    showToast('Success', result.message, 'success');
    loadCommunication();
}

// ============================================================
// ============================================================
// AI TOOLS (Admin)
