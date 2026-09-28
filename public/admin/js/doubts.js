// public/admin/js/doubts.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

const DOUBT_STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
let currentDoubtDetail = null;

async function loadDoubts() {
    showLoading();
    try {
        const result = await apiCall('/doubts');
        currentData = result?.data || [];
        renderDoubts();
        refreshDoubtsBadge();
    } catch (error) {
        showError('Failed to load doubts', error.message);
    }
}

async function refreshDoubtsBadge() {
    try {
        const res = await apiCall('/doubts?status=open');
        const count = res?.data?.length || 0;
        
        // Sidebar badge
        const badge = document.getElementById('doubtsBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        
        // Notification bell - doubts count
        const notifDoubt = document.getElementById('notifDoubtsCount');
        if (notifDoubt) notifDoubt.textContent = count;
        
        // Sync bell dot
        syncBellDot();
    } catch (e) { /* non-critical */ }
}

function renderDoubts() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>💬 Doubts <span class="count">(${currentData.length})</span></h2>
            <select id="doubtStatusFilter" onchange="filterDoubts()" style="max-width:180px;">
                <option value="">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
            </select>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">💬</span><strong>No Doubts</strong><p>Student questions will show up here.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Student</th><th>Question</th><th>Priority</th><th>Status</th><th>Replies</th><th>Asked</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(d => `
                            <tr>
                                <td>${escapeHtml(d.studentName)}</td>
                                <td style="max-width:280px;">${escapeHtml((d.questionText || '').slice(0, 80))}${d.questionText.length > 80 ? '…' : ''} ${d.imageFilename ? '<i class="fas fa-image" style="color:var(--muted);" title="Has image"></i>' : ''} ${d.voiceNoteFilename ? '<i class="fas fa-microphone" style="color:var(--muted);" title="Has voice note"></i>' : ''}</td>
                                <td><span class="priority-chip priority-${d.priority}">${d.priority}</span></td>
                                <td><span class="status-badge status-${d.status}">${DOUBT_STATUS_LABELS[d.status]}</span></td>
                                <td>${d.replyCount}</td>
                                <td>${new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                                <td><button class="btn btn-gold btn-sm" onclick="openDoubtDetail('${d._id}')"><i class="fas fa-reply"></i> View</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

async function filterDoubts() {
    const status = document.getElementById('doubtStatusFilter').value;
    showLoading();
    const result = await apiCall(`/doubts${status ? `?status=${status}` : ''}`);
    currentData = result?.data || [];
    renderDoubts();
    document.getElementById('doubtStatusFilter').value = status;
}

async function openDoubtDetail(id) {
    showLoading();
    try {
        const result = await apiCall(`/doubts/${id}`);
        if (!result || !result.success) { showError('Failed to load doubt', result?.message || ''); return; }
        currentDoubtDetail = result.data;
        renderDoubtDetail();
    } catch (error) {
        showError('Failed to load doubt', error.message);
    }
}

function renderDoubtDetail() {
    const { doubt, replies } = currentDoubtDetail;
    contentArea.innerHTML = `
        <div class="toolbar">
            <button class="btn btn-secondary btn-sm" onclick="loadDoubts()"><i class="fas fa-arrow-left"></i> Back to Doubts</button>
        </div>
        <div class="doubt-detail-card">
            <h3>${escapeHtml(doubt.studentName)}'s Doubt</h3>
            <p style="margin-top:8px;color:var(--text);">${escapeHtml(doubt.questionText)}</p>

            <div class="doubt-attachment-row">
                ${doubt.imageFilename ? `<img src="${API_BASE}/doubts/${doubt._id}/image" loading="lazy" onclick="window.open(this.src, '_blank')" alt="Doubt image">` : ''}
                ${doubt.voiceNoteFilename ? `<audio controls src="${API_BASE}/doubts/${doubt._id}/voice"></audio>` : ''}
            </div>

            <div class="doubt-controls">
                <div class="form-group">
                    <label>Status</label>
                    <select id="doubtStatusSelect" onchange="updateDoubtStatus('${doubt._id}', this.value)">
                        ${Object.entries(DOUBT_STATUS_LABELS).map(([val, label]) => `<option value="${val}" ${doubt.status === val ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Priority</label>
                    <select id="doubtPrioritySelect" onchange="updateDoubtPriority('${doubt._id}', this.value)">
                        ${['low', 'medium', 'high', 'urgent'].map(p => `<option value="${p}" ${doubt.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <h4 style="margin-top:16px;color:var(--white);font-size:14px;">Replies</h4>
            <div class="doubt-reply-thread">
                ${replies.length === 0 ? `<p style="color:var(--muted);font-size:13px;">No replies yet.</p>` : replies.map(r => `
                    <div class="doubt-reply-bubble">
                        <div>${escapeHtml(r.message)}</div>
                        <div class="doubt-reply-meta">${escapeHtml(r.repliedByName || 'Admin')} · ${new Date(r.createdAt).toLocaleString('en-IN')}</div>
                    </div>
                `).join('')}
            </div>

            <div class="doubt-reply-form">
                <textarea id="doubtReplyText" rows="2" placeholder="Type your reply…"></textarea>
                <button class="btn btn-gold" onclick="sendDoubtReply('${doubt._id}')"><i class="fas fa-paper-plane"></i> Reply</button>
            </div>
        </div>
    `;
}

async function sendDoubtReply(id) {
    const textarea = document.getElementById('doubtReplyText');
    const message = textarea.value.trim();
    if (!message) { showToast('Error', 'Reply cannot be empty', 'error'); return; }

    const result = await apiCall(`/doubts/${id}/reply`, { method: 'POST', body: JSON.stringify({ message }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send reply', 'error'); return; }
    showToast('Success', 'Reply sent', 'success');
    openDoubtDetail(id);
}

async function updateDoubtStatus(id, status) {
    const result = await apiCall(`/doubts/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update status', 'error'); return; }
    showToast('Success', 'Status updated', 'success');
    currentDoubtDetail.doubt.status = status;
    refreshDoubtsBadge();
}

async function updateDoubtPriority(id, priority) {
    const result = await apiCall(`/doubts/${id}/priority`, { method: 'PUT', body: JSON.stringify({ priority }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update priority', 'error'); return; }
    showToast('Success', 'Priority updated', 'success');
    currentDoubtDetail.doubt.priority = priority;
}

// ============================================================
// ============================================================
// COMMUNICATION CENTER (Admin)