// public/admin/js/subjects.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// SUBJECTS (unchanged)
// ============================================================
async function loadSubjects() {
    showLoading();
    try {
        const [subjectsRes, classesRes] = await Promise.all([
            apiCall('/subjects'),
            apiCall('/classes')
        ]);
        currentData = subjectsRes?.data || [];
        window._classes = classesRes?.data || [];
        renderSubjects();
    } catch (error) {
        showError('Failed to load subjects', error.message);
    }
}

function renderSubjects() {
    const classes = window._classes || [];
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📚 Subjects <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showAddSubjectModal()"><i class="fas fa-plus"></i> Add Subject</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">📚</span><strong>No Subjects</strong><p>Click "Add Subject" to create your first subject.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Name</th><th>Code</th><th>Class</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(s => {
                            const cls = classes.find(c => c._id === s.classId);
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(s.name)}</strong></td>
                                    <td>${escapeHtml(s.code)}</td>
                                    <td>${escapeHtml(cls?.displayName || 'N/A')}</td>
                                    <td><span class="status-badge ${s.isActive ? 'status-active' : 'status-inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                                    <td>
                                        <button class="btn btn-success btn-sm" onclick="editSubject('${s._id}')"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s._id}')"><i class="fas fa-trash"></i></button>
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

function showAddSubjectModal() {
    const classes = window._classes || [];
    editingId = null;
    showModal('Add Subject', 'Create a new subject', `
        <div class="form-group"><label>Subject Name *</label><input type="text" id="subjectName" placeholder="e.g., Mathematics"></div>
        <div class="form-group"><label>Subject Code *</label><input type="text" id="subjectCode" placeholder="e.g., MATH101"></div>
        <div class="form-group"><label>Class *</label>
            <select id="subjectClass"><option value="">Select Class</option>
                ${classes.filter(c => c.isActive).map(c => `<option value="${c._id}">${escapeHtml(c.displayName)}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Description</label><textarea id="subjectDescription" placeholder="Optional description"></textarea></div>
    `, async () => {
        const name = document.getElementById('subjectName').value.trim();
        const code = document.getElementById('subjectCode').value.trim();
        const classId = document.getElementById('subjectClass').value;
        const description = document.getElementById('subjectDescription').value.trim();
        if (!name || !code || !classId) { showToast('Error', 'Name, code, and class are required', 'error'); return; }
        const result = await apiCall('/subjects', { method: 'POST', body: JSON.stringify({ name, code, classId, description }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create subject', 'error'); return; }
        showToast('Success', 'Subject created', 'success');
        closeModal();
        loadSubjects();
    });
}

async function editSubject(id) {
    const item = currentData.find(s => s._id === id);
    if (!item) return;
    const classes = window._classes || [];
    showModal('Edit Subject', 'Update subject details', `
        <div class="form-group"><label>Subject Name *</label><input type="text" id="editSubjectName" value="${escapeHtml(item.name)}"></div>
        <div class="form-group"><label>Subject Code *</label><input type="text" id="editSubjectCode" value="${escapeHtml(item.code)}"></div>
        <div class="form-group"><label>Class *</label>
            <select id="editSubjectClass">${classes.filter(c => c.isActive).map(c => `<option value="${c._id}" ${c._id === item.classId ? 'selected' : ''}>${escapeHtml(c.displayName)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Description</label><textarea id="editSubjectDescription">${escapeHtml(item.description || '')}</textarea></div>
        <div class="form-group"><label><input type="checkbox" id="editSubjectActive" ${item.isActive ? 'checked' : ''}> Active</label></div>
    `, async () => {
        const name = document.getElementById('editSubjectName').value.trim();
        const code = document.getElementById('editSubjectCode').value.trim();
        const classId = document.getElementById('editSubjectClass').value;
        const description = document.getElementById('editSubjectDescription').value.trim();
        const isActive = document.getElementById('editSubjectActive').checked;
        if (!name || !code || !classId) { showToast('Error', 'Name, code, and class are required', 'error'); return; }
        const result = await apiCall(`/subjects/${id}`, { method: 'PUT', body: JSON.stringify({ name, code, classId, description, isActive }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update subject', 'error'); return; }
        showToast('Success', 'Subject updated', 'success');
        closeModal();
        loadSubjects();
    });
}

async function deleteSubject(id) {
    if (!confirm('Delete this subject?')) return;
    const result = await apiCall(`/subjects/${id}`, { method: 'DELETE' });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to delete subject', 'error');
        return;
    }
    showToast('Success', 'Subject deleted', 'success');
    loadSubjects();
}

