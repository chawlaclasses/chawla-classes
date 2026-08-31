// public/admin/js/config.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// CONFIG
// ============================================================
const API_BASE = '/api/admin';
const token = localStorage.getItem('adminToken');
if (!token) window.location.href = '/admin/login.html';

const adminName = localStorage.getItem('adminName') || 'Admin';
document.getElementById('adminName').textContent = adminName;
document.getElementById('adminAvatar').textContent = adminName.charAt(0).toUpperCase();

// ============================================================
// CLIENT-SIDE PERMISSIONS (UX only — hides nav items the backend would
// reject anyway, so staff don't hit confusing 403s. The real enforcement
// lives in config/permissions.js + middleware/permissions.js on the
// server; this mirror is deliberately kept simple and must stay in sync
// with it by hand if the server-side matrix changes.)
// ============================================================
const adminRole = localStorage.getItem('adminRole') || 'admin';
const ROLE_PERMISSIONS = {
    super_admin: ['*'],
    admin: ['dashboard:view','classes:*','subjects:*','series:*','tests:*','questions:*','homework:*','doubts:*','students:*','attendance:*','enquiries:*','admissions:*','fees:*','communication:*','ai:*','settings:view','settings:edit','audit:view','staff:view','staff:create','staff:edit','staff:deactivate','recruitment:*','marketing:*','reviews:*','categories:*','website_builder:*','footer:*'],
    teacher: ['dashboard:view','classes:view','subjects:view','series:view','tests:*','questions:*','homework:*','doubts:*','ai:*','attendance:*','students:view','students:notes'],
    reception: ['dashboard:view','enquiries:*','admissions:*','students:view','students:create','students:edit','classes:view','subjects:view','fees:view','fees:create','attendance:view'],
    accountant: ['dashboard:view','fees:*','students:view','classes:view'],
};
function hasPermission(permission) {
    const perms = ROLE_PERMISSIONS[adminRole] || [];
    if (perms.includes('*')) return true;
    if (perms.includes(permission)) return true;
    const resource = permission.split(':')[0];
    return perms.includes(`${resource}:*`);
}
document.querySelectorAll('.sidebar-item[data-permission]').forEach(item => {
    if (!hasPermission(item.dataset.permission)) item.style.display = 'none';
});

// Explicit reference to the content container (avoids relying on
// implicit global "named access" for elements with an id attribute)
const contentArea = document.getElementById('contentArea');