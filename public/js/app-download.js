// public/js/app-download.js
//
// Progressive enhancement for the "Download App" button. The button markup
// on each page (header "Get App" pill, mobile-menu link, footer strip) ships
// with the `hidden` attribute; this script asks GET /api/app-download what
// the admin configured (Admin -> App Download) and then shows only the
// placements that are switched on, with the admin's button/footer text.
// It also creates the optional floating button. If the request fails, the
// buttons simply stay hidden -- never a broken half-state.
//
// The link target is always /download-app (routes/appDownload.js), which
// serves the uploaded APK or redirects to the admin-set link.

(function () {
    "use strict";

    function setText(root, selector, text) {
        if (!text) return;
        root.querySelectorAll(selector).forEach(function (el) { el.textContent = text; });
    }

    function show(slot, on) {
        document.querySelectorAll('[data-app-slot="' + slot + '"]').forEach(function (el) {
            if (on) el.removeAttribute("hidden"); else el.setAttribute("hidden", "");
        });
    }

    function addFloating(label) {
        if (document.getElementById("appFloatBtn")) return;
        var a = document.createElement("a");
        a.id = "appFloatBtn";
        a.className = "app-float-btn";
        a.href = "/download-app";
        a.setAttribute("aria-label", label);
        a.innerHTML = '<i class="fab fa-android"></i> <span></span>';
        a.querySelector("span").textContent = label;
        document.body.appendChild(a);
    }

    async function init() {
        try {
            var res = await fetch("/api/app-download");
            var json = await res.json();
            var d = json && json.success && json.data;
            if (!d || !d.enabled) return;

            var p = d.placements || {};
            var label = d.buttonLabel || "Get App";

            setText(document, "[data-app-label]", label);
            var footerText = d.footerText || "Chawla Classes Student App";
            if (d.versionLabel) footerText += " · v" + d.versionLabel;
            setText(document, "[data-app-footer-text]", footerText);

            show("header", !!p.header);
            show("mobileMenu", !!p.mobileMenu);
            show("footer", !!p.footer);
            if (p.floating) addFloating(label);
        } catch (err) {
            /* leave everything hidden */
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
