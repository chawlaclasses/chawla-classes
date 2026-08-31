# Footer Management — file drop-in guide

This zip contains every new and changed file for the Footer Management
feature (Social Links, Quick Links, Student Resources, Contact/About/
Bottom-Bar settings). Extract it over your project root — every path
inside the zip matches its real location in the codebase.

## New files (9)
- `config/socialPlatforms.js`
- `services/footerSettings.js`
- `routes/admin/social-links.js`
- `routes/admin/footer-links.js`
- `routes/admin/footer-settings.js`
- `routes/footer.js`
- `public/admin/js/footer-management.js`
- `public/js/footer.js`
- `scripts/seed-footer.js`

## Modified files (22)
`utils/validators.js`, `app.js`, `routes/adminRoutes.js`,
`config/permissions.js`, `public/admin/js/config.js`,
`public/admin/js/navigation.js`, `public/admin/dashboard.html`,
`public/admin/css/admin.css`, `style.css`, `package.json`, `index.html`,
and all 11 pages in `public/` (`about.html`, `admission.html`,
`careers.html`, `contact.html`, `courses.html`, `edit-review.html`,
`feedback.html`, `gallery.html`, `results.html`, `reviews.html`,
`site-page.html`).

## After extracting

1. Restart the app so the new routes load:
   ```
   npm run dev   # or: node server.js
   ```
2. Seed the new collections from your current footer content (safe to
   run anytime — it's idempotent and skips anything already seeded):
   ```
   npm run seed-footer
   ```
3. Log into `/admin`, open **Footer Management** in the sidebar, and
   start managing Social Links / Quick Links / Student Resources /
   Settings. The public footer updates live on every page.

No other setup is required — everything else (MongoDB collections,
permissions) is created automatically the first time it's used.
