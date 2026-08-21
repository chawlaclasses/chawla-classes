// services/settings.js
//
// Single-document application settings (institute info, academic session,
// passing criteria, theme, email/WhatsApp config, backup schedule,
// maintenance mode). Stored as one record in the 'app-settings' collection.

"use strict";

const db = require('./jsonDb');

const SETTINGS_ID = 'app-settings';

const DEFAULTS = {
    instituteName: 'Chawla Classes',
    logoUrl: '',
    faviconUrl: '',
    academicSession: '',
    passingCriteria: 33,
    themeColor: '#F5A623',
    email: {
        host: '', port: 587, secure: false, user: '', pass: '', fromName: '', fromAddress: ''
    },
    whatsapp: {
        provider: 'twilio', accountSid: '', authToken: '', fromNumber: ''
    },
    backup: {
        autoBackupEnabled: false, schedule: 'daily' // 'daily' | 'weekly'
    },
    socialLinks: {
        instagram: '', googlePhotos: ''
    },
    // Google Business Profile — deliberately NOT the Places API (no key,
    // no billing, no ongoing dependency, no reviews stored in our DB).
    // profileUrl (the Google Maps listing URL) is now the primary,
    // required-to-function config value — no manual Place ID entry needed.
    // rating + reviewCount are typed in here by whoever's updating this
    // and shown as-is on the public site, refreshed manually whenever the
    // admin wants — see public/js/googleReviews.js, public/reviews.html,
    // and index.html's Google Reviews block.
    // placeId is legacy/optional, kept only for backward compatibility
    // with installs configured before profileUrl existed (see
    // buildWriteReviewUrl() in public/js/googleReviews.js).
    googleReviews: {
        enabled: false, profileUrl: '', rating: null, reviewCount: null, placeId: '', updatedAt: null
    },
    maintenanceMode: false,
    maintenanceMessage: 'We are performing scheduled maintenance. Please check back soon.'
};

function getSettings() {
    const existing = db.findById('app-settings', SETTINGS_ID);
    if (!existing) {
        // First-ever read: seed the singleton record with defaults.
        const seeded = { _id: SETTINGS_ID, ...DEFAULTS };
        db.insert('app-settings', seeded);
        return seeded;
    }
    // Deep-merge so newly-added default fields show up for older saved settings.
    return {
        ...DEFAULTS,
        ...existing,
        email: { ...DEFAULTS.email, ...(existing.email || {}) },
        whatsapp: { ...DEFAULTS.whatsapp, ...(existing.whatsapp || {}) },
        backup: { ...DEFAULTS.backup, ...(existing.backup || {}) },
        socialLinks: { ...DEFAULTS.socialLinks, ...(existing.socialLinks || {}) },
        googleReviews: { ...DEFAULTS.googleReviews, ...(existing.googleReviews || {}) }
    };
}

function updateSettings(patch) {
    const current = getSettings();
    const merged = {
        ...current,
        ...patch,
        email: { ...current.email, ...(patch.email || {}) },
        whatsapp: { ...current.whatsapp, ...(patch.whatsapp || {}) },
        backup: { ...current.backup, ...(patch.backup || {}) },
        socialLinks: { ...current.socialLinks, ...(patch.socialLinks || {}) },
        googleReviews: { ...current.googleReviews, ...(patch.googleReviews || {}) }
    };
    delete merged._id;
    const existing = db.findById('app-settings', SETTINGS_ID);
    if (existing) {
        return db.updateById('app-settings', SETTINGS_ID, merged);
    }
    return db.insert('app-settings', { _id: SETTINGS_ID, ...merged });
}

// Safe subset for unauthenticated pages (login screens, maintenance check,
// and the public gallery.html page's Instagram/Google Photos links) —
// never include email/whatsapp credentials here.
function getPublicSettings() {
    const s = getSettings();
    return {
        instituteName: s.instituteName,
        logoUrl: s.logoUrl,
        faviconUrl: s.faviconUrl,
        maintenanceMode: s.maintenanceMode,
        maintenanceMessage: s.maintenanceMessage,
        socialLinks: s.socialLinks,
        googleReviews: s.googleReviews
    };
}

module.exports = { getSettings, updateSettings, getPublicSettings, SETTINGS_ID };