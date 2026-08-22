// public/admin/js/ui-helpers.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ESCAPE HTML (Prevent XSS)
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// ANTI-SPAM FLAG BADGES (Admission Form + Career Form review)
// ============================================================
// Shared by public/admin/js/admissions.js and public/admin/js/recruitment.js
// — both list `flags` (isSuspicious/duplicateEmail/duplicateMobile/
// blockedDomain, set by routes/publicEnquiry.js and routes/recruitment.js)
// and `emailVerified` on every website submission. Admin-logged/legacy
// records without these fields simply render nothing extra, so this is
// safe to call on any record from either module.
function renderFlagBadges(record) {
    const flags = record.flags || {};
    const badges = [];
    if (flags.duplicateEmail) badges.push({ label: 'Dup. Email', title: 'Another record already exists with this email address' });
    if (flags.duplicateMobile) badges.push({ label: 'Dup. Mobile', title: 'Another record already exists with this mobile number' });
    if (flags.blockedDomain) badges.push({ label: 'Disposable Email', title: 'Email domain is a known temporary/disposable provider' });
    if (!badges.length) return '';
    const badgeHtml = badges.map(b => `<span title="${escapeHtml(b.title)}" style="display:inline-block;background:rgba(239,68,68,0.12);color:#dc2626;border-radius:5px;padding:1px 6px;font-size:10.5px;font-weight:600;margin:1px 3px 0 0;white-space:nowrap;">⚠ ${b.label}</span>`).join('');
    return `<div style="margin-top:4px;">${badgeHtml}</div>`;
}

// ============================================================
// MODAL FUNCTIONS
// ============================================================
function showModal(title, subtitle, bodyHtml, callback) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalSubtitle').textContent = subtitle || 'Fill in the details';
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalOverlay').classList.add('active');
    modalCallback = callback;
    // Reset in case a previous view-only modal (e.g. Question History) hid this.
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    modalCallback = null;
}

async function saveModal() {
    if (modalCallback) await modalCallback();
}

// ============================================================
// UI HELPERS
// ============================================================
function showLoading() {
    contentArea.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
}

function showError(title, message) {
    contentArea.innerHTML = `
        <div class="empty-state">
            <span class="icon">⚠️</span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(message || '')}</p>
            <button class="btn btn-gold" onclick="switchSection('${currentSection}')" style="margin-top:12px;">Retry</button>
        </div>
    `;
}

