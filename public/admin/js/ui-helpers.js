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
// Every Add/Edit/View dialog in the admin panel goes through ONE shared
// shell (#modalOverlay > .modal) via showModal(), so the dismissal rules in
// AdminModal below (click on the dark overlay, Esc key) automatically apply
// to all of them - no per-dialog wiring needed.
//
// Dismissal goes through the same closeModal() the Cancel button uses, so the
// outcome is identical to pressing Cancel: edits are discarded. If you would
// rather be asked first, set   window.ADMIN_MODAL_CONFIRM_ON_DIRTY = true
// (anywhere, e.g. in config.js) - overlay-click/Esc then confirm() when a
// field was edited. The Cancel button itself is never intercepted.
var AdminModal = (function () {
    'use strict';

    var dirty = false;               // a form field inside the dialog was edited
    var pressedOnOverlay = false;    // pointer went DOWN on the dark backdrop
    var releasedOnOverlay = false;   // pointer came UP on the dark backdrop

    function overlayEl() { return document.getElementById('modalOverlay'); }
    function isOpen() { var o = overlayEl(); return !!(o && o.classList.contains('active')); }

    // Callers disable Save while a request is in flight (and re-enable it in
    // a finally block), so a disabled Save means "don't dismiss right now".
    function isSaving() {
        var btn = document.getElementById('modalSaveBtn');
        return !!(btn && btn.disabled);
    }

    function requestClose() {
        if (!isOpen() || isSaving()) return false;
        if (window.ADMIN_MODAL_CONFIRM_ON_DIRTY === true && dirty &&
            !window.confirm('You have unsaved changes. Close without saving?')) return false;
        closeModal();
        return true;
    }

    // A click only dismisses when the press AND the release both happened on
    // the backdrop itself. Without this, selecting text inside an input and
    // letting go of the mouse over the backdrop (the browser then reports the
    // click on the common ancestor = the overlay) would close the dialog and
    // lose the admin's work.
    function onPointerDown(e) { pressedOnOverlay = (e.target === overlayEl()); releasedOnOverlay = false; }
    function onPointerUp(e) { releasedOnOverlay = (e.target === overlayEl()); }
    function onOverlayClick(e) {
        var fromBackdrop = pressedOnOverlay && releasedOnOverlay;
        pressedOnOverlay = releasedOnOverlay = false;
        if (e.target === overlayEl() && fromBackdrop) requestClose();
    }

    function onKeydown(e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        if (e.defaultPrevented || e.isComposing) return;     // something else already handled it (IME, a widget)
        if (document.querySelector('.rc-modal-bg')) return;  // the self-managed confirm dialog is on top and closes itself
        if (!isOpen()) return;
        e.preventDefault();
        requestClose();
    }

    function markDirty() { dirty = true; }

    // The footer buttons are shared by every dialog and a few callers
    // re-label them - e.g. AI Studio's "Resume previous session?" prompt turns
    // Cancel into "Start New" plus a one-time click listener that clears the
    // saved AI session. If such a dialog is dismissed any other way (overlay,
    // Esc, plain closeModal), that customisation would leak into the NEXT
    // dialog: wrong label, and a stale listener that wipes the saved session.
    // Rebuilding Cancel at the start of every dialog prevents that.
    function resetFooter() {
        var cancel = document.querySelector('#modalOverlay .modal-footer .btn-secondary');
        if (!cancel || !cancel.parentNode) return;
        var fresh = cancel.cloneNode(false);   // keeps class + inline onclick="closeModal()", drops added listeners
        fresh.textContent = 'Cancel';
        cancel.parentNode.replaceChild(fresh, cancel);
    }

    function reset() { dirty = false; pressedOnOverlay = releasedOnOverlay = false; }

    function init() {
        var overlay = overlayEl();
        if (!overlay) { document.addEventListener('DOMContentLoaded', init, { once: true }); return; }
        if (overlay.getAttribute('data-dismiss-bound') === '1') return;
        overlay.setAttribute('data-dismiss-bound', '1');
        overlay.addEventListener('pointerdown', onPointerDown);
        overlay.addEventListener('pointerup', onPointerUp);
        overlay.addEventListener('click', onOverlayClick);
        var body = document.getElementById('modalBody');   // persistent node: its innerHTML is swapped, the node isn't
        if (body) { body.addEventListener('input', markDirty); body.addEventListener('change', markDirty); }
        document.addEventListener('keydown', onKeydown);
    }

    init();
    return { requestClose: requestClose, isOpen: isOpen, reset: reset, resetFooter: resetFooter };
})();

function showModal(title, subtitle, bodyHtml, callback) {
    AdminModal.resetFooter();
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalSubtitle').textContent = subtitle || 'Fill in the details';
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalOverlay').classList.add('active');
    document.getElementById('modalBody').scrollTop = 0;   // body is the scroller now: always open at the top
    AdminModal.reset();
    modalCallback = callback;
    // Reset in case a previous view-only modal (e.g. Question History) hid this.
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    modalCallback = null;
    AdminModal.reset();
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

