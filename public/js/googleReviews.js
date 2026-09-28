// public/js/googleReviews.js
//
// Shared Google Reviews logic — used by index.html (homepage) and
// public/reviews.html so the settings fetch, URL derivation, and
// XSS-safe rendering live in one place instead of being duplicated
// per page. Each page keeps its own markup/CSS to match its own design
// system; this module only owns the data + link-building + safety rules.
//
// No Google Places API, no API key, no billing, nothing stored in our
// DB — this only ever reads the admin-set googleReviews block from the
// public, unauthenticated /api/public-settings endpoint (same one
// gallery.html already uses for social links) and builds links to
// Google's own hosted pages.
"use strict";

(function (global) {
    // Only these hosts are ever accepted as the Google Business Profile
    // URL / read-reviews destination. Prevents a malformed or tampered
    // settings value from ever being rendered as a clickable link to an
    // arbitrary site.
    function isSafeGoogleMapsUrl(url) {
        if (typeof url !== "string" || !url) return false;
        try {
            const u = new URL(url);
            if (u.protocol !== "https:") return false;
            const host = u.hostname.toLowerCase();
            return (
                host === "goo.gl" ||
                host === "maps.app.goo.gl" ||
                /(^|\.)google\.[a-z.]{2,24}$/.test(host)
            );
        } catch (err) {
            return false;
        }
    }

    // Fetches settings.googleReviews and returns it only if it's enabled
    // and has a usable, safe profile URL — otherwise null, so callers can
    // treat "null" as a single hide-the-widget signal (disabled, not yet
    // configured, or a fetch/parse failure all collapse to the same
    // graceful outcome).
    async function fetchGoogleReviewsSettings() {
        try {
            const res = await fetch("/api/public-settings");
            if (!res.ok) return null;
            const json = await res.json();
            const g = json && json.data && json.data.googleReviews;
            if (!g || !g.enabled || !isSafeGoogleMapsUrl(g.profileUrl)) return null;
            return {
                profileUrl: g.profileUrl,
                rating: typeof g.rating === "number" ? g.rating : null,
                reviewCount: typeof g.reviewCount === "number" ? g.reviewCount : null,
                placeId: typeof g.placeId === "string" ? g.placeId : ""
            };
        } catch (err) {
            return null;
        }
    }

    // "Read Our Google Reviews" always opens the configured profile URL
    // directly — that's the real Google Business Profile, no derivation
    // needed.
    function buildReadReviewsUrl(g) {
        return g.profileUrl;
    }

    // "Write a Review on Google" (label): a true one-click "open the review
    // form"
    // link needs a Google Place ID (ChIJ...), which can't be reliably
    // derived from a Maps URL/CID without calling the Places API — and
    // this project deliberately doesn't use that API. So:
    //   - if a legacy placeId was saved (installs configured before
    //     profileUrl existed), reuse the project's existing, already-
    //     working direct link built from it;
    //   - otherwise, send people to the profile URL itself (a real,
    //     working destination where they can open the reviews tab and
    //     write one) rather than inventing an unverified "review" URL.
    function buildWriteReviewUrl(g) {
        if (g.placeId) {
            return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(g.placeId)}`;
        }
        return g.profileUrl;
    }

    function starString(rating) {
        const full = Math.min(5, Math.max(0, Math.round(rating || 0)));
        return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
    }

    // Generic renderer for pages that don't already have bespoke Google
    // Reviews markup: builds the whole card via safe DOM APIs only (no
    // innerHTML with settings-derived strings) into `root`, or hides
    // `root` if reviews are disabled/unconfigured/unreachable. Pages with
    // their own existing markup (e.g. reviews.html) can instead call
    // fetchGoogleReviewsSettings()/buildReadReviewsUrl()/
    // buildWriteReviewUrl() directly and populate their own elements.
    async function renderInto(root) {
        if (!root) return;
        const g = await fetchGoogleReviewsSettings();
        if (!g) {
            root.style.display = "none";
            return;
        }

        root.innerHTML = "";

        const ratingBlock = document.createElement("div");
        ratingBlock.className = "grw-rating-block";

        const ratingNumber = document.createElement("div");
        ratingNumber.className = "grw-rating-number";
        ratingNumber.textContent = g.rating !== null ? g.rating.toFixed(1) : "\u2014";

        const metaWrap = document.createElement("div");
        const stars = document.createElement("span");
        stars.className = "grw-stars";
        stars.textContent = starString(g.rating);
        const metaText = document.createElement("span");
        metaText.className = "grw-rating-meta";
        metaText.textContent = "Google Rating" + (g.reviewCount !== null ? ` \u00b7 ${g.reviewCount}+ Google Reviews` : "");
        metaWrap.appendChild(stars);
        metaWrap.appendChild(document.createElement("br"));
        metaWrap.appendChild(metaText);

        ratingBlock.appendChild(ratingNumber);
        ratingBlock.appendChild(metaWrap);

        const actions = document.createElement("div");
        actions.className = "grw-actions";

        // Icon classes below are hardcoded by us (never derived from
        // settings/user data), so a plain className assignment here
        // carries no XSS risk -- only the href/text content that came
        // from settings goes through the safe paths above.
        function iconLink(className, iconClass, label, href) {
            const a = document.createElement("a");
            a.className = className;
            const icon = document.createElement("i");
            icon.className = iconClass;
            a.appendChild(icon);
            a.appendChild(document.createTextNode(" " + label));
            a.href = href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            return a;
        }

        const readBtn = iconLink("grw-btn grw-btn-primary", "fab fa-google", "Read Our Google Reviews", buildReadReviewsUrl(g));
        const writeBtn = iconLink("grw-btn", "fas fa-pen", "Write a Review on Google", buildWriteReviewUrl(g));

        actions.appendChild(readBtn);
        actions.appendChild(writeBtn);

        root.appendChild(ratingBlock);
        root.appendChild(actions);
        root.style.display = "flex";
    }

    global.GoogleReviewsWidget = {
        fetchGoogleReviewsSettings,
        buildReadReviewsUrl,
        buildWriteReviewUrl,
        isSafeGoogleMapsUrl,
        renderInto
    };
})(window);
