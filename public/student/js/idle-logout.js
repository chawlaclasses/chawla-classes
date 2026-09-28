/**
 * public/student/js/idle-logout.js
 *
 * Auto-logout after inactivity — shared by every live student page that
 * includes it (dashboard, homework, doubts, fees, results, security).
 * Deliberately NOT included on test.html — logging a student out
 * mid-exam because they were reading a question for a while without
 * touching the mouse would be actively harmful, and that page already
 * has its own timer/auto-submit flow.
 *
 * Plain script (no ES module), so it works the same way on every page
 * regardless of whether that page uses modules elsewhere.
 */

(function () {
  "use strict";

  const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const WARNING_BEFORE_MS = 2 * 60 * 1000; // warn 2 minutes before logout
  const CHECK_INTERVAL_MS = 10000;

  // Only run on pages where the student is actually logged in — every
  // live student page already redirects to login.html if this is missing,
  // this is just a defensive guard in case the script is ever included
  // somewhere it shouldn't be.
  if (!localStorage.getItem("studentToken")) return;

  let lastActivityAt = Date.now();
  let warningEl = null;

  function markActivity() {
    lastActivityAt = Date.now();
    if (warningEl) {
      warningEl.remove();
      warningEl = null;
    }
  }

  function doLogout(reason) {
    const currentToken = localStorage.getItem("studentToken");
    // Best-effort — end the session server-side too. Fire-and-forget; must
    // never delay the actual logout if the server is unreachable.
    if (currentToken) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + currentToken },
      }).catch(function () {});
    }
    localStorage.removeItem("studentToken");
    localStorage.removeItem("studentEmail");
    localStorage.removeItem("studentName");
    localStorage.removeItem("userClass");
    if (reason) sessionStorage.setItem("cc_logoutReason", reason);
    window.location.href = "/student/login.html";
  }

  function showWarning(secondsLeft) {
    if (!warningEl) {
      warningEl = document.createElement("div");
      warningEl.id = "idleWarningBanner";
      warningEl.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;" +
        "background:#F5A623;color:#0A1628;padding:12px 22px;border-radius:10px;font-weight:600;" +
        "font-size:13.5px;box-shadow:0 8px 24px rgba(0,0,0,0.25);display:flex;align-items:center;gap:14px;" +
        "font-family:'Inter',Arial,sans-serif;";
      document.body.appendChild(warningEl);
    }
    warningEl.innerHTML =
      "⏳ You'll be logged out in " + secondsLeft + "s due to inactivity. " +
      '<button id="idleStayBtn" style="background:#0A1628;color:#F5A623;border:none;padding:6px 14px;' +
      'border-radius:6px;font-weight:700;cursor:pointer;font-size:12.5px;">Stay Logged In</button>';
    document.getElementById("idleStayBtn").addEventListener("click", markActivity);
  }

  ["click", "keydown", "scroll", "mousemove", "touchstart"].forEach(function (evt) {
    document.addEventListener(evt, markActivity, { passive: true });
  });

  setInterval(function () {
    const idleFor = Date.now() - lastActivityAt;
    if (idleFor >= IDLE_TIMEOUT_MS) {
      doLogout("You were logged out after 30 minutes of inactivity.");
    } else if (idleFor >= IDLE_TIMEOUT_MS - WARNING_BEFORE_MS) {
      showWarning(Math.ceil((IDLE_TIMEOUT_MS - idleFor) / 1000));
    }
  }, CHECK_INTERVAL_MS);
})();
