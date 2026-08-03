// public/admin/js/audit-logs.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// AUDIT LOGS
// ============================================================
async function loadAuditLogs() {
    showLoading();
    try {
        const response = await apiCall('/audit-logs');
        window._allAuditLogs = response?.data || [];
        renderAuditLogs(window._allAuditLogs);
    } catch (error) {
        showError('Failed to load audit logs', error.message);
    }
}

function renderAuditLogs(logs) {
    const actionColors = {
        login: '#22c55e', login_failed: '#ef4444', create: '#3b82f6',
        edit: '#F5A623', delete: '#ef4444', import: '#a855f7', export: '#06b6d4'
    };
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🛡️ Audit Logs <span class="count">(${logs.length})</span></h2>
        </div>
        <div class="form-group" style="max-width:220px;margin-bottom:14px;">
            <select id="auditActionFilter" onchange="filterAuditLogs(this.value)">
                <option value="">All Actions</option>
                <option value="login">Login</option>
                <option value="login_failed">Failed Login</option>
                <option value="create">Create</option>
                <option value="edit">Edit</option>
                <option value="delete">Delete</option>
                <option value="import">Import</option>
                <option value="export">Export</option>
            </select>
        </div>
        <div id="auditLogsContainer"></div>
    `;
    renderAuditLogsTable(logs, actionColors);
}

function renderAuditLogsTable(logs, actionColors) {
    const container = document.getElementById('auditLogsContainer');
    container.innerHTML = logs.length === 0 ? `
        <div class="empty-state"><span class="icon">🛡️</span><strong>No Activity Yet</strong><p>Admin actions will appear here as they happen.</p></div>
    ` : `
        <div class="table-container">
            <table>
                <thead><tr><th>Admin</th><th>Action</th><th>Type</th><th>Details</th><th>IP</th><th>When</th></tr></thead>
                <tbody>
                    ${logs.map(l => `
                        <tr>
                            <td>${escapeHtml(l.adminName)}</td>
                            <td><span style="color:${actionColors[l.action] || 'var(--muted)'};font-weight:600;text-transform:uppercase;font-size:11px;">${escapeHtml(l.action)}</span></td>
                            <td>${escapeHtml(l.targetType)}</td>
                            <td style="color:var(--muted);">${escapeHtml(l.details)}</td>
                            <td style="color:var(--muted);font-size:12px;">${escapeHtml(l.ip)}</td>
                            <td style="color:var(--muted);font-size:12px;">${new Date(l.createdAt).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function filterAuditLogs(action) {
    const actionColors = {
        login: '#22c55e', login_failed: '#ef4444', create: '#3b82f6',
        edit: '#F5A623', delete: '#ef4444', import: '#a855f7', export: '#06b6d4'
    };
    const filtered = !action ? window._allAuditLogs : window._allAuditLogs.filter(l => l.action === action);
    renderAuditLogsTable(filtered, actionColors);
}

