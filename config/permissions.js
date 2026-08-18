/**
 * config/permissions.js
 *
 * Single source of truth for staff roles and what each role is allowed
 * to do. This is intentionally separate from routing/middleware — routes
 * just ask "can this role do X?" via hasPermission(), so the actual rules
 * live in one place and are easy to audit or change later.
 *
 * Permission strings are "resource:action", e.g. 'fees:create'.
 * A role's list can include:
 *   '*'              — full access to everything (super_admin only)
 *   'resource:*'      — full access to one resource (all actions on it)
 *   'resource:action'  — one specific action
 *
 * NOTE: this file only defines the rules. Nothing is enforced until a
 * route actually calls requirePermission() (see middleware/permissions.js).
 * As of now it's wired into the Staff Management routes and the /settings
 * and /audit-logs routes; the rest of adminRoutes.js still only requires
 * "any logged-in staff member" (requireApiAdmin) so existing behaviour
 * for the single 'admin' role Rohit already has doesn't change. Locking
 * down individual resources (fees, attendance, etc.) per role is meant to
 * be turned on incrementally by adding requirePermission(...) to those
 * routes when the actual staff accounts are created.
 */

"use strict";

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  TEACHER: 'teacher',
  RECEPTION: 'reception',
  ACCOUNTANT: 'accountant',
};

// Every role that is allowed to log in through /api/admin/login and reach
// the admin panel at all (as opposed to the student portal).
const STAFF_ROLES = Object.values(ROLES);

// Roles that may create/edit/deactivate OTHER staff accounts, and the
// ceiling on which roles they're allowed to assign. Enforced in
// routes/staff.js, not just here — see ROLE_ASSIGNMENT_LIMITS below.
const ROLE_ASSIGNMENT_LIMITS = {
  // super_admin can create/manage staff of any role, including other
  // super_admins.
  [ROLES.SUPER_ADMIN]: STAFF_ROLES,
  // admin can create/manage everyday staff, but not super_admins or other
  // admins — that stays a super_admin-only action so one admin can't
  // silently promote themselves or a colleague.
  [ROLES.ADMIN]: [ROLES.TEACHER, ROLES.RECEPTION, ROLES.ACCOUNTANT],
};

/**
 * Permission matrix. Keep this readable over clever — it's the thing a
 * non-engineer (Mrs. Chawla, a future ops hire) should be able to skim
 * and understand who can do what.
 */
const ROLE_PERMISSIONS = {
  // Full, unrestricted access — the owner-level role.
  [ROLES.SUPER_ADMIN]: ['*'],

  // Day-to-day operator. Everything a super_admin can do EXCEPT manage
  // other admins/super_admins and irreversible system-level actions
  // (restoring a backup, deleting backups) — those stay super_admin-only.
  [ROLES.ADMIN]: [
    'dashboard:view',
    'classes:*', 'subjects:*', 'series:*',
    'tests:*', 'questions:*', 'questions:approve', 'questions:publish',
    'homework:*', 'doubts:*',
    'students:*', 'attendance:*',
    'enquiries:*', 'admissions:*', 'fees:*', 'communication:*', 'ai:*',
    'settings:view', 'settings:edit',
    // Deliberately NOT 'settings:backup_restore' — restoring or deleting a
    // backup overwrites live data and can't fully be undone, so that one
    // stays super_admin-only (covered by the '*' above for that role).
    'audit:view',
    'staff:view', 'staff:create', 'staff:edit', 'staff:deactivate',
    // Candidate PII (resumes, contact info, salary expectations) — only
    // admin/super_admin, never teacher/reception/accountant.
    'recruitment:*',
    // Promo banners on the public site + bulk promotional Email/WhatsApp/
    // SMS campaigns to leads and students. Same trust level as
    // 'communication:*' above — kept admin/super_admin only for now.
    'marketing:*',
    // Moderating what shows in the public "Student Reviews" section.
    'reviews:*',
    // Homepage navbar categories (Home/About/Courses/.../Contact) —
    // same trust level as marketing/reviews: changes what every visitor
    // sees on the public site, but not financial/student-record data.
    'categories:*',
    // Website Builder — homepage section library (Admin -> Website Builder).
    'website_builder:*',
  ],

  // Runs classes and tests. No visibility into money or admissions
  // pipeline, and can't touch other staff accounts or settings.
  [ROLES.TEACHER]: [
    'dashboard:view',
    'classes:view', 'subjects:view', 'series:view',
    'tests:*',
    // Deliberately NOT 'questions:*' — a teacher can create, edit, and
    // submit a question for review, but can't approve or publish their
    // own work (or anyone else's). That review step stays with
    // admin/super_admin so a second person always signs off before a
    // question goes live in the bank.
    'questions:view', 'questions:create', 'questions:edit',
    'homework:*', 'doubts:*', 'ai:*',
    'attendance:*',
    'students:view', 'students:notes',
  ],

  // Front-desk: admissions pipeline and basic student records, plus
  // logging a fee as due (but not marking it paid — that's accounting's
  // call) so a walk-in enquiry can go straight to enrolment.
  [ROLES.RECEPTION]: [
    'dashboard:view',
    'enquiries:*', 'admissions:*',
    'students:view', 'students:create', 'students:edit',
    'classes:view', 'subjects:view',
    'fees:view', 'fees:create',
    'attendance:view',
  ],

  // Owns the money. Full run of fees, read-only everywhere else needed
  // to make sense of a fee record (which student, which class).
  [ROLES.ACCOUNTANT]: [
    'dashboard:view',
    'fees:*',
    'students:view',
    'classes:view',
  ],
};

/**
 * @param {string} role
 * @param {string} permission - e.g. 'fees:create'
 * @returns {boolean}
 */
function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const resource = permission.split(':')[0];
  if (perms.includes(`${resource}:*`)) return true;
  return false;
}

/**
 * Can `actingRole` assign/manage a staff member with `targetRole`?
 * Used by routes/staff.js when creating or editing a staff account.
 */
function canAssignRole(actingRole, targetRole) {
  const allowed = ROLE_ASSIGNMENT_LIMITS[actingRole];
  return Array.isArray(allowed) && allowed.includes(targetRole);
}

/**
 * Is `userData` allowed to act on `classId`?
 *
 * Class-scoping only applies to accounts that actually have a non-empty
 * assignedClasses list — today that's specifically teachers whose admin
 * has assigned them to particular classes via Staff Management. Everyone
 * else (super_admin/admin, or a teacher with no assignment set, i.e. the
 * old unrestricted default) is unrestricted, same as before this existed.
 * Used by routes/admin/classes.js (to filter the list) and
 * routes/admin/attendance.js (to block marking outside your classes).
 */
function isClassAllowedForUser(userData, classId) {
  const assigned = userData?.assignedClasses;
  if (!Array.isArray(assigned) || assigned.length === 0) return true;
  return assigned.includes(classId);
}

/**
 * Same idea as isClassAllowedForUser, but for subjects — a teacher can be
 * scoped to specific subjects (e.g. "Maths" across classes, or just their
 * own subject) independently of which classes they're scoped to. Used by
 * routes/admin/subjects.js to filter the list.
 */
function isSubjectAllowedForUser(userData, subjectId) {
  const assigned = userData?.assignedSubjects;
  if (!Array.isArray(assigned) || assigned.length === 0) return true;
  return assigned.includes(subjectId);
}

module.exports = {
  ROLES,
  STAFF_ROLES,
  ROLE_PERMISSIONS,
  ROLE_ASSIGNMENT_LIMITS,
  hasPermission,
  canAssignRole,
  isClassAllowedForUser,
  isSubjectAllowedForUser,
};