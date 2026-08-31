// public/admin/js/footer-management.js
//
// Admin -> Footer Management. Four sub-tabs sharing one contentArea:
//   1. Social Links      — /api/admin/social-links
//   2. Quick Links        — /api/admin/footer-links?column=quick_links
//   3. Student Resources  — /api/admin/footer-links?column=student_resources
//   4. Settings            — About / Contact Info / Bottom Bar
//                            (/api/admin/footer-settings, a singleton)
//
// Follows the same load -> render table -> modal add/edit -> toggle
// active -> delete-with-confirm shape as public/admin/js/categories.js,
// plus real drag-and-drop reordering (falling back to up/down arrow
// buttons for keyboard/accessibility) and toggle-switch controls per the
// Footer Management spec's UI requirements.

const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'WhatsApp', 'YouTube', 'LinkedIn', 'Telegram', 'Twitter/X'];
const SOCIAL_PLATFORM_ICONS = {
    'Facebook': 'fab fa-facebook-f',
    'Instagram': 'fab fa-instagram',
    'WhatsApp': 'fab fa-whatsapp',
    'YouTube': 'fab fa-youtube',
    'LinkedIn': 'fab fa-linkedin-in',
    'Telegram': 'fab fa-telegram-plane',
    'Twitter/X': 'fab fa-x-twitter',
};

window._footerMgmtTab = window._footerMgmtTab || 'social';

// ============================================================
// ENTRY POINT + TAB BAR
// ============================================================
async function loadFooterManagement() {
    renderFooterManagement();
}

function renderFooterManagement() {
    const tab = window._footerMgmtTab;
    const tabs = [
        { key: 'social', label: 'Social Links', icon: 'fa-share-alt' },
        { key: 'quick_links', label: 'Quick Links', icon: 'fa-link' },
        { key: 'student_resources', label: 'Student Resources', icon: 'fa-book-reader' },
        { key: 'settings', label: 'Settings', icon: 'fa-sliders-h' },
    ];

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🦶 Footer Management</h2>
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:-6px 0 14px;max-width:680px;">
            Everything shown in the public website's footer — social icons, the Quick Links and Student Resources
            columns, the About/Contact text, and the bottom copyright bar — is managed here and reflected live on
            every page.
        </p>
        <div class="footer-tabs">
            ${tabs.map(t => `
                <button class="footer-tab ${tab === t.key ? 'active' : ''}" onclick="switchFooterMgmtTab('${t.key}')">
                    <i class="fas ${t.icon}"></i> ${t.label}
                </button>
            `).join('')}
        </div>
        <div id="footerMgmtBody"><div class="loading"><div class="spinner"></div><p>Loading...</p></div></div>
    `;

    if (tab === 'social') loadSocialLinksTab();
    else if (tab === 'quick_links') loadFooterLinksTab('quick_links', 'Quick Links');
    else if (tab === 'student_resources') loadFooterLinksTab('student_resources', 'Student Resources');
    else if (tab === 'settings') loadFooterSettingsTab();
}

function switchFooterMgmtTab(tab) {
    window._footerMgmtTab = tab;
    renderFooterManagement();
}

// ============================================================
// GENERIC DRAG-AND-DROP REORDER
// ============================================================
// Wires HTML5 drag-and-drop on every `[data-drag-id]` row inside
// `containerId`, and calls `onDrop(orderedIds)` once a row is actually
// dropped in a new position. Up/down arrow buttons (rendered separately
// by each tab, calling the same reorder endpoints) remain the
// accessible/keyboard-friendly way to reorder — this is purely additive.
function enableDragReorder(containerId, onDrop) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let dragEl = null;

    container.querySelectorAll('[data-drag-id]').forEach(row => {
        row.addEventListener('dragstart', () => {
            dragEl = row;
            row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => {
            row.classList.remove('dragging');
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (row !== dragEl) row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.classList.remove('drag-over');
            if (!dragEl || row === dragEl) return;

            const rows = Array.from(container.querySelectorAll('[data-drag-id]'));
            const fromIdx = rows.indexOf(dragEl);
            const toIdx = rows.indexOf(row);
            rows.splice(fromIdx, 1);
            rows.splice(toIdx, 0, dragEl);

            const orderedIds = rows.map(r => r.dataset.dragId);
            onDrop(orderedIds);
        });
    });
}

// ============================================================
// 1. SOCIAL LINKS
// ============================================================
async function loadSocialLinksTab() {
    const body = document.getElementById('footerMgmtBody');
    body.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const res = await apiCall('/social-links');
        window._socialLinks = res?.data || [];
        renderSocialLinksTab();
    } catch (error) {
        body.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><strong>Failed to load Social Links</strong></div>`;
    }
}

function renderSocialLinksTab() {
    const body = document.getElementById('footerMgmtBody');
    const links = window._socialLinks || [];

    body.innerHTML = `
        <div class="toolbar" style="margin-top:0;">
            <h3 style="margin:0;font-size:15px;">Social Links</h3>
            ${hasPermission('footer:create') ? `<button class="btn btn-gold btn-sm" onclick="showAddSocialLinkModal()"><i class="fas fa-plus"></i> Add Social Link</button>` : ''}
        </div>
        <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">
            Only <strong>enabled</strong> links show as icons in the public footer. Drag rows (or use the arrows) to change the order the icons appear in.
        </p>
        ${links.length === 0 ? `
            <div class="empty-state"><span class="icon">🔗</span><strong>No Social Links Yet</strong><p>Add Facebook, Instagram, WhatsApp, or any other platform to show icons in the footer.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th></th><th>Platform</th><th>Icon</th><th>URL</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="socialLinksTbody">
                        ${links.map((l, idx) => `
                            <tr class="drag-row" draggable="true" data-drag-id="${l._id}">
                                <td style="white-space:nowrap;">
                                    <span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                                    ${hasPermission('footer:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="moveSocialLink('${l._id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="moveSocialLink('${l._id}', 1)" ${idx === links.length - 1 ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                                    ` : ''}
                                </td>
                                <td><strong>${escapeHtml(l.platform)}</strong></td>
                                <td><i class="${escapeHtml(l.icon || '')}" style="color:var(--gold);width:16px;text-align:center;"></i> <code style="font-size:11px;color:var(--muted);">${escapeHtml(l.icon || '')}</code></td>
                                <td style="font-size:12px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:inherit;">${escapeHtml(l.url)}</a></td>
                                <td>
                                    <label class="toggle-switch" title="${l.isActive ? 'Enabled' : 'Disabled'}">
                                        <input type="checkbox" ${l.isActive ? 'checked' : ''} ${hasPermission('footer:edit') ? '' : 'disabled'} onchange="toggleSocialLinkActive('${l._id}', this.checked)">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </td>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('footer:edit') ? `<button class="btn btn-secondary btn-sm" onclick="showEditSocialLinkModal('${l._id}')" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                                    ${hasPermission('footer:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteSocialLink('${l._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;

    if (hasPermission('footer:edit')) {
        enableDragReorder('socialLinksTbody', (orderedIds) => reorderSocialLinks(orderedIds));
    }
}

async function reorderSocialLinks(orderedIds) {
    const result = await apiCall('/social-links/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reorder', 'error'); return; }
    const byId = Object.fromEntries((window._socialLinks || []).map(l => [l._id, l]));
    window._socialLinks = orderedIds.map((id, i) => ({ ...byId[id], order: i }));
    renderSocialLinksTab();
}

async function moveSocialLink(id, direction) {
    const links = (window._socialLinks || []).slice();
    const idx = links.findIndex(x => x._id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= links.length) return;
    [links[idx], links[newIdx]] = [links[newIdx], links[idx]];
    await reorderSocialLinks(links.map(l => l._id));
}

function socialLinkFormFields(l = {}) {
    return `
        <div class="form-group">
            <label>Platform</label>
            <select id="sockPlatform" onchange="autoFillSocialIcon()">
                ${SOCIAL_PLATFORMS.map(p => `<option value="${p}" ${l.platform === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label>URL</label>
            <input type="text" id="sockUrl" value="${escapeHtml(l.url || '')}" placeholder="https://instagram.com/yourpage">
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Icon (Font Awesome class)</label>
                <input type="text" id="sockIcon" value="${escapeHtml(l.icon || SOCIAL_PLATFORM_ICONS[l.platform || 'Facebook'])}" placeholder="e.g. fab fa-instagram">
                <p style="font-size:11px;color:var(--muted);margin-top:4px;">Auto-fills from the platform — only change this if you want a different icon.</p>
            </div>
            <div class="form-group"><label>Display Order</label><input type="number" id="sockOrder" value="${l.order !== undefined ? l.order : ''}" placeholder="Leave blank to add at the end"></div>
        </div>
        ${l._id ? `
        <div class="form-group">
            <label>Status</label>
            <select id="sockIsActive">
                <option value="true" ${l.isActive !== false ? 'selected' : ''}>Enabled</option>
                <option value="false" ${l.isActive === false ? 'selected' : ''}>Disabled</option>
            </select>
        </div>` : ''}
    `;
}

function autoFillSocialIcon() {
    const platformEl = document.getElementById('sockPlatform');
    const iconEl = document.getElementById('sockIcon');
    if (!platformEl || !iconEl) return;
    iconEl.value = SOCIAL_PLATFORM_ICONS[platformEl.value] || '';
}

function readSocialLinkForm() {
    const body = {
        platform: document.getElementById('sockPlatform').value,
        url: document.getElementById('sockUrl').value.trim(),
        icon: document.getElementById('sockIcon').value.trim(),
    };
    const orderVal = document.getElementById('sockOrder').value;
    if (orderVal !== '') body.order = parseInt(orderVal, 10);
    const activeEl = document.getElementById('sockIsActive');
    if (activeEl) body.isActive = activeEl.value === 'true';
    return body;
}

function isLikelyValidUrl(url) {
    if (!url) return false;
    if (url.startsWith('/') || url.startsWith('#')) return true;
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function showAddSocialLinkModal() {
    showModal('Add Social Link', 'Shows as an icon in the public footer', socialLinkFormFields(), async () => {
        const body = readSocialLinkForm();
        if (!body.url || !isLikelyValidUrl(body.url)) { showToast('Error', 'Enter a valid http(s) URL', 'error'); return; }
        const result = await apiCall('/social-links', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add social link', 'error'); return; }
        showToast('Success', 'Social link added', 'success');
        closeModal();
        await loadSocialLinksTab();
    });
}

function showEditSocialLinkModal(id) {
    const l = (window._socialLinks || []).find(x => x._id === id);
    if (!l) return;
    showModal('Edit Social Link', `Update ${l.platform}`, socialLinkFormFields(l), async () => {
        const body = readSocialLinkForm();
        if (!body.url || !isLikelyValidUrl(body.url)) { showToast('Error', 'Enter a valid http(s) URL', 'error'); return; }
        const result = await apiCall(`/social-links/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update social link', 'error'); return; }
        showToast('Success', 'Social link updated', 'success');
        closeModal();
        await loadSocialLinksTab();
    });
}

async function toggleSocialLinkActive(id, isActive) {
    const result = await apiCall(`/social-links/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update status', 'error'); await loadSocialLinksTab(); return; }
    showToast('Success', isActive ? 'Link enabled' : 'Link disabled', 'success');
    await loadSocialLinksTab();
}

async function deleteSocialLink(id) {
    const l = (window._socialLinks || []).find(x => x._id === id);
    if (!confirm(`Delete the ${l?.platform || ''} link? This can't be undone.`)) return;
    const result = await apiCall(`/social-links/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete', 'error'); return; }
    showToast('Success', 'Social link deleted', 'success');
    await loadSocialLinksTab();
}

// ============================================================
// 2 & 3. FOOTER NAV LINKS (Quick Links / Student Resources)
// ============================================================
// Both columns share this exact same UI — only the `column` value and
// display label differ — so one set of functions handles both, keyed off
// window._footerLinksColumn (set each time a tab loads).
async function loadFooterLinksTab(column, label) {
    window._footerLinksColumn = column;
    window._footerLinksLabel = label;
    const body = document.getElementById('footerMgmtBody');
    body.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const res = await apiCall(`/footer-links?column=${encodeURIComponent(column)}`);
        window._footerLinks = res?.data || [];
        renderFooterLinksTab();
    } catch (error) {
        body.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><strong>Failed to load ${escapeHtml(label)}</strong></div>`;
    }
}

function renderFooterLinksTab() {
    const body = document.getElementById('footerMgmtBody');
    const links = window._footerLinks || [];
    const label = window._footerLinksLabel;

    body.innerHTML = `
        <div class="toolbar" style="margin-top:0;">
            <h3 style="margin:0;font-size:15px;">${escapeHtml(label)}</h3>
            ${hasPermission('footer:create') ? `<button class="btn btn-gold btn-sm" onclick="showAddFooterLinkModal()"><i class="fas fa-plus"></i> Add Link</button>` : ''}
        </div>
        <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">
            This is the "${escapeHtml(label)}" column of the public footer. Only enabled links are shown to visitors.
        </p>
        ${links.length === 0 ? `
            <div class="empty-state"><span class="icon">🔗</span><strong>No Links Yet</strong><p>Add a link to populate this footer column.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th></th><th>Label</th><th>URL</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="footerLinksTbody">
                        ${links.map((l, idx) => `
                            <tr class="drag-row" draggable="true" data-drag-id="${l._id}">
                                <td style="white-space:nowrap;">
                                    <span class="drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
                                    ${hasPermission('footer:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="moveFooterLink('${l._id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="moveFooterLink('${l._id}', 1)" ${idx === links.length - 1 ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                                    ` : ''}
                                </td>
                                <td><strong>${escapeHtml(l.label)}</strong></td>
                                <td style="font-size:12px;color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(l.url)}</td>
                                <td>
                                    <label class="toggle-switch" title="${l.isActive ? 'Enabled' : 'Disabled'}">
                                        <input type="checkbox" ${l.isActive ? 'checked' : ''} ${hasPermission('footer:edit') ? '' : 'disabled'} onchange="toggleFooterLinkActive('${l._id}', this.checked)">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </td>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('footer:edit') ? `<button class="btn btn-secondary btn-sm" onclick="showEditFooterLinkModal('${l._id}')" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                                    ${hasPermission('footer:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteFooterLink('${l._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;

    if (hasPermission('footer:edit')) {
        enableDragReorder('footerLinksTbody', (orderedIds) => reorderFooterLinks(orderedIds));
    }
}

async function reorderFooterLinks(orderedIds) {
    const result = await apiCall('/footer-links/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reorder', 'error'); return; }
    const byId = Object.fromEntries((window._footerLinks || []).map(l => [l._id, l]));
    window._footerLinks = orderedIds.map((id, i) => ({ ...byId[id], order: i }));
    renderFooterLinksTab();
}

async function moveFooterLink(id, direction) {
    const links = (window._footerLinks || []).slice();
    const idx = links.findIndex(x => x._id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= links.length) return;
    [links[idx], links[newIdx]] = [links[newIdx], links[idx]];
    await reorderFooterLinks(links.map(l => l._id));
}

function footerLinkFormFields(l = {}) {
    return `
        <div class="form-group"><label>Label</label><input type="text" id="flLabel" value="${escapeHtml(l.label || '')}" placeholder="e.g. Privacy Policy"></div>
        <div class="form-group">
            <label>URL</label>
            <input type="text" id="flUrl" value="${escapeHtml(l.url || '')}" placeholder="e.g. /privacy-policy.html, #section, or https://...">
        </div>
        <div class="form-group"><label>Display Order</label><input type="number" id="flOrder" value="${l.order !== undefined ? l.order : ''}" placeholder="Leave blank to add at the end"></div>
        ${l._id ? `
        <div class="form-group">
            <label>Status</label>
            <select id="flIsActive">
                <option value="true" ${l.isActive !== false ? 'selected' : ''}>Enabled</option>
                <option value="false" ${l.isActive === false ? 'selected' : ''}>Disabled</option>
            </select>
        </div>` : ''}
    `;
}

function readFooterLinkForm() {
    const body = {
        column: window._footerLinksColumn,
        label: document.getElementById('flLabel').value.trim(),
        url: document.getElementById('flUrl').value.trim(),
    };
    const orderVal = document.getElementById('flOrder').value;
    if (orderVal !== '') body.order = parseInt(orderVal, 10);
    const activeEl = document.getElementById('flIsActive');
    if (activeEl) body.isActive = activeEl.value === 'true';
    return body;
}

function showAddFooterLinkModal() {
    showModal(`Add Link`, `Adds a new item to the "${window._footerLinksLabel}" footer column`, footerLinkFormFields(), async () => {
        const body = readFooterLinkForm();
        if (!body.label || !body.url) { showToast('Error', 'Label and URL are required', 'error'); return; }
        if (!isLikelyValidUrl(body.url)) { showToast('Error', 'Enter a valid URL or a relative path starting with / or #', 'error'); return; }
        const result = await apiCall('/footer-links', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add link', 'error'); return; }
        showToast('Success', 'Link added', 'success');
        closeModal();
        await loadFooterLinksTab(window._footerLinksColumn, window._footerLinksLabel);
    });
}

function showEditFooterLinkModal(id) {
    const l = (window._footerLinks || []).find(x => x._id === id);
    if (!l) return;
    showModal('Edit Link', `Update "${l.label}"`, footerLinkFormFields(l), async () => {
        const body = readFooterLinkForm();
        if (!body.label || !body.url) { showToast('Error', 'Label and URL are required', 'error'); return; }
        if (!isLikelyValidUrl(body.url)) { showToast('Error', 'Enter a valid URL or a relative path starting with / or #', 'error'); return; }
        const result = await apiCall(`/footer-links/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update link', 'error'); return; }
        showToast('Success', 'Link updated', 'success');
        closeModal();
        await loadFooterLinksTab(window._footerLinksColumn, window._footerLinksLabel);
    });
}

async function toggleFooterLinkActive(id, isActive) {
    const result = await apiCall(`/footer-links/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update status', 'error'); await loadFooterLinksTab(window._footerLinksColumn, window._footerLinksLabel); return; }
    showToast('Success', isActive ? 'Link enabled' : 'Link disabled', 'success');
    await loadFooterLinksTab(window._footerLinksColumn, window._footerLinksLabel);
}

async function deleteFooterLink(id) {
    const l = (window._footerLinks || []).find(x => x._id === id);
    if (!confirm(`Delete "${l?.label || 'this link'}"? This can't be undone.`)) return;
    const result = await apiCall(`/footer-links/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete', 'error'); return; }
    showToast('Success', 'Link deleted', 'success');
    await loadFooterLinksTab(window._footerLinksColumn, window._footerLinksLabel);
}

// ============================================================
// 4. SETTINGS (About / Contact Info / Bottom Bar)
// ============================================================
async function loadFooterSettingsTab() {
    const body = document.getElementById('footerMgmtBody');
    body.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const res = await apiCall('/footer-settings');
        window._footerSettings = res?.data || {};
        renderFooterSettingsTab();
    } catch (error) {
        body.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><strong>Failed to load Footer Settings</strong></div>`;
    }
}

function renderFooterSettingsTab() {
    const body = document.getElementById('footerMgmtBody');
    const s = window._footerSettings || {};
    const about = s.about || {};
    const contact = s.contact || {};
    const bottomBar = s.bottomBar || {};
    const canEdit = hasPermission('footer:edit');

    body.innerHTML = `
        <div class="dashboard-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">

            <div class="card" style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius);padding:18px;">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-info-circle" style="color:var(--gold);"></i> Column 1 — About Chawla Classes</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">Title and short description shown in the footer's first column.</p>
                <div class="form-group"><label>Title</label><input type="text" id="fsAboutTitle" value="${escapeHtml(about.title || '')}" maxlength="100" placeholder="Chawla Classes"></div>
                <div class="form-group"><label>Content</label><textarea id="fsAboutContent" rows="4" maxlength="1000" placeholder="Providing quality education and academic guidance since 2002.">${escapeHtml(about.content || '')}</textarea></div>
                ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="saveFooterSettingsSection('about')"><i class="fas fa-save"></i> Save About</button>` : ''}
            </div>

            <div class="card" style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius);padding:18px;">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-address-book" style="color:var(--gold);"></i> Column 4 — Contact Information</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">Shown in the footer's Contact Info column.</p>
                <div class="form-row">
                    <div class="form-group"><label>Phone Number</label><input type="text" id="fsPhone" value="${escapeHtml(contact.phone || '')}" maxlength="20" placeholder="9210660809"></div>
                    <div class="form-group"><label>WhatsApp Number</label><input type="text" id="fsWhatsapp" value="${escapeHtml(contact.whatsapp || '')}" maxlength="20" placeholder="9717914003"></div>
                </div>
                <div class="form-group"><label>Email Address</label><input type="email" id="fsEmail" value="${escapeHtml(contact.email || '')}" maxlength="100" placeholder="info@chawlaclasses.com"></div>
                <div class="form-group"><label>Full Address</label><textarea id="fsAddress" rows="2" maxlength="500" placeholder="Shop 72, Hastsal Road...">${escapeHtml(contact.address || '')}</textarea></div>
                <div class="form-group"><label>Working Hours</label><input type="text" id="fsWorkingHours" value="${escapeHtml(contact.workingHours || '')}" maxlength="200" placeholder="Mon–Sat, 9:00 AM – 7:00 PM"></div>
                ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="saveFooterSettingsSection('contact')"><i class="fas fa-save"></i> Save Contact Info</button>` : ''}
            </div>

            <div class="card" style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius);padding:18px;">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-copyright" style="color:var(--gold);"></i> Footer Bottom Bar</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">The thin strip at the very bottom of every page.</p>
                <div class="form-group"><label>Copyright Text</label><input type="text" id="fsCopyright" value="${escapeHtml(bottomBar.copyrightText || '')}" maxlength="200" placeholder="© 2026 Chawla Classes. All Rights Reserved."></div>
                <div class="form-group"><label>Developed By Text (optional)</label><input type="text" id="fsDevBy" value="${escapeHtml(bottomBar.developedByText || '')}" maxlength="200" placeholder="Developed by..."></div>
                <div class="form-group"><label>Footer Note (optional)</label><input type="text" id="fsFooterNote" value="${escapeHtml(bottomBar.footerNote || '')}" maxlength="300" placeholder="Any extra line, e.g. a CIN/GST number"></div>
                ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="saveFooterSettingsSection('bottomBar')"><i class="fas fa-save"></i> Save Bottom Bar</button>` : ''}
            </div>

        </div>
    `;
}

async function saveFooterSettingsSection(section) {
    let patch = {};
    if (section === 'about') {
        patch = { about: {
            title: document.getElementById('fsAboutTitle').value.trim(),
            content: document.getElementById('fsAboutContent').value.trim(),
        } };
    } else if (section === 'contact') {
        const email = document.getElementById('fsEmail').value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Error', 'Enter a valid email address', 'error');
            return;
        }
        patch = { contact: {
            phone: document.getElementById('fsPhone').value.trim(),
            whatsapp: document.getElementById('fsWhatsapp').value.trim(),
            email,
            address: document.getElementById('fsAddress').value.trim(),
            workingHours: document.getElementById('fsWorkingHours').value.trim(),
        } };
    } else if (section === 'bottomBar') {
        patch = { bottomBar: {
            copyrightText: document.getElementById('fsCopyright').value.trim(),
            developedByText: document.getElementById('fsDevBy').value.trim(),
            footerNote: document.getElementById('fsFooterNote').value.trim(),
        } };
    }

    const result = await apiCall('/footer-settings', { method: 'PUT', body: JSON.stringify(patch) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    window._footerSettings = result.data;
    showToast('Success', 'Saved', 'success');
    renderFooterSettingsTab();
}
