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

