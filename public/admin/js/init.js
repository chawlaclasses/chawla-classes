// public/admin/js/init.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// INIT
// ============================================================
async function applySavedTheme() {
    try {
        const res = await apiCall('/settings');
        if (res?.success && res.data?.themeColor) {
            document.documentElement.style.setProperty('--gold', res.data.themeColor);
        }
    } catch (e) { /* non-critical */ }
}

// ── Which page opens first? ─────────────────────────────────────────────
// Normal refresh (F5)        -> stay on the section the admin was on.
// Hard refresh (Ctrl+F5 etc) -> Dashboard, and forget the saved section.
// Fresh visit / login        -> Dashboard.
//
// JS cannot tell F5 from Ctrl+F5 on its own (both report navigation type
// "reload"). The server can: a hard reload sends "Cache-Control: no-cache",
// and app.js turns that into a short-lived "cc_hard_reload" cookie for this page.
function consumeHardReloadFlag() {
    if (!/(?:^|;\s*)cc_hard_reload=1(?:;|$)/.test(document.cookie)) return false;
    document.cookie = 'cc_hard_reload=; Max-Age=0; Path=/admin; SameSite=Lax'; // one-shot
    return true;
}

function getNavigationType() {
    try {
        var entry = performance.getEntriesByType('navigation')[0];
        if (entry && entry.type) return entry.type; // 'navigate' | 'reload' | 'back_forward' | 'prerender'
    } catch (e) { /* unsupported */ }
    return null;
}

function loadInitialSection() {
    if (consumeHardReloadFlag()) { clearSavedSection(); loadDashboard(); return; }

    var navType = getNavigationType();
    // A brand-new visit ('navigate': typed URL, link, post-login redirect) opens the Dashboard.
    // Unknown type (very old browser) leans towards remembering.
    var mayRestore = navType === null || navType === 'reload' || navType === 'back_forward';
    var section = mayRestore ? getRestorableSection() : null;

    if (section) {
        switchSection(section); // highlights sidebar + bottom-nav and runs the section loader
    } else {
        if (navType === 'navigate') clearSavedSection();
        loadDashboard();
    }
}

applySavedTheme();
loadInitialSection();
refreshEnquiryBadge();
refreshDoubtsBadge();
if (typeof refreshAiQueueBadge === 'function') refreshAiQueueBadge();
if (typeof refreshReviewsBadge === 'function') refreshReviewsBadge();
