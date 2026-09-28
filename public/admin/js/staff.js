// public/admin/js/staff.js
//
// Staff Management — CRUD UI for staff accounts (super_admin, admin,
// teacher, reception, accountant), talking to routes/staff.js
// (/api/admin/staff). This was previously missing entirely: navigation.js
// already called `window.loadStaff()` when the "Staff" sidebar item was
// clicked, but no file defined it, so the click silently did nothing.
// Built to match the existing subjects.js/classes.js pattern.
//
// Also owns the "assignedClasses" / "assignedSubjects" UI for teacher
// accounts — leaving either empty means "sees every class / subject" (the
// old, unrestricted default); checking specific ones scopes that teacher
// accordingly (see config/permissions.js isClassAllowedForUser /
// isSubjectAllowedForUser, used by routes/admin/classes.js,
// routes/admin/subjects.js and routes/admin/attendance.js).

const STAFF_ROLE_LABELS = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    teacher: 'Teacher',
    reception: 'Reception',
    accountant: 'Accountant',
};

async function loadStaff() {
    showLoading();
    try {
        const [staffRes, classesRes, subjectsRes] = await Promise.all([
            apiCall('/staff'),
            apiCall('/classes'),
            apiCall('/subjects'),
        ]);
        window._staff = staffRes?.data || [];
        window._classes = classesRes?.data || window._classes || [];
        window._subjects = subjectsRes?.data || window._subjects || [];
        renderStaff();
    } catch (error) {
        showError('Failed to load staff', error.message);
    }
}

function renderStaff() {
    const staff = window._staff || [];
    const classes = window._classes || [];
    const subjects = window._subjects || [];
    const classNameById = id => classes.find(c => c._id === id)?.displayName || classes.find(c => c._id === id)?.name || '?';
    const subjectNameById = id => subjects.find(s => s._id === id)?.name || '?';

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>👤 Staff <span class="count">(${staff.length})</span></h2>
            ${hasPermission('staff:create') ? `<button class="btn btn-gold" onclick="showAddStaffModal()"><i class="fas fa-plus"></i> Add Staff</button>` : ''}
        </div>
        ${staff.length === 0 ? `
            <div class="empty-state"><span class="icon">👤</span><strong>No Staff Accounts</strong><p>Click "Add Staff" to create the first one.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Assigned Classes</th><th>Assigned Subjects</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${staff.map(s => {
                            const classesScoped = Array.isArray(s.assignedClasses) && s.assignedClasses.length > 0;
                            const subjectsScoped = Array.isArray(s.assignedSubjects) && s.assignedSubjects.length > 0;
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(s.name)}</strong></td>
                                    <td>${escapeHtml(s.email)}</td>
                                    <td>${STAFF_ROLE_LABELS[s.role] || escapeHtml(s.role)}</td>
                                    <td>${s.role === 'teacher' ? (classesScoped ? escapeHtml(s.assignedClasses.map(classNameById).join(', ')) : '<span style="color:var(--muted);">All classes</span>') : '<span style="color:var(--muted);">—</span>'}</td>
                                    <td>${s.role === 'teacher' ? (subjectsScoped ? escapeHtml(s.assignedSubjects.map(subjectNameById).join(', ')) : '<span style="color:var(--muted);">All subjects</span>') : '<span style="color:var(--muted);">—</span>'}</td>
                                    <td><span class="status-badge ${s.isActive !== false ? 'status-active' : 'status-inactive'}">${s.isActive !== false ? 'Active' : 'Inactive'}</span></td>
                                    <td>
                                        ${hasPermission('staff:edit') ? `<button class="btn btn-success btn-sm" onclick="editStaff('${s._id}')" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                                        ${hasPermission('staff:deactivate') ? `<button class="btn btn-danger btn-sm" onclick="toggleStaffActive('${s._id}')" title="${s.isActive !== false ? 'Deactivate' : 'Reactivate'}"><i class="fas fa-power-off"></i></button>` : ''}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

function classCheckboxesHtml(idPrefix, checkedIds = []) {
    const classes = window._classes || [];
    if (classes.length === 0) return '<p style="color:var(--muted);font-size:12px;">No classes set up yet.</p>';
    return classes.filter(c => c.isActive).map(c => `
        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-bottom:4px;">
            <input type="checkbox" id="${idPrefix}_${c._id}" value="${c._id}" ${checkedIds.includes(c._id) ? 'checked' : ''}>
            ${escapeHtml(c.displayName || c.name)}
        </label>
    `).join('');
}

function collectCheckedClasses(idPrefix) {
    const classes = window._classes || [];
    return classes.filter(c => document.getElementById(`${idPrefix}_${c._id}`)?.checked).map(c => c._id);
}

// Subjects are labeled with their class in parentheses, since the same
// subject name (e.g. "Mathematics") commonly exists once per class.
function subjectCheckboxesHtml(idPrefix, checkedIds = []) {
    const subjects = window._subjects || [];
    const classes = window._classes || [];
    if (subjects.length === 0) return '<p style="color:var(--muted);font-size:12px;">No subjects set up yet.</p>';
    const classNameById = id => classes.find(c => c._id === id)?.displayName || classes.find(c => c._id === id)?.name || '';
    return subjects.filter(s => s.isActive).map(s => `
        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-bottom:4px;">
            <input type="checkbox" id="${idPrefix}_${s._id}" value="${s._id}" ${checkedIds.includes(s._id) ? 'checked' : ''}>
            ${escapeHtml(s.name)}${classNameById(s.classId) ? ` <span style="color:var(--muted);">(${escapeHtml(classNameById(s.classId))})</span>` : ''}
        </label>
    `).join('');
}

function collectCheckedSubjects(idPrefix) {
    const subjects = window._subjects || [];
    return subjects.filter(s => document.getElementById(`${idPrefix}_${s._id}`)?.checked).map(s => s._id);
}

// Only show the "which classes/subjects" pickers for the teacher role —
// it's the only role whose permissions are class/subject-scoped today.
function toggleAssignedClassesVisibility(roleSelectId, classWrapperId, subjectWrapperId) {
    const role = document.getElementById(roleSelectId).value;
    const isTeacher = role === 'teacher';
    const classWrapper = document.getElementById(classWrapperId);
    if (classWrapper) classWrapper.style.display = isTeacher ? 'block' : 'none';
    if (subjectWrapperId) {
        const subjectWrapper = document.getElementById(subjectWrapperId);
        if (subjectWrapper) subjectWrapper.style.display = isTeacher ? 'block' : 'none';
    }
}

function showAddStaffModal() {
    showModal('Add Staff', 'Create a staff account', `
        <div class="form-group"><label>Name *</label><input type="text" id="staffName" placeholder="e.g., Rohit Chawla"></div>
        <div class="form-group"><label>Email *</label><input type="email" id="staffEmail" placeholder="teacher@example.com"></div>
        <div class="form-group"><label>Phone</label><input type="text" id="staffPhone" placeholder="Optional"></div>
        <div class="form-group"><label>Password *</label><input type="password" id="staffPassword" placeholder="Min 8 characters"></div>
        <div class="form-group"><label>Role *</label>
            <select id="staffRole" onchange="toggleAssignedClassesVisibility('staffRole', 'staffAssignedClassesWrap', 'staffAssignedSubjectsWrap')">
                <option value="">Select Role</option>
                ${Object.entries(STAFF_ROLE_LABELS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" id="staffAssignedClassesWrap" style="display:none;">
            <label>Assigned Classes <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every class)</span></label>
            ${classCheckboxesHtml('staffClass')}
        </div>
        <div class="form-group" id="staffAssignedSubjectsWrap" style="display:none;">
            <label>Assigned Subjects <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every subject)</span></label>
            ${subjectCheckboxesHtml('staffSubject')}
        </div>
    `, async () => {
        const name = document.getElementById('staffName').value.trim();
        const email = document.getElementById('staffEmail').value.trim();
        const phone = document.getElementById('staffPhone').value.trim();
        const password = document.getElementById('staffPassword').value;
        const role = document.getElementById('staffRole').value;
        if (!name || !email || !password || !role) { showToast('Error', 'Name, email, password, and role are required', 'error'); return; }
        const assignedClasses = role === 'teacher' ? collectCheckedClasses('staffClass') : [];
        const assignedSubjects = role === 'teacher' ? collectCheckedSubjects('staffSubject') : [];
        const result = await apiCall('/staff', { method: 'POST', body: JSON.stringify({ name, email, phone, password, role, assignedClasses, assignedSubjects }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create staff account', 'error'); return; }
        showToast('Success', 'Staff account created', 'success');
        closeModal();
        loadStaff();
    });
}

function editStaff(id) {
    const item = (window._staff || []).find(s => s._id === id);
    if (!item) return;
    showModal('Edit Staff', 'Update staff account', `
        <div class="form-group"><label>Name *</label><input type="text" id="editStaffName" value="${escapeHtml(item.name)}"></div>
        <div class="form-group"><label>Email</label><input type="email" value="${escapeHtml(item.email)}" disabled></div>
        <div class="form-group"><label>Phone</label><input type="text" id="editStaffPhone" value="${escapeHtml(item.phone || '')}"></div>
        <div class="form-group"><label>Role *</label>
            <select id="editStaffRole" onchange="toggleAssignedClassesVisibility('editStaffRole', 'editStaffAssignedClassesWrap', 'editStaffAssignedSubjectsWrap')">
                ${Object.entries(STAFF_ROLE_LABELS).map(([v, label]) => `<option value="${v}" ${v === item.role ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" id="editStaffAssignedClassesWrap" style="display:${item.role === 'teacher' ? 'block' : 'none'};">
            <label>Assigned Classes <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every class)</span></label>
            ${classCheckboxesHtml('editStaffClass', item.assignedClasses || [])}
        </div>
        <div class="form-group" id="editStaffAssignedSubjectsWrap" style="display:${item.role === 'teacher' ? 'block' : 'none'};">
            <label>Assigned Subjects <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every subject)</span></label>
            ${subjectCheckboxesHtml('editStaffSubject', item.assignedSubjects || [])}
        </div>
    `, async () => {
        const name = document.getElementById('editStaffName').value.trim();
        const phone = document.getElementById('editStaffPhone').value.trim();
        const role = document.getElementById('editStaffRole').value;
        if (!name || !role) { showToast('Error', 'Name and role are required', 'error'); return; }
        const assignedClasses = role === 'teacher' ? collectCheckedClasses('editStaffClass') : [];
        const assignedSubjects = role === 'teacher' ? collectCheckedSubjects('editStaffSubject') : [];
        const result = await apiCall(`/staff/${id}`, { method: 'PUT', body: JSON.stringify({ name, phone, role, assignedClasses, assignedSubjects }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update staff account', 'error'); return; }
        showToast('Success', 'Staff account updated', 'success');
        closeModal();
        loadStaff();
    });
}

async function toggleStaffActive(id) {
    const item = (window._staff || []).find(s => s._id === id);
    if (!item) return;
    const verb = item.isActive !== false ? 'deactivate' : 'reactivate';
    if (!confirm(`${verb === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${item.name}'s account?`)) return;
    const result = await apiCall(`/staff/${id}/toggle-active`, { method: 'PUT' });
    if (!result || !result.success) { showToast('Error', result?.message || `Failed to ${verb} account`, 'error'); return; }
    showToast('Success', result.message || 'Updated', 'success');
    loadStaff();
}