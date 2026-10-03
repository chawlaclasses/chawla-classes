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
    const subjectNameById = id => {
        const sub = subjects.find(s => s._id === id);
        if (!sub) return '?';
        const ctx = subjectContextLabel(sub, classNameById(sub.classId));
        return ctx ? `${sub.name} (${ctx})` : sub.name;
    };

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
                    <thead><tr><th>Name</th><th>Login ID</th><th>Email</th><th>Role</th><th>Assigned Classes</th><th>Assigned Subjects</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${staff.map(s => {
                            const classesScoped = Array.isArray(s.assignedClasses) && s.assignedClasses.length > 0;
                            const subjectsScoped = Array.isArray(s.assignedSubjects) && s.assignedSubjects.length > 0;
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(s.name)}</strong>${s.designation ? `<div style="color:var(--muted);font-size:12px;">${escapeHtml(s.designation)}</div>` : ''}</td>
                                    <td>${s.loginId ? `<code>${escapeHtml(s.loginId)}</code>` : '<span style="color:var(--muted);" title="Old account — signs in with email. Edit to set a Login ID.">— (uses email)</span>'}</td>
                                    <td>${escapeHtml(s.email) || '<span style="color:var(--muted);">—</span>'}</td>
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

// "Class XI · Commerce" — class plus stream (stream only for Class 11/12
// subjects that belong to one; common subjects show just the class).
function subjectContextLabel(subject, className) {
    return [className, subject.stream].filter(Boolean).join(' · ');
}

// Subjects are labeled with their class (and stream) in parentheses, since the
// same subject name (e.g. "Mathematics") commonly exists once per class/stream.
function subjectCheckboxesHtml(idPrefix, checkedIds = []) {
    const subjects = window._subjects || [];
    const classes = window._classes || [];
    if (subjects.length === 0) return '<p style="color:var(--muted);font-size:12px;">No subjects set up yet.</p>';
    const classNameById = id => classes.find(c => c._id === id)?.displayName || classes.find(c => c._id === id)?.name || '';
    return subjects.filter(s => s.isActive).map(s => `
        <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-bottom:4px;">
            <input type="checkbox" id="${idPrefix}_${s._id}" value="${s._id}" ${checkedIds.includes(s._id) ? 'checked' : ''}>
            ${escapeHtml(s.name)}${subjectContextLabel(s, classNameById(s.classId)) ? ` <span style="color:var(--muted);">(${escapeHtml(subjectContextLabel(s, classNameById(s.classId)))})</span>` : ''}
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
    showModal('Add Staff', 'Create a staff account — fields marked (Optional) can be left blank', `
        ${formSection('Basic Details', `
            <div class="form-group"><label>Name *</label><input type="text" id="staffName" placeholder="e.g., Rohit Chawla" maxlength="100"></div>
            <div class="form-row">
                <div class="form-group"><label>Role *</label>
                    <select id="staffRole" onchange="toggleAssignedClassesVisibility('staffRole', 'staffAssignedClassesWrap', 'staffAssignedSubjectsWrap')">
                        <option value="">Select Role</option>
                        ${Object.entries(STAFF_ROLE_LABELS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Designation${optionalTag()}</label><input type="text" id="staffDesignation" placeholder="e.g., Senior Maths Teacher" maxlength="100"></div>
            </div>
        `)}
        ${formSection('Contact', `
            <div class="form-row">
                <div class="form-group"><label>Mobile Number${optionalTag()}</label><input type="tel" id="staffPhone" placeholder="e.g., 9876543210"></div>
                <div class="form-group"><label>Email ID${optionalTag()}</label><input type="email" id="staffEmail" placeholder="teacher@example.com" autocomplete="off"></div>
            </div>
            <div class="field-hint" style="margin:-6px 0 12px;">Login details are emailed only if an email is entered.</div>
            <div class="form-group"><label>Address${optionalTag()}</label><textarea id="staffAddress" maxlength="500"></textarea></div>
        `)}
        ${formSection('Professional', `
            <div class="form-row">
                <div class="form-group"><label>Qualification${optionalTag()}</label><input type="text" id="staffQualification" placeholder="e.g., M.Sc., B.Ed." maxlength="200"></div>
                <div class="form-group"><label>Joining Date${optionalTag()}</label><input type="date" id="staffJoiningDate"></div>
            </div>
            <div class="form-group"><label>Notes${optionalTag()}</label><textarea id="staffNotes" maxlength="2000"></textarea></div>
        `)}
        ${formSection('Login', `
            <div class="form-group"><label>Login ID * <span style="color:var(--muted);font-weight:normal;">(custom username used to sign in — e.g. rohit.sir)</span></label>
                <input type="text" id="staffLoginId" name="cc-new-staff-login" placeholder="e.g. rohit.sir" readonly onfocus="this.removeAttribute('readonly')" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="form-group"><label>Password *</label><input type="password" id="staffPassword" placeholder="Min 8 characters" autocomplete="new-password"></div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
                <input type="checkbox" id="staffSendEmail" checked> Email the Login ID &amp; password to this staff member <span style="color:var(--muted);">(needs an email)</span></label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-top:4px;">
                <input type="checkbox" id="staffSendSms"> Also send as text message (SMS) <span style="color:var(--muted);">(goes to the mobile number; needs Fast2SMS set up)</span></label></div>
        `)}
        <div class="form-group" id="staffAssignedClassesWrap" style="display:none;">
            <label>Assigned Classes <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every class)</span></label>
            ${classCheckboxesHtml('staffClass')}
        </div>
        <div class="form-group" id="staffAssignedSubjectsWrap" style="display:none;">
            <label>Assigned Subjects <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every subject)</span></label>
            ${subjectCheckboxesHtml('staffSubject')}
        </div>
    `, async () => {
        const val = id => document.getElementById(id).value.trim();
        const name = val('staffName');
        const loginId = val('staffLoginId');
        const email = val('staffEmail');
        const phone = val('staffPhone');
        const password = document.getElementById('staffPassword').value;
        const role = document.getElementById('staffRole').value;
        const sendEmail = document.getElementById('staffSendEmail').checked && !!email;
        const sendSms = document.getElementById('staffSendSms').checked;
        if (sendSms && !phone) { showToast('Error', 'Enter a mobile number to send the text message', 'error'); return; }
        if (!name || !loginId || !password || !role) { showToast('Error', 'Name, role, login ID and password are required', 'error'); return; }
        if (!isValidOptionalEmail(email)) { showToast('Error', 'Enter a valid email address (or leave it blank)', 'error'); return; }
        if (!/^[A-Za-z0-9][A-Za-z0-9._@+-]{2,49}$/.test(loginId)) { showToast('Error', 'Login ID must be 3-50 characters using letters, numbers and . _ - @ + only (no spaces)', 'error'); return; }
        if (password.length < 8) { showToast('Error', 'Password must be at least 8 characters', 'error'); return; }
        const assignedClasses = role === 'teacher' ? collectCheckedClasses('staffClass') : [];
        const assignedSubjects = role === 'teacher' ? collectCheckedSubjects('staffSubject') : [];
        const result = await apiCall('/staff', { method: 'POST', body: JSON.stringify({
            name, loginId, email, phone, password, role, assignedClasses, assignedSubjects, sendEmail, sendSms,
            designation: val('staffDesignation'), qualification: val('staffQualification'), address: val('staffAddress'),
            joiningDate: val('staffJoiningDate'), notes: val('staffNotes'),
        }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create staff account', 'error'); return; }
        showToast((result.emailSent === false && sendEmail) || result.smsSent === false ? 'Created (some messages not sent)' : 'Success', result.message || 'Staff account created', (result.emailSent === false && sendEmail) || result.smsSent === false ? 'info' : 'success');
        closeModal();
        loadStaff();
    });
}

function editStaff(id) {
    const item = (window._staff || []).find(s => s._id === id);
    if (!item) return;
    const isActive = item.isActive !== false;
    showModal('Edit Staff', 'Update staff account — fields marked (Optional) can be left blank', `
        ${formSection('Basic Details', `
            ${profilePhotoFieldHtml('editStaff', item.name)}
            <div class="form-group"><label>Name *</label><input type="text" id="editStaffName" value="${escapeHtml(item.name)}" maxlength="100"></div>
            <div class="form-row">
                <div class="form-group"><label>Role *</label>
                    <select id="editStaffRole" onchange="toggleAssignedClassesVisibility('editStaffRole', 'editStaffAssignedClassesWrap', 'editStaffAssignedSubjectsWrap')">
                        ${Object.entries(STAFF_ROLE_LABELS).map(([v, label]) => `<option value="${v}" ${v === item.role ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Status *</label>
                    <select id="editStaffStatus">
                        <option value="active" ${isActive ? 'selected' : ''}>Active</option>
                        <option value="inactive" ${isActive ? '' : 'selected'}>Inactive</option>
                    </select>
                </div>
            </div>
            <div class="form-group"><label>Designation${optionalTag()}</label><input type="text" id="editStaffDesignation" value="${escapeHtml(item.designation || '')}" placeholder="e.g., Senior Maths Teacher" maxlength="100"></div>
        `)}
        ${formSection('Contact', `
            <div class="form-row">
                <div class="form-group"><label>Mobile Number *</label><input type="tel" id="editStaffPhone" value="${escapeHtml(item.phone || '')}" placeholder="e.g., 9876543210"></div>
                <div class="form-group"><label>Email ID${optionalTag()}</label><input type="email" id="editStaffEmail" oninput="document.getElementById('editStaffSendEmail').checked=true" value="${escapeHtml(item.email || '')}" autocomplete="off" placeholder="teacher@example.com"></div>
            </div>
            <div class="form-group"><label>Address${optionalTag()}</label><textarea id="editStaffAddress" maxlength="500">${escapeHtml(item.address || '')}</textarea></div>
        `)}
        ${formSection('Professional', `
            <div class="form-row">
                <div class="form-group"><label>Qualification${optionalTag()}</label><input type="text" id="editStaffQualification" value="${escapeHtml(item.qualification || '')}" maxlength="200"></div>
                <div class="form-group"><label>Joining Date${optionalTag()}</label><input type="date" id="editStaffJoiningDate" value="${escapeHtml(item.joiningDate || '')}"></div>
            </div>
            <div class="form-group"><label>Notes${optionalTag()}</label><textarea id="editStaffNotes" maxlength="2000">${escapeHtml(item.notes || '')}</textarea></div>
        `)}
        ${formSection('Login', `
            <div class="form-group"><label>Login ID <span style="color:var(--muted);font-weight:normal;">(used to sign in)</span></label>
                <input type="text" id="editStaffLoginId" oninput="document.getElementById('editStaffSendEmail').checked=true" name="cc-edit-staff-login" readonly onfocus="this.removeAttribute('readonly')" value="${escapeHtml(item.loginId || '')}" placeholder="${item.loginId ? '' : 'Not set — currently signs in with email. Set one here.'}" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
            <div class="form-group"><label>New Password${optionalTag()} <span style="color:var(--muted);font-weight:normal;">(leave blank to keep the current password)</span></label>
                <input type="password" id="editStaffPassword" oninput="document.getElementById('editStaffSendEmail').checked=true" placeholder="Min 8 characters" autocomplete="new-password">
            </div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
                <input type="checkbox" id="editStaffSendEmail"> Email the updated login details to this staff member <span style="color:var(--muted);">(needs an email; password is included only if you enter a new one)</span></label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:normal;margin-top:4px;">
                <input type="checkbox" id="editStaffSendSms"> Also send as text message (SMS) <span style="color:var(--muted);">(goes to the mobile number; needs Fast2SMS set up)</span></label></div>
        `)}
        <div class="form-group" id="editStaffAssignedClassesWrap" style="display:${item.role === 'teacher' ? 'block' : 'none'};">
            <label>Assigned Classes <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every class)</span></label>
            ${classCheckboxesHtml('editStaffClass', item.assignedClasses || [])}
        </div>
        <div class="form-group" id="editStaffAssignedSubjectsWrap" style="display:${item.role === 'teacher' ? 'block' : 'none'};">
            <label>Assigned Subjects <span style="color:var(--muted);font-weight:normal;">(leave all unchecked = this teacher sees every subject)</span></label>
            ${subjectCheckboxesHtml('editStaffSubject', item.assignedSubjects || [])}
        </div>
    `, async () => {
        const val = id => document.getElementById(id).value.trim();
        const name = val('editStaffName');
        const phone = val('editStaffPhone');
        const role = document.getElementById('editStaffRole').value;
        const password = document.getElementById('editStaffPassword').value;
        const loginId = val('editStaffLoginId');
        const email = val('editStaffEmail');
        const sendEmail = document.getElementById('editStaffSendEmail').checked && !!email;
        const sendSms = document.getElementById('editStaffSendSms').checked;
        if (!name || !role) { showToast('Error', 'Name and role are required', 'error'); return; }
        // Mobile is required, but an older account that never had one can still be saved without.
        if (!phone && item.phone) { showToast('Error', 'Mobile number is required', 'error'); return; }
        if (sendSms && !phone) { showToast('Error', 'Enter a mobile number to send the text message', 'error'); return; }
        if (!isValidOptionalEmail(email)) { showToast('Error', 'Enter a valid email address (or leave it blank)', 'error'); return; }
        if (!email && item.email && !loginId && !item.loginId) { showToast('Error', 'This account signs in with its email — set a Login ID before removing the email', 'error'); return; }
        if (loginId && !/^[A-Za-z0-9][A-Za-z0-9._@+-]{2,49}$/.test(loginId)) { showToast('Error', 'Login ID must be 3-50 characters using letters, numbers and . _ - @ + only (no spaces)', 'error'); return; }
        if (password && password.length < 8) { showToast('Error', 'Password must be at least 8 characters', 'error'); return; }
        const assignedClasses = role === 'teacher' ? collectCheckedClasses('editStaffClass') : [];
        const assignedSubjects = role === 'teacher' ? collectCheckedSubjects('editStaffSubject') : [];
        const body = {
            name, phone, role, email, assignedClasses, assignedSubjects, sendEmail, sendSms,
            isActive: document.getElementById('editStaffStatus').value === 'active',
            designation: val('editStaffDesignation'), qualification: val('editStaffQualification'),
            address: val('editStaffAddress'), joiningDate: val('editStaffJoiningDate'), notes: val('editStaffNotes'),
        };
        if (loginId && loginId.toLowerCase() !== (item.loginId || '').toLowerCase()) body.loginId = loginId;
        if (password) body.password = password; // blank = unchanged

        const saveBtn = document.getElementById('modalSaveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
        try {
            const result = await apiCall(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update staff account', 'error'); return; }
            const photo = await applyProfilePhotoChange('editStaff', `/staff/${id}/photo`);
            if (!photo.ok) {
                showToast('Saved (photo not updated)', `Details were saved, but the photo failed: ${photo.message}`, 'info');
            } else {
                showToast('Success', result.message || 'Staff account updated', 'success');
            }
            closeModal();
            loadStaff();
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
        }
    });
    initProfilePhoto('editStaff', `/staff/${id}/photo`, item.hasPhoto);
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
