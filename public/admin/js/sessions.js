// public/admin/js/sessions.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ACTIVE SESSIONS (every currently logged-in device, any role — force-logout capable)
// ============================================================
async function loadActiveSessions() {
    showLoading();
    try {
        // These live under /api/auth/... not /api/admin/..., so this can't
        // go through the apiCall() helper (which always prefixes API_BASE).
        const response = await fetch('/api/admin/sessions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        renderActiveSessions(data?.data || []);
    } catch (error) {
        showError('Failed to load active sessions', error.message);
    }
}

function renderActiveSessions(sessions) {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🖥️ Active Sessions <span class="count">(${sessions.length})</span></h2>
        </div>
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Every device currently logged in, across all roles. End a session to force that device to log out immediately.</p>
        <div id="activeSessionsContainer"></div>
    `;
    const container = document.getElementById('activeSessionsContainer');
    container.innerHTML = sessions.length === 0 ? `
        <div class="empty-state"><span class="icon">🖥️</span><strong>No Active Sessions</strong></div>
    ` : `
        <div class="table-container">
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Device</th><th>IP</th><th>Last Active</th><th></th></tr></thead>
                <tbody>
                    ${sessions.map(s => `
                        <tr>
                            <td>${escapeHtml(s.name || '—')} ${s.current ? '<span style="color:#22c55e;font-size:11px;font-weight:700;">(this device)</span>' : ''}</td>
                            <td>${escapeHtml(s.email)}</td>
                            <td style="text-transform:capitalize;">${escapeHtml(s.role || '—')}</td>
                            <td style="color:var(--muted);">${escapeHtml(s.device || 'Unknown device')}</td>
                            <td style="color:var(--muted);font-size:12px;">${escapeHtml(s.ip)}</td>
                            <td style="color:var(--muted);font-size:12px;">${new Date(s.lastSeenAt || s.createdAt).toLocaleString()}</td>
                            <td>${s.current ? '' : `<button class="btn btn-danger" style="padding:5px 12px;font-size:12px;" onclick="endSession('${s._id}')">End Session</button>`}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function endSession(sessionId) {
    if (!confirm('End this session? That device will be logged out immediately.')) return;
    try {
        const response = await fetch(`/api/admin/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            showToast('Session Ended', data.message, 'success');
            loadActiveSessions();
        } else {
            showToast('Error', data.message || 'Could not end session', 'error');
        }
    } catch (error) {
        showToast('Error', 'Server error. Please try again.', 'error');
    }
}

// ============================================================
// LOGIN HISTORY (all roles — admin/staff + students, plus device info)
// ============================================================
async function loadLoginHistory() {
    showLoading();
    try {
        const response = await apiCall('/login-history');
        window._allLoginHistory = response?.data || [];
        renderLoginHistory(window._allLoginHistory);
    } catch (error) {
        showError('Failed to load login history', error.message);
    }
}

function renderLoginHistory(logs) {
    const failedCount = logs.filter(l => l.status === 'failed').length;
    const lockedCount = logs.filter(l => l.status === 'locked').length;
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🕘 Login History <span class="count">(${logs.length})</span></h2>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
            <div class="form-group" style="max-width:180px;margin-bottom:0;">
                <select id="loginStatusFilter" onchange="filterLoginHistory()">
                    <option value="">All Statuses</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="locked">Locked</option>
                </select>
            </div>
            <div class="form-group" style="max-width:180px;margin-bottom:0;">
                <select id="loginRoleFilter" onchange="filterLoginHistory()">
                    <option value="">All Roles</option>
                    <option value="admin">Staff / Admin</option>
                    <option value="student">Student</option>
                </select>
            </div>
            ${failedCount > 0 || lockedCount > 0 ? `<div style="align-self:center;color:var(--muted);font-size:13px;">⚠️ ${failedCount} failed, ${lockedCount} locked in this list</div>` : ''}
        </div>
        <div id="loginHistoryContainer"></div>
    `;
    renderLoginHistoryTable(logs);
}

function renderLoginHistoryTable(logs) {
    const statusColors = { success: '#22c55e', failed: '#ef4444', locked: '#f97316' };
    const container = document.getElementById('loginHistoryContainer');
    container.innerHTML = logs.length === 0 ? `
        <div class="empty-state"><span class="icon">🕘</span><strong>No Login Activity Yet</strong><p>Login attempts (successful and failed) will appear here.</p></div>
    ` : `
        <div class="table-container">
            <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Device</th><th>IP</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>
                    ${logs.map(l => `
                        <tr>
                            <td>${escapeHtml(l.name || '—')}</td>
                            <td>${escapeHtml(l.email)}</td>
                            <td style="text-transform:capitalize;">${escapeHtml(l.role || '—')}</td>
                            <td><span style="color:${statusColors[l.status] || 'var(--muted)'};font-weight:600;text-transform:uppercase;font-size:11px;">${escapeHtml(l.status)}</span></td>
                            <td style="color:var(--muted);">${escapeHtml(l.device || 'Unknown device')}</td>
                            <td style="color:var(--muted);font-size:12px;">${escapeHtml(l.ip)}</td>
                            <td style="color:var(--muted);font-size:12px;">${escapeHtml(l.reason || '—')}</td>
                            <td style="color:var(--muted);font-size:12px;">${new Date(l.createdAt).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function filterLoginHistory() {
    const status = document.getElementById('loginStatusFilter').value;
    const role = document.getElementById('loginRoleFilter').value;
    let logs = window._allLoginHistory || [];
    if (status) logs = logs.filter(l => l.status === status);
    if (role) logs = logs.filter(l => l.role === role);
    renderLoginHistoryTable(logs);
}

