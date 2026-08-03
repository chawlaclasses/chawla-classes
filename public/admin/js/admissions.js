// public/admin/js/admissions.js
//
// Admissions — kept as its own module, separate from Enquiries
// (public/admin/js/enquiries.js). Talks to routes/admin/admissions.js
// (/api/admin/admissions). Public submission is index.html's "Admission
// Form" → routes/publicEnquiry.js (POST /api/enquiry/admission, no auth).

async function loadAdmissions() {
    showLoading();
    try {
        const response = await apiCall('/admissions');
        window._admissions = response?.data || [];
        renderAdmissions();
    } catch (error) {
        showError('Failed to load admissions', error.message);
    }
}

function renderAdmissions() {
    const list = window._admissions || [];
    const statusStyle = {
        new: { bg: 'rgba(239,68,68,0.12)', fg: '#dc2626' },
        contacted: { bg: 'rgba(79,110,247,0.12)', fg: 'var(--acc-blue)' },
        admitted: { bg: 'rgba(34,197,94,0.12)', fg: '#16a34a' },
        rejected: { bg: 'var(--surface)', fg: 'var(--muted)' },
    };

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🎓 Admissions <span class="count">(${list.length})</span></h2>
            ${hasPermission('admissions:create') ? `<button class="btn btn-gold" onclick="showAddAdmissionModal()"><i class="fas fa-plus"></i> Log Admission Enquiry</button>` : ''}
        </div>
        ${list.length === 0 ? `
            <div class="empty-state"><span class="icon">🎓</span><strong>No Admission Enquiries</strong><p>Submissions from the website's Admission Form show up here, or log a walk-in with the button above.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Student</th><th>Parent</th><th>Phone</th><th>Class</th><th>School</th><th>Source</th><th>Status</th><th>Applied</th></tr></thead>
                    <tbody>
                        ${list.map(a => { const s = statusStyle[a.status] || statusStyle.new; return `
                            <tr>
                                <td><strong>${escapeHtml(a.studentName)}</strong></td>
                                <td>${escapeHtml(a.parentName || '—')}</td>
                                <td>${escapeHtml(a.phone)}</td>
                                <td>${escapeHtml(a.interestedClass || '—')}</td>
                                <td>${escapeHtml(a.school || '—')}</td>
                                <td>${escapeHtml(a.source || '—')}</td>
                                <td>
                                    ${hasPermission('admissions:edit') ? `
                                    <select onchange="updateAdmissionStatus('${a._id}', this.value)" style="background:${s.bg};color:${s.fg};border:none;border-radius:6px;padding:4px 8px;font-size:12px;">
                                        <option value="new" ${a.status === 'new' ? 'selected' : ''}>New</option>
                                        <option value="contacted" ${a.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                                        <option value="admitted" ${a.status === 'admitted' ? 'selected' : ''}>Admitted</option>
                                        <option value="rejected" ${a.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                                    </select>
                                    ` : `<span class="status-badge" style="background:${s.bg};color:${s.fg};">${a.status}</span>`}
                                </td>
                                <td>${new Date(a.createdAt).toLocaleDateString()}</td>
                            </tr>
                        `; }).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

async function updateAdmissionStatus(id, status) {
    const result = await apiCall(`/admissions/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update admission', 'error'); return; }
    showToast('Success', 'Status updated', 'success');
    loadAdmissions();
}

function showAddAdmissionModal() {
    showModal('Log Admission Enquiry', 'For a walk-in or phone admission enquiry', `
        <div class="form-group"><label>Student Name *</label><input type="text" id="admStudentName" placeholder="Full name"></div>
        <div class="form-group"><label>Parent/Guardian Name *</label><input type="text" id="admParentName"></div>
        <div class="form-group"><label>Mobile *</label><input type="tel" id="admPhone"></div>
        <div class="form-group"><label>Email</label><input type="email" id="admEmail"></div>
        <div class="form-group"><label>School</label><input type="text" id="admSchool"></div>
        <div class="form-group"><label>Interested Class *</label><input type="text" id="admClass" placeholder="e.g. 10th Class"></div>
        <div class="form-group"><label>Address</label><textarea id="admAddress" rows="2"></textarea></div>
    `, async () => {
        const studentName = document.getElementById('admStudentName').value.trim();
        const parentName = document.getElementById('admParentName').value.trim();
        const phone = document.getElementById('admPhone').value.trim();
        const interestedClass = document.getElementById('admClass').value.trim();
        if (!studentName || !parentName || !phone || !interestedClass) {
            showToast('Error', 'Student name, parent name, mobile, and class are required', 'error');
            return;
        }
        const body = {
            studentName, parentName, phone, interestedClass,
            email: document.getElementById('admEmail').value.trim(),
            school: document.getElementById('admSchool').value.trim(),
            address: document.getElementById('admAddress').value.trim(),
        };
        const result = await apiCall('/admissions', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to log admission', 'error'); return; }
        showToast('Success', 'Admission enquiry logged', 'success');
        closeModal();
        loadAdmissions();
    });
}