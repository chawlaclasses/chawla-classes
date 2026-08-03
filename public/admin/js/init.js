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

applySavedTheme();
loadDashboard();
refreshEnquiryBadge();
refreshDoubtsBadge();
if (typeof refreshAiQueueBadge === 'function') refreshAiQueueBadge();
