// public/admin/js/api.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// API CALL
// ============================================================
async function apiCall(endpoint, options = {}) {
    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...defaultOptions,
            ...options
        });

        if (response.status === 401) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin/login.html';
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showToast('Error', 'Server error. Please try again.', 'error');
        return null;
    }
}

// ============================================================
// AUTO-LOGOUT (inactivity timeout)
// Admin sessions can see/edit everything — fees, student personal data,
// staff accounts — so an unattended, still-logged-in browser tab is a
// real risk. After IDLE_TIMEOUT_MS with no clicks/keys/scroll/mouse
// movement, the admin is logged out automatically; a warning appears
// WARNING_BEFORE_MS beforehand so ongoing work isn't lost without notice.
// ============================================================
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_WARNING_BEFORE_MS = 2 * 60 * 1000; // warn 2 minutes before logout
let lastActivityAt = Date.now();
let idleWarningShown = false;
let idleCheckInterval = null;

function markActivity() {
    lastActivityAt = Date.now();
    if (idleWarningShown) hideIdleWarning();
}

function startIdleMonitor() {
    ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'].forEach((evt) => {
        document.addEventListener(evt, markActivity, { passive: true });
    });
    idleCheckInterval = setInterval(() => {
        const idleFor = Date.now() - lastActivityAt;
        if (idleFor >= IDLE_TIMEOUT_MS) {
            clearInterval(idleCheckInterval);
            logout('You were logged out after 30 minutes of inactivity.');
        } else if (idleFor >= IDLE_TIMEOUT_MS - IDLE_WARNING_BEFORE_MS) {
            showIdleWarning(Math.ceil((IDLE_TIMEOUT_MS - idleFor) / 1000));
        }
    }, 10000);
}

function showIdleWarning(secondsLeft) {
    idleWarningShown = true;
    let banner = document.getElementById('idleWarningBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'idleWarningBanner';
        banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'background:#4F6EF7;color:#fff;padding:12px 22px;border-radius:10px;font-weight:600;font-size:13.5px;' +
            'box-shadow:0 8px 24px rgba(20,30,60,0.25);display:flex;align-items:center;gap:14px;';
        document.body.appendChild(banner);
    }
    banner.innerHTML = `⏳ You'll be logged out in ${secondsLeft}s due to inactivity.
        <button onclick="markActivity()" style="background:#fff;color:#4F6EF7;border:none;padding:6px 14px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12.5px;">Stay Logged In</button>`;
}

function hideIdleWarning() {
    idleWarningShown = false;
    const banner = document.getElementById('idleWarningBanner');
    if (banner) banner.remove();
}

startIdleMonitor();