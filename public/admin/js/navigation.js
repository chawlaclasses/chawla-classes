// public/admin/js/navigation.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// DEPENDENCIES
// ============================================================
// apiCall is defined in api.js and should be loaded before navigation.js
// This guard ensures we don't break if the load order changes
if (typeof apiCall === 'undefined') {
    console.warn('[navigation.js] apiCall not defined - ensure api.js loads first');
}

// ============================================================
// GLOBAL STATE (safe declaration - prevents duplicate declaration)
// ============================================================
window.currentSection = window.currentSection || null;

// ============================================================
// DOM CACHE (single object to avoid global pollution)
// ============================================================
var dom = {
    sidebarItems: null,
    bottomNavItems: null,
    enquiryBadge: null,
    enquiryBadgeMobile: null,
    notifEnquiryCount: null,
    notifDoubtsCount: null,
    bellDot: null,
    notifEmpty: null,
    sidebar: null,
    sidebarOverlay: null,
    isCached: false
};

function cacheDomElements() {
    if (dom.isCached) return;
    
    dom.sidebarItems = document.querySelectorAll('.sidebar-item');
    dom.bottomNavItems = document.querySelectorAll('.bottom-nav-item[data-section]');
    dom.enquiryBadge = document.getElementById('enquiryBadge');
    dom.enquiryBadgeMobile = document.getElementById('enquiryBadgeMobile');
    dom.notifEnquiryCount = document.getElementById('notifEnquiryCount');
    dom.notifDoubtsCount = document.getElementById('notifDoubtsCount');
    dom.bellDot = document.getElementById('bellDot');
    dom.notifEmpty = document.getElementById('notifEmpty');
    dom.sidebar = document.getElementById('sidebar');
    dom.sidebarOverlay = document.getElementById('sidebarOverlay');
    dom.isCached = true;
}

// Helper functions to get cached or fresh elements (future-safe)
function getSidebarItems() {
    return dom.sidebarItems || document.querySelectorAll('.sidebar-item');
}

function getBottomNavItems() {
    return dom.bottomNavItems || document.querySelectorAll('.bottom-nav-item[data-section]');
}

function getElement(id) {
    // Check if already cached
    var cached = dom[id];
    if (cached) return cached;
    // If not, get fresh and cache it
    var el = document.getElementById(id);
    if (el) {
        dom[id] = el;
    }
    return el;
}

// Cache on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cacheDomElements);
} else {
    cacheDomElements();
}

// ============================================================
// BELL NOTIFICATION SYNC
// ============================================================
function syncBellDot() {
    var enqEl = getElement('notifEnquiryCount');
    var doubtEl = getElement('notifDoubtsCount');
    var dotEl = getElement('bellDot');
    var emptyEl = getElement('notifEmpty');
    
    var enq = parseInt((enqEl || document.getElementById('notifEnquiryCount'))?.textContent || '0');
    var doubt = parseInt((doubtEl || document.getElementById('notifDoubtsCount'))?.textContent || '0');
    var dot = dotEl || document.getElementById('bellDot');
    var empty = emptyEl || document.getElementById('notifEmpty');
    
    if (dot) dot.style.display = (enq + doubt) > 0 ? 'block' : 'none';
    if (empty) empty.style.display = (enq + doubt) > 0 ? 'none' : 'block';
}

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
// RESPONSIVE: opens/closes the off-canvas sidebar drawer used on tablet
// and mobile widths (<992px), toggled by the header hamburger button and
// the "Menu" item in the bottom nav. No-op visually on desktop since the
// sidebar is statically positioned there regardless of the .open class.
function toggleSidebar() {
    var sidebarEl = getElement('sidebar');
    var overlayEl = getElement('sidebarOverlay');
    if (sidebarEl) sidebarEl.classList.toggle('open');
    if (overlayEl) overlayEl.classList.toggle('active');
}

function closeSidebar() {
    var sidebarEl = getElement('sidebar');
    var overlayEl = getElement('sidebarOverlay');
    if (sidebarEl) sidebarEl.classList.remove('open');
    if (overlayEl) overlayEl.classList.remove('active');
}

// ============================================================
// SECTION LOADER MAP (lazy-loaded, future-safe)
// ============================================================
// Using window object to avoid ReferenceError if functions aren't defined yet
var sectionLoaders = {
    'dashboard': function() { return window.loadDashboard && window.loadDashboard(); },
    'analytics': function() { return window.loadAnalytics && window.loadAnalytics(); },
    'classes': function() { return window.loadClasses && window.loadClasses(); },
    'subjects': function() { return window.loadSubjects && window.loadSubjects(); },
    'series': function() { return window.loadSeries && window.loadSeries(); },
    'tests': function() { return window.loadTests && window.loadTests(); },
    'questions': function() { return window.loadQuestions && window.loadQuestions(); },
    'ai-review-queue': function() { return window.loadAIReviewQueue && window.loadAIReviewQueue(); },
    'ai-question-studio': function() { return window.loadAIQuestionStudio && window.loadAIQuestionStudio(); },
    'homework': function() { return window.loadHomework && window.loadHomework(); },
    'doubts': function() { return window.loadDoubts && window.loadDoubts(); },
    'communication': function() { return window.loadCommunication && window.loadCommunication(); },
    'ai-tools': function() { return window.loadAITools && window.loadAITools(); },
    'enquiries': function() { return window.loadEnquiries && window.loadEnquiries(); },
    'fees': function() { return window.loadFees && window.loadFees(); },
    'attendance': function() { return window.loadAttendance && window.loadAttendance(); },
    'reports': function() { return window.loadReports && window.loadReports(); },
    'staff': function() { return window.loadStaff && window.loadStaff(); },
    'admissions': function() { return window.loadAdmissions && window.loadAdmissions(); },
    'recruitment': function() { return window.loadRecruitment && window.loadRecruitment(); },
    'marketing': function() { return window.loadMarketing && window.loadMarketing(); },
    'reviews': function() { return window.loadReviews && window.loadReviews(); },
    'categories': function() { return window.loadCategories && window.loadCategories(); },
    'website-builder': function() { return window.loadWebsiteBuilder && window.loadWebsiteBuilder(); },
    'students': function() { return window.loadStudents && window.loadStudents(); },
    'active-sessions': function() { return window.loadActiveSessions && window.loadActiveSessions(); },
    'login-history': function() { return window.loadLoginHistory && window.loadLoginHistory(); },
    'audit-logs': function() { return window.loadAuditLogs && window.loadAuditLogs(); },
    'settings': function() { return window.loadSettings && window.loadSettings(); }
};

function switchSection(section) {
    window.currentSection = section;
    
    // Update sidebar items using cached DOM elements with fallback
    var items = getSidebarItems();
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.dataset.section === section) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    }
    
    // Keep the mobile bottom-nav tab highlighted in sync, whether nav came
    // from the bottom bar itself or from a sidebar item inside the drawer.
    var navItems = getBottomNavItems();
    for (var j = 0; j < navItems.length; j++) {
        var navEl = navItems[j];
        if (navEl.dataset.section === section) {
            navEl.classList.add('active');
        } else {
            navEl.classList.remove('active');
        }
    }
    
    // Navigating should always close the drawer on tablet/mobile so the
    // person actually sees the section they just picked.
    closeSidebar();

    // Use loader map with lazy-loaded functions
    var loaderFn = sectionLoaders[section];
    if (typeof loaderFn === 'function') {
        try {
            var result = loaderFn();
            // If the loader returns a function (for async), call it
            if (typeof result === 'function') {
                result();
            }
        } catch (err) {
            console.error('[navigation.js] Error loading section:', section, err);
            if (typeof showToast === 'function') {
                showToast('error', 'Navigation Error', 'Failed to load ' + section + '. Please try again.');
            }
        }
    } else {
        console.warn('[navigation.js] Unknown section:', section);
        // Fallback to dashboard
        if (typeof window.loadDashboard === 'function') {
            window.loadDashboard();
        }
    }
}

// ============================================================
// ENQUIRY BADGE
// ============================================================
// Keep the sidebar's "new enquiries" badge live without needing to be on
// the dashboard page — refreshed on load and after any dashboard visit.
async function refreshEnquiryBadge() {
    try {
        if (typeof apiCall !== 'function') {
            console.warn('[navigation.js] apiCall not available, skipping badge refresh');
            return;
        }
        
        var res = await apiCall('/enquiries?status=new');
        var count = res?.data?.length || 0;
        
        // Sidebar badge
        var badge = getElement('enquiryBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        
        // Mobile bottom nav badge
        var mobileBadge = getElement('enquiryBadgeMobile');
        if (mobileBadge) {
            mobileBadge.textContent = count;
            mobileBadge.style.display = count > 0 ? 'inline-block' : 'none';
        }
        
        // Notification bell - enquiry count
        var notifEnq = getElement('notifEnquiryCount');
        if (notifEnq) notifEnq.textContent = count;
        
        // Sync bell dot
        syncBellDot();
    } catch (e) {
        // Non-critical - silent fail
        console.debug('[navigation.js] Failed to refresh enquiry badge:', e);
    }
}

// ============================================================
// LOGOUT
// ============================================================
async function logout(reason) {
    // Hide idle warning if it exists
    if (typeof hideIdleWarning === 'function') {
        hideIdleWarning();
    }
    
    // Clear idle check interval if it exists
    if (typeof idleCheckInterval !== 'undefined' && idleCheckInterval) {
        clearInterval(idleCheckInterval);
    }

    var controller = null;
    var timeoutId = null;

    // Best-effort — end the session server-side too, so it stops showing as
    // "active" in Session Management immediately rather than only after the
    // JWT's own 24h expiry. Must never block the actual logout if this fails.
    // Use AbortController for proper request cancellation
    if (typeof token !== 'undefined' && token) {
        try {
            controller = new AbortController();
            timeoutId = setTimeout(function() {
                if (controller) controller.abort();
            }, 5000);
            
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                signal: controller.signal
            });
        } catch (err) {
            // Silent fail - still log out locally
            // Check if it's an abort error (expected timeout)
            if (err.name !== 'AbortError') {
                console.debug('[navigation.js] Logout API call failed:', err.message);
            }
        } finally {
            // Always clear timeout to prevent memory leak
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    } else {
        console.debug('[navigation.js] No token found, skipping server logout');
    }

    // Clear local storage
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminName');
    
    // Stash the reason so login.html can show it after the redirect —
    // by the time the user lands there, this page (and any toast on it)
    // is already gone.
    if (reason) {
        sessionStorage.setItem('cc_logoutReason', reason);
    }
    
    // Redirect to login page
    window.location.href = '/admin/login.html';
}