// public/js/mobile-app-banner.js
//
// Homepage "Download our app" section. Reads GET /api/mobile-app (settings
// managed in Admin -> System -> Mobile App) and shows #appDownloadBanner
// only when showBanner is true. The section ships with the `hidden`
// attribute, so if the request fails or the banner is switched off, nothing
// appears -- never a half-filled block. All text goes in via textContent
// (admin input is never interpreted as HTML) and the button only accepts an
// https:// link.

(function () {
    "use strict";

    async function init() {
        var section = document.getElementById("appDownloadBanner");
        if (!section) return;
        try {
            var res = await fetch("/api/mobile-app", { cache: "no-cache" });
            var d = await res.json();
            if (!d || !d.success || !d.showBanner) return;
            if (!/^https:\/\//i.test(d.apkUrl || "")) return;

            document.getElementById("appBannerTitle").textContent = d.bannerTitle || d.appName || "";
            document.getElementById("appBannerDesc").textContent = d.bannerDescription || "";
            document.getElementById("appBannerBtnText").textContent = d.buttonText || "Download App";
            if (d.version) document.getElementById("appBannerVersion").textContent = " · v" + d.version;

            var btn = document.getElementById("appBannerBtn");
            btn.href = d.apkUrl;
            btn.setAttribute("download", "");
            section.removeAttribute("hidden");
        } catch (err) {
            /* keep hidden */
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
