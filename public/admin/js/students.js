// public/admin/js/students.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// STUDENTS LIST + 360° PROFILE
// ============================================================
async function loadStudents() {
    showLoading();
    try {
        const [studentsRes, classesRes] = await Promise.all([
            apiCall('/students-list'),
            apiCall('/classes')
        ]);
        window._allStudents = studentsRes?.data || [];
        window._allClasses = classesRes?.data || [];
        window._selectedStudents = new Set();
        renderStudentsList(window._allStudents);
    } catch (error) {
        showError('Failed to load students', error.message);
    }
}

function renderStudentsList(list) {
    const classOptions = window._allClasses.map(c => `<option value="${c._id}">${escapeHtml(c.displayName || c.name)}</option>`).join('');
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>👨‍🎓 Students <span class="count">(${list.length})</span></h2>
            <button class="btn btn-gold btn-sm" onclick="addStudentModal()"><i class="fas fa-user-plus"></i> Add Student</button>
        </div>
        <div class="search-filter-bar">
            <div class="search-field"><i class="fas fa-user"></i><input type="text" id="searchName" placeholder="Search by name..." oninput="applyStudentFilters()"></div>
            <div class="search-field"><i class="fas fa-id-card"></i><input type="text" id="searchRoll" placeholder="Roll No..." oninput="applyStudentFilters()"></div>
            <div class="search-field"><i class="fas fa-phone"></i><input type="text" id="searchMobile" placeholder="Mobile..." oninput="applyStudentFilters()"></div>
            <div class="search-field"><i class="fas fa-school"></i><select id="searchClass" onchange="applyStudentFilters()"><option value="">All Classes</option>${classOptions}</select></div>
            <div class="search-field"><i class="fas fa-toggle-on"></i><select id="searchStatus" onchange="applyStudentFilters()">
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
            </select></div>
        </div>
        <div id="bulkActionsBar" style="display:none;background:var(--gold-glow);border:1px solid rgba(79,110,247,0.3);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="color:var(--gold);font-size:13px;font-weight:600;"><span id="selectedCount">0</span> selected</span>
            <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="bulkChangeClassModal()"><i class="fas fa-exchange-alt"></i> Change Class</button>
            <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="bulkNotifyModal()"><i class="fas fa-bell"></i> Send Notification</button>
            <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="bulkExport()"><i class="fas fa-file-export"></i> Export Selected</button>
            <button class="btn btn-sm" style="background:rgba(239,68,68,0.12);color:#dc2626;border:none;" onclick="bulkDeactivate()"><i class="fas fa-ban"></i> Deactivate</button>
            <button class="btn btn-sm" style="background:rgba(34,197,94,0.12);color:#16a34a;border:none;" onclick="bulkActivate()"><i class="fas fa-check"></i> Activate</button>
        </div>
        <div style="margin-bottom:10px;">
            <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--muted);" onclick="exportAllStudents()"><i class="fas fa-download"></i> Export All (CSV)</button>
        </div>
        <div id="studentsListContainer"></div>
    `;
    renderStudentsTable(list);
}

function renderStudentsTable(list) {
    const container = document.getElementById('studentsListContainer');
    if (!container) return;
    container.innerHTML = list.length === 0 ? `
        <div class="empty-state"><span class="icon">👨‍🎓</span><strong>No Students Found</strong><p>Try different search criteria.</p></div>
    ` : `
        <div class="table-container">
            <table>
                <thead><tr>
                    <th><input type="checkbox" id="selectAllStudents" onchange="toggleSelectAllStudents(this.checked)"></th>
                    <th>Name</th><th>Roll No</th><th>Mobile</th><th>Email</th><th>Class</th><th>Fee</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                    ${list.map(s => `
                        <tr>
                            <td><input type="checkbox" class="student-checkbox" value="${s._id}" ${window._selectedStudents.has(s._id) ? 'checked' : ''} onchange="toggleSelectStudent('${s._id}', this.checked)"></td>
                            <td><strong>${escapeHtml(s.name)}</strong></td>
                            <td>${escapeHtml(s.rollNumber) || '-'}</td>
                            <td>${escapeHtml(s.phone) || '-'}</td>
                            <td>${escapeHtml(s.email)}</td>
                            <td>${escapeHtml(s.class)}</td>
                            <td>${s.feeStatus === 'paid' ? '<span class="status-badge status-active">Paid</span>' : s.feeStatus === 'due' ? '<span class="status-badge status-inactive">Due</span>' : '<span class="status-badge status-draft">—</span>'}</td>
                            <td><span class="status-badge ${s.isActive ? 'status-active' : 'status-inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                            <td><button class="btn btn-gold btn-sm" onclick="showStudentProfile('${s._id}')"><i class="fas fa-user"></i> View</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    syncSelectAllCheckbox();
    updateStudentBulkActionsBar();
}

function applyStudentFilters() {
    const name = document.getElementById('searchName').value.trim().toLowerCase();
    const roll = document.getElementById('searchRoll').value.trim().toLowerCase();
    const mobile = document.getElementById('searchMobile').value.trim().toLowerCase();
    const classId = document.getElementById('searchClass').value;
    const status = document.getElementById('searchStatus').value;

    const filtered = window._allStudents.filter(s => {
        if (name && !s.name.toLowerCase().includes(name)) return false;
        if (roll && !(s.rollNumber || '').toLowerCase().includes(roll)) return false;
        if (mobile && !(s.phone || '').toLowerCase().includes(mobile)) return false;
        if (classId && s.classId !== classId) return false;
        if (status === 'active' && !s.isActive) return false;
        if (status === 'inactive' && s.isActive) return false;
        return true;
    });
    renderStudentsTable(filtered);
}

function toggleSelectStudent(id, checked) {
    if (checked) window._selectedStudents.add(id); else window._selectedStudents.delete(id);
    syncSelectAllCheckbox();
    updateStudentBulkActionsBar();
}

function toggleSelectAllStudents(checked) {
    document.querySelectorAll('.student-checkbox').forEach(cb => {
        cb.checked = checked;
        if (checked) window._selectedStudents.add(cb.value); else window._selectedStudents.delete(cb.value);
    });
    syncSelectAllCheckbox();
    updateStudentBulkActionsBar();
}

// Keeps the header "Select All" checkbox in sync with individual row
// checkboxes: fully checked -> checked, none checked -> unchecked,
// some checked -> indeterminate (dash) state.
function syncSelectAllCheckbox() {
    const selectAll = document.getElementById('selectAllStudents');
    if (!selectAll) return;
    const boxes = document.querySelectorAll('.student-checkbox');
    const total = boxes.length;
    const checkedCount = document.querySelectorAll('.student-checkbox:checked').length;
    if (total === 0 || checkedCount === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else if (checkedCount === total) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
    } else {
        selectAll.checked = false;
        selectAll.indeterminate = true;
    }
}

function updateStudentBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    if (!bar) return;
    const count = document.querySelectorAll('.student-checkbox:checked').length;
    // Show/hide first, independent of the count text — so a missing/late
    // #selectedCount element can never block the bar from appearing.
    bar.style.display = count > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = count;
}

async function bulkDeactivate() {
    if (!confirm(`Deactivate ${window._selectedStudents.size} selected student(s)?`)) return;
    const result = await apiCall('/students/bulk', { method: 'POST', body: JSON.stringify({ action: 'deactivate', studentIds: [...window._selectedStudents] }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to deactivate students', 'error'); return; }
    showToast('Success', 'Students deactivated', 'success');
    loadStudents();
}

async function bulkActivate() {
    const result = await apiCall('/students/bulk', { method: 'POST', body: JSON.stringify({ action: 'activate', studentIds: [...window._selectedStudents] }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to activate students', 'error'); return; }
    showToast('Success', 'Students activated', 'success');
    loadStudents();
}

function addStudentModal() {
    const classOptions = window._allClasses.map(c => `<option value="${c._id}">${escapeHtml(c.displayName || c.name)}</option>`).join('');
    showModal('Add Student', 'Create a new student account', `
        <div class="form-group"><label>Name *</label><input type="text" id="newStudentName" placeholder="Full name"></div>
        <div class="form-group"><label>Email *</label><input type="email" id="newStudentEmail" placeholder="student@example.com" autocomplete="off"></div>
        <div class="form-group"><label>Password *</label><input type="password" id="newStudentPassword" placeholder="At least 6 characters" autocomplete="new-password"></div>
        <div class="form-row">
            <div class="form-group"><label>Phone</label><input type="text" id="newStudentPhone" placeholder="Optional"></div>
            <div class="form-group"><label>Roll Number</label><input type="text" id="newStudentRoll" placeholder="Optional"></div>
        </div>
        <div class="form-group"><label>Class</label><select id="newStudentClass"><option value="">Not assigned yet</option>${classOptions}</select></div>
    `, async () => {
        const name = document.getElementById('newStudentName').value.trim();
        const email = document.getElementById('newStudentEmail').value.trim();
        const password = document.getElementById('newStudentPassword').value;
        const phone = document.getElementById('newStudentPhone').value.trim();
        const rollNumber = document.getElementById('newStudentRoll').value.trim();
        const classId = document.getElementById('newStudentClass').value;

        if (!name) { showToast('Error', 'Name is required', 'error'); return; }
        if (!email) { showToast('Error', 'Email is required', 'error'); return; }
        if (!password || password.length < 6) { showToast('Error', 'Password must be at least 6 characters', 'error'); return; }

        const result = await apiCall('/students', { method: 'POST', body: JSON.stringify({ name, email, password, phone, rollNumber, classId }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create student', 'error'); return; }

        showToast('Success', result.message || 'Student created', 'success');
        closeModal();
        loadStudents();
    });
}

function bulkChangeClassModal() {
    const classOptions = window._allClasses.map(c => `<option value="${c._id}">${escapeHtml(c.displayName || c.name)}</option>`).join('');
    showModal('Change Class', `Move ${window._selectedStudents.size} selected student(s) to a new class`, `
        <div class="form-group"><label>New Class *</label><select id="bulkClassSelect"><option value="">Select a class</option>${classOptions}</select></div>
    `, async () => {
        const classId = document.getElementById('bulkClassSelect').value;
        if (!classId) { showToast('Error', 'Please select a class', 'error'); return; }
        const result = await apiCall('/students/bulk', { method: 'POST', body: JSON.stringify({ action: 'change-class', studentIds: [...window._selectedStudents], classId }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to change class', 'error'); return; }
        showToast('Success', 'Class updated for selected students', 'success');
        closeModal();
        loadStudents();
    });
}

function bulkNotifyModal() {
    showModal('Send Notification', `To ${window._selectedStudents.size} selected student(s)`, `
        <div class="form-group"><label>Title</label><input type="text" id="bulkNotifyTitle" placeholder="e.g., Fee Reminder"></div>
        <div class="form-group"><label>Message *</label><textarea id="bulkNotifyMessage" placeholder="Your message..."></textarea></div>
    `, async () => {
        const notificationTitle = document.getElementById('bulkNotifyTitle').value.trim();
        const notificationMessage = document.getElementById('bulkNotifyMessage').value.trim();
        if (!notificationMessage) { showToast('Error', 'Message is required', 'error'); return; }
        const result = await apiCall('/students/bulk', { method: 'POST', body: JSON.stringify({ action: 'notify', studentIds: [...window._selectedStudents], notificationTitle, notificationMessage }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send notification', 'error'); return; }
        showToast('Success', 'Notification sent', 'success');
        closeModal();
    });
}

function bulkExport() {
    const ids = [...window._selectedStudents].join(',');
    window.open(`${API_BASE}/students/export?ids=${ids}`, '_blank');
}

function exportAllStudents() {
    window.open(`${API_BASE}/students/export`, '_blank');
}