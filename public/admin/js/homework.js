// public/admin/js/homework.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ============================================================

async function loadHomework() {
    showLoading();
    try {
        const [hwRes, subjectsRes, classesRes] = await Promise.all([
            apiCall('/homework'),
            apiCall('/subjects'),
            apiCall('/classes'),
        ]);
        currentData = hwRes?.data || [];
        window._subjects = subjectsRes?.data || [];
        window._classes = classesRes?.data || [];
        renderHomework();
    } catch (error) {
        showError('Failed to load homework', error.message);
    }
}

function homeworkClassSubjectLabel(hw) {
    const cls = (window._classes || []).find(c => c._id === hw.classId);
    const subj = (window._subjects || []).find(s => s._id === hw.subjectId);
    return `${escapeHtml(cls?.displayName || cls?.name || 'N/A')} · ${escapeHtml(subj?.name || 'N/A')}`;
}

function renderHomework() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📚 Homework <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showHomeworkModal()"><i class="fas fa-plus"></i> Create Homework</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">📚</span><strong>No Homework Yet</strong><p>Click "Create Homework" to assign your first homework.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Title</th><th>Class / Subject</th><th>Due Date</th><th>Marks</th><th>Submissions</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(hw => {
                            const overdue = new Date() > new Date(hw.dueDate);
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(hw.title)}</strong>${hw.attachmentFilename ? ' <i class="fas fa-paperclip" style="color:var(--muted);" title="Has attachment"></i>' : ''}</td>
                                    <td>${homeworkClassSubjectLabel(hw)}</td>
                                    <td>${new Date(hw.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${overdue ? ' <span style="color:#dc2626;font-size:11px;">(overdue)</span>' : ''}</td>
                                    <td>${hw.marks}</td>
                                    <td>${hw.submissionCount} <span style="color:var(--muted);font-size:11px;">(${hw.gradedCount} graded)</span></td>
                                    <td><span class="status-badge ${hw.isPublished ? 'status-published' : 'status-draft'}">${hw.isPublished ? 'Published' : 'Draft'}</span></td>
                                    <td>
                                        <button class="btn btn-gold btn-sm" onclick="openHomeworkSubmissions('${hw._id}')"><i class="fas fa-inbox"></i> Submissions</button>
                                        <button class="btn btn-secondary btn-sm" onclick="showHomeworkModal('${hw._id}')"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-success btn-sm" onclick="toggleHomeworkPublish('${hw._id}')"><i class="fas fa-${hw.isPublished ? 'eye-slash' : 'upload'}"></i></button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteHomework('${hw._id}')"><i class="fas fa-trash"></i></button>
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

function showHomeworkModal(id) {
    const subjects = (window._subjects || []).filter(s => s.isActive);
    const editing = id ? currentData.find(h => h._id === id) : null;

    showModal(editing ? 'Edit Homework' : 'Create Homework', editing ? 'Update this assignment' : 'Assign new homework to a class', `
        <div class="form-group"><label>Title *</label><input type="text" id="hwTitle" placeholder="e.g., Algebra Worksheet 3" value="${editing ? escapeHtml(editing.title) : ''}"></div>
        <div class="form-group"><label>Subject (Class) *</label>
            <select id="hwSubject" ${editing ? 'disabled' : ''}>
                <option value="">Select Subject</option>
                ${subjects.map(s => {
                    const cls = (window._classes || []).find(c => c._id === s.classId);
                    return `<option value="${s._id}" ${editing?.subjectId === s._id ? 'selected' : ''}>${escapeHtml(s.name)} — ${escapeHtml(cls?.displayName || cls?.name || '')}</option>`;
                }).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Due Date *</label><input type="date" id="hwDueDate" value="${editing ? new Date(editing.dueDate).toISOString().slice(0,10) : ''}"></div>
            <div class="form-group"><label>Marks *</label><input type="number" id="hwMarks" value="${editing ? editing.marks : 10}" min="1"></div>
        </div>
        <div class="form-group"><label>Description / Instructions</label><textarea id="hwDescription" placeholder="What should students do?">${editing ? escapeHtml(editing.description || '') : ''}</textarea></div>
        <div class="form-group">
            <label>Attach PDF / Image ${editing?.attachmentOriginalName ? `(current: ${escapeHtml(editing.attachmentOriginalName)})` : '(optional)'}</label>
            <input type="file" id="hwAttachment" accept=".pdf,.png,.jpg,.jpeg">
        </div>
    `, async () => {
        const title = document.getElementById('hwTitle').value.trim();
        const subjectId = editing ? editing.subjectId : document.getElementById('hwSubject').value;
        const dueDate = document.getElementById('hwDueDate').value;
        const marks = document.getElementById('hwMarks').value;
        const description = document.getElementById('hwDescription').value.trim();
        const fileInput = document.getElementById('hwAttachment');

        if (!title || !subjectId || !dueDate || !marks) {
            showToast('Error', 'Title, subject, due date and marks are required', 'error'); return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        formData.append('dueDate', dueDate);
        formData.append('marks', marks);
        if (fileInput.files[0]) formData.append('attachment', fileInput.files[0]);

        let result;
        if (editing) {
            result = await apiCall(`/homework/${editing._id}`, {
                method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }, body: formData
            });
        } else {
            const subject = subjects.find(s => s._id === subjectId);
            formData.append('subjectId', subjectId);
            formData.append('classId', subject.classId);
            result = await apiCall('/homework', {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData
            });
        }

        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save homework', 'error'); return; }
        showToast('Success', editing ? 'Homework updated' : 'Homework created', 'success');
        closeModal();
        loadHomework();
    });
}

async function toggleHomeworkPublish(id) {
    const hw = currentData.find(h => h._id === id);
    if (!hw) return;
    const action = hw.isPublished ? 'unpublish' : 'publish';
    const result = await apiCall(`/homework/${id}/${action}`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || `Failed to ${action} homework`, 'error'); return; }
    showToast('Success', `Homework ${action}ed`, 'success');
    loadHomework();
}

async function deleteHomework(id) {
    if (!confirm('Delete this homework? Student submissions will no longer be visible to them.')) return;
    const result = await apiCall(`/homework/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete homework', 'error'); return; }
    showToast('Success', 'Homework deleted', 'success');
    loadHomework();
}

let currentHomeworkForSubmissions = null;

async function openHomeworkSubmissions(id) {
    showLoading();
    try {
        const result = await apiCall(`/homework/${id}/submissions`);
        if (!result || !result.success) { showError('Failed to load submissions', result?.message || ''); return; }
        currentHomeworkForSubmissions = result.data;
        renderHomeworkSubmissions();
    } catch (error) {
        showError('Failed to load submissions', error.message);
    }
}

function renderHomeworkSubmissions() {
    const { homework, roster } = currentHomeworkForSubmissions;
    contentArea.innerHTML = `
        <div class="toolbar">
            <div>
                <button class="btn btn-secondary btn-sm" onclick="loadHomework()"><i class="fas fa-arrow-left"></i> Back to Homework</button>
                <h2 style="margin-top:8px;">📥 ${escapeHtml(homework.title)} — Submissions</h2>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Student</th><th>Roll No</th><th>Status</th><th>Submitted</th><th>Marks</th><th>Remarks</th><th>Actions</th></tr></thead>
                <tbody>
                    ${roster.map(r => {
                        const sub = r.submission;
                        const statusLabel = !sub ? (new Date() > new Date(homework.dueDate) ? 'Not Submitted (overdue)' : 'Not Submitted')
                            : sub.status === 'graded' ? 'Graded' : (sub.isLate ? 'Submitted Late' : 'Submitted');
                        const statusClass = !sub ? 'status-draft' : sub.status === 'graded' ? 'status-published' : 'status-draft';
                        return `
                            <tr>
                                <td>${escapeHtml(r.studentName)}</td>
                                <td>${escapeHtml(r.rollNumber || '-')}</td>
                                <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                                <td>${sub ? new Date(sub.submittedAt).toLocaleString('en-IN') : '-'}</td>
                                <td>${sub && sub.marksAwarded !== null && sub.marksAwarded !== undefined ? `${sub.marksAwarded} / ${homework.marks}` : '-'}</td>
                                <td>${sub && sub.teacherRemarks ? escapeHtml(sub.teacherRemarks) : '-'}</td>
                                <td>
                                    ${sub ? `<button class="btn btn-secondary btn-sm" onclick="downloadHomeworkSubmission('${sub._id}')"><i class="fas fa-download"></i></button>` : ''}
                                    ${sub ? `<button class="btn btn-gold btn-sm" onclick="gradeSubmissionModal('${sub._id}')"><i class="fas fa-check"></i> Grade</button>` : ''}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function downloadHomeworkSubmission(submissionId) {
    fetch(`${API_BASE}/homework/submissions/${submissionId}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
    })
    .catch(() => showToast('Error', 'Failed to download submission', 'error'));
}

function gradeSubmissionModal(submissionId) {
    const roster = currentHomeworkForSubmissions.roster;
    const entry = roster.find(r => r.submission && r.submission._id === submissionId);
    if (!entry) return;
    const sub = entry.submission;
    const maxMarks = currentHomeworkForSubmissions.homework.marks;

    showModal('Grade Submission', `${escapeHtml(entry.studentName)} — out of ${maxMarks} marks`, `
        <div class="form-group"><label>Marks Awarded *</label><input type="number" id="gradeMarks" min="0" max="${maxMarks}" value="${sub.marksAwarded !== null && sub.marksAwarded !== undefined ? sub.marksAwarded : ''}"></div>
        <div class="form-group"><label>Teacher Remarks</label><textarea id="gradeRemarks" placeholder="Feedback for the student">${escapeHtml(sub.teacherRemarks || '')}</textarea></div>
    `, async () => {
        const marksAwarded = document.getElementById('gradeMarks').value;
        const teacherRemarks = document.getElementById('gradeRemarks').value.trim();
        if (marksAwarded === '' || Number(marksAwarded) > maxMarks || Number(marksAwarded) < 0) {
            showToast('Error', `Marks must be between 0 and ${maxMarks}`, 'error'); return;
        }
        const result = await apiCall(`/homework/submissions/${submissionId}/grade`, {
            method: 'PUT', body: JSON.stringify({ marksAwarded: Number(marksAwarded), teacherRemarks })
        });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save grade', 'error'); return; }
        showToast('Success', 'Submission graded', 'success');
        closeModal();
        openHomeworkSubmissions(currentHomeworkForSubmissions.homework._id);
    });
}


// ============================================================
// ============================================================
// DOUBT MANAGEMENT (Admin)