// public/js/footer.js
//
// Progressive enhancement for the site footer — Admin -> Footer
// Management (Social Links, Quick Links, Student Resources, About/
// Contact/Bottom-Bar settings). Included on every public page right
// after its <footer> markup.
//
// Same philosophy as index.html's inline loadNavCategories() script for
// the navbar: the footer markup already in each page's HTML is a real,
// working, static fallback — not a loading placeholder. This script only
// REPLACES a given piece of it once /api/footer actually returns
// meaningful data for that piece; a slow/failed request, or a
// not-yet-configured section (e.g. no social links added yet), just
// means visitors keep seeing the original static footer, never a broken
// or half-empty one. That's why every render* function below bails out
// early when its input is missing/empty instead of clearing the markup.
//
// Backend: routes/footer.js (GET /api/footer, public, combined read of
// social links + both nav columns + settings). Admin CRUD is separate:
// routes/admin/social-links.js, routes/admin/footer-links.js,
// routes/admin/footer-settings.js, wired into public/admin/js/footer-management.js.

(function () {
    "use strict";

    function escapeHtml(str) {
        if (str === undefined || str === null) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function loadFooter() {
        try {
            const res = await fetch("/api/footer");
            const json = await res.json();
            if (!json || !json.success || !json.data) return;

            const { socialLinks, quickLinks, studentResources, settings } = json.data;

            renderAbout(settings && settings.about);
            renderContact(settings && settings.contact);
            renderLinksColumn("footerQuickLinksList", quickLinks);
            renderLinksColumn("footerResourcesList", studentResources);
            renderSocialLinks(socialLinks);
            renderBottomBar(settings && settings.bottomBar);
        } catch (err) {
            // Fails silently — see file header. A missing/slow footer API
            // should never block the rest of the page.
        }
    }

    function renderAbout(about) {
        if (!about) return;
        const titleEl = document.getElementById("footerAboutTitle");
        const contentEl = document.getElementById("footerAboutContent");
        if (titleEl && about.title) titleEl.textContent = about.title;
        // .footer-about-content has `white-space: pre-line` (style.css), so
        // \n in the admin-entered content renders as real line breaks —
        // textContent (not innerHTML) is used here deliberately, so admin
        // input is never interpreted as HTML.
        if (contentEl && about.content) contentEl.textContent = about.content;
    }

    function renderContact(contact) {
        if (!contact) return;
        const el = document.getElementById("footerContactDetails");
        if (!el) return;

        const rows = [];
        if (contact.phone) {
            rows.push(
                `<p><a href="tel:${escapeHtml(contact.phone)}" style="color:#ddd;text-decoration:none;">` +
                `<i class="fas fa-phone" style="color:#ffc400;margin-right:6px;"></i> ${escapeHtml(contact.phone)}</a></p>`
            );
        }
        if (contact.whatsapp) {
            rows.push(
                `<p><a href="https://wa.me/${escapeHtml(contact.whatsapp.replace(/\D/g, ""))}" target="_blank" rel="noopener" style="color:#ddd;text-decoration:none;">` +
                `<i class="fab fa-whatsapp" style="color:#ffc400;margin-right:6px;"></i> ${escapeHtml(contact.whatsapp)}</a></p>`
            );
        }
        if (contact.email) {
            rows.push(`<p><i class="fas fa-envelope" style="color:#ffc400;margin-right:6px;"></i> ${escapeHtml(contact.email)}</p>`);
        }
        if (contact.address) {
            rows.push(`<p><i class="fas fa-map-marker-alt" style="color:#ffc400;margin-right:6px;"></i> ${escapeHtml(contact.address)}</p>`);
        }
        if (contact.workingHours) {
            rows.push(`<p><i class="fas fa-clock" style="color:#ffc400;margin-right:6px;"></i> ${escapeHtml(contact.workingHours)}</p>`);
        }

        if (rows.length === 0) return; // nothing configured yet — keep the static fallback
        el.innerHTML = rows.join("");
    }

    function renderLinksColumn(containerId, links) {
        if (!Array.isArray(links) || links.length === 0) return; // keep static fallback links
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`).join("");
    }

    function renderSocialLinks(links) {
        const el = document.getElementById("footerSocialLinks");
        if (!el) return;
        if (!Array.isArray(links) || links.length === 0) return; // .footer-social:empty hides itself via CSS
        el.innerHTML = links
            .map(
                (l) => `
                <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(l.platform)}" title="${escapeHtml(l.platform)}">
                    <i class="${escapeHtml(l.icon || "")}"></i>
                </a>`
            )
            .join("");
    }

    function renderBottomBar(bottomBar) {
        if (!bottomBar) return;
        const el = document.getElementById("footerBottomBar");
        if (!el) return;

        const parts = [];
        if (bottomBar.copyrightText) parts.push(escapeHtml(bottomBar.copyrightText));
        if (bottomBar.developedByText) parts.push(`<span class="footer-note">${escapeHtml(bottomBar.developedByText)}</span>`);
        if (bottomBar.footerNote) parts.push(`<span class="footer-note">${escapeHtml(bottomBar.footerNote)}</span>`);

        if (parts.length === 0) return; // nothing configured yet — keep the static fallback
        el.innerHTML = parts.join("");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadFooter);
    } else {
        loadFooter();
    }
})();
