// public/admin/js/recruitment.js
//
// Faculty Recruitment (Careers/ATS) — admin side. Talks to
// routes/admin/recruitment.js (/api/admin/recruitment). The public
// application form lives at public/careers.html + routes/recruitment.js
// (no auth) — this file is the review/pipeline-management half.
//
// Reuses the existing slide-out detail panel (qpreview-panel/-backdrop/
// -tabs, already styled in dashboard.html for the Question Bank) instead
// of inventing a new panel component.

const STATUS_LABELS = {
    applied: 'Applied', screening: 'Screening', shortlisted: 'Shortlisted',
    interview_scheduled: 'Interview Scheduled', demo_class: 'Demo Class',
    selected: 'Selected', offer_sent: 'Offer Sent', joined: 'Joined', rejected: 'Rejected',
};
const STATUS_BADGE_CLASS = {
    applied: 'type-badge', screening: 'status-review', shortlisted: 'status-approved',
    interview_scheduled: 'priority-medium', demo_class: 'priority-medium',
    selected: 'status-published', offer_sent: 'status-published',
    joined: 'status-active', rejected: 'status-inactive',
};
const STATUS_ORDER = ['applied', 'screening', 'shortlisted', 'interview_scheduled', 'demo_class', 'selected', 'offer_sent', 'joined'];

let recruitmentFilters = { status: '', subject: '', qualification: '', experience: '', dateFrom: '', dateTo: '', search: '', positionId: '' };
let recruitmentDetailTab = 'overview';
let recruitmentView = 'applications'; // 'applications' | 'positions'

async function loadRecruitment() {
    showLoading();
    try {
        const [dashRes, listRes, posRes] = await Promise.all([
            apiCall('/recruitment/dashboard'),
            apiCall('/recruitment'),
            apiCall('/recruitment/positions'),
        ]);
        window._recruitmentStats = dashRes?.data || {};
        window._recruitmentList = listRes?.data || [];
        window._recruitmentPositions = posRes?.data || [];
        renderRecruitment();
    } catch (error) {
        showError('Failed to load recruitment data', error.message);
    }
}

async function reloadRecruitmentList() {
    const params = new URLSearchParams();
    Object.entries(recruitmentFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const res = await apiCall(`/recruitment?${params.toString()}`);
    window._recruitmentList = res?.data || [];
    renderRecruitmentTable();
}

function renderRecruitment() {
    const s = window._recruitmentStats || {};
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🧑‍🏫 Faculty Recruitment <span class="count">(${s.total || 0})</span></h2>
            <div style="display:flex;gap:8px;">
                <button class="btn ${recruitmentView === 'applications' ? 'btn-gold' : 'btn-secondary'} btn-sm" onclick="switchRecruitmentView('applications')"><i class="fas fa-users"></i> Applications</button>
                <button class="btn ${recruitmentView === 'positions' ? 'btn-gold' : 'btn-secondary'} btn-sm" onclick="switchRecruitmentView('positions')"><i class="fas fa-briefcase"></i> Job Positions</button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom:20px;">
            ${statCard('Total', s.total, 'acc-blue', 'fa-inbox')}
            ${statCard('New', s.applied, 'acc-orange', 'fa-star')}
            ${statCard('Shortlisted', s.shortlisted, 'acc-purple', 'fa-list-check')}
            ${statCard('Interview Scheduled', s.interviewScheduled, 'acc-blue', 'fa-calendar-check')}
            ${statCard('Demo Pending', s.demoPending, 'acc-orange', 'fa-chalkboard-teacher')}
            ${statCard('Selected', s.selected, 'acc-green', 'fa-thumbs-up')}
            ${statCard('Joined', s.joined, 'acc-green', 'fa-user-check')}
            ${statCard('Rejected', s.rejected, 'acc-purple', 'fa-user-xmark')}
        </div>

        <div id="recruitmentViewWrap"></div>
    `;
    renderRecruitmentView();
}

function switchRecruitmentView(view) {
    recruitmentView = view;
    renderRecruitment();
}

function renderRecruitmentView() {
    if (recruitmentView === 'positions') { renderPositionsView(); return; }

    const wrap = document.getElementById('recruitmentViewWrap');
    const positions = window._recruitmentPositions || [];
    wrap.innerHTML = `
        <div class="search-filter-bar" style="margin-bottom:14px;">
            <div class="search-field">
                <i class="fas fa-search"></i>
                <input type="text" id="rSearch" placeholder="Search name, phone, email..." value="${escapeHtml(recruitmentFilters.search)}" oninput="recruitmentFilters.search=this.value" onkeydown="if(event.key==='Enter') reloadRecruitmentList()">
            </div>
            <select id="rStatus" onchange="recruitmentFilters.status=this.value; reloadRecruitmentList()">
                <option value="">All Statuses</option>
                ${STATUS_ORDER.concat('rejected').map(st => `<option value="${st}" ${recruitmentFilters.status === st ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
            </select>
            <select id="rPosition" onchange="recruitmentFilters.positionId=this.value; reloadRecruitmentList()">
                <option value="">All Positions</option>
                ${positions.map(p => `<option value="${p._id}" ${recruitmentFilters.positionId === p._id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('')}
            </select>
            <input type="text" placeholder="Subject" value="${escapeHtml(recruitmentFilters.subject)}" oninput="recruitmentFilters.subject=this.value" onkeydown="if(event.key==='Enter') reloadRecruitmentList()">
            <input type="text" placeholder="Qualification" value="${escapeHtml(recruitmentFilters.qualification)}" oninput="recruitmentFilters.qualification=this.value" onkeydown="if(event.key==='Enter') reloadRecruitmentList()">
            <input type="text" placeholder="Experience" value="${escapeHtml(recruitmentFilters.experience)}" oninput="recruitmentFilters.experience=this.value" onkeydown="if(event.key==='Enter') reloadRecruitmentList()">
            <button class="btn btn-secondary btn-sm" onclick="reloadRecruitmentList()"><i class="fas fa-filter"></i> Apply</button>
        </div>

        <div id="recruitmentTableWrap"></div>
    `;
    renderRecruitmentTable();
}

function statCard(label, value, accent, icon) {
    return `
        <div class="stat-card ${accent}">
            <div class="stat-icon"><i class="fas ${icon}"></i></div>
            <div class="stat-value">${value || 0}</div>
            <div class="stat-label">${label}</div>
        </div>
    `;
}

function renderRecruitmentTable() {
    const list = window._recruitmentList || [];
    const wrap = document.getElementById('recruitmentTableWrap');
    if (!wrap) return;

    if (list.length === 0) {
        wrap.innerHTML = `<div class="empty-state"><span class="icon">🧑‍🏫</span><strong>No Applications</strong><p>Applications submitted from the Careers page will show up here.</p></div>`;
        return;
    }

    wrap.innerHTML = `
        <div class="table-container">
            <table>
                <thead><tr><th></th><th>Name</th><th>Position</th><th>Subject</th><th>Qualification</th><th>Experience</th><th>Phone</th><th>Applied</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                    ${list.map(a => `
                        <tr>
                            <td><div style="width:32px;height:32px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:12px;overflow:hidden;">${a.photo ? `<img src="/api/admin/recruitment/${a._id}/files/photo" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove()">` : '<i class="fas fa-user"></i>'}</div></td>
                            <td><strong>${escapeHtml(a.fullName)}</strong></td>
                            <td>${a.positionTitle ? escapeHtml(a.positionTitle) : '<span style="color:var(--muted);">—</span>'}</td>
                            <td>${escapeHtml(a.preferredSubjects || '—')}</td>
                            <td>${escapeHtml(a.qualification || '—')}</td>
                            <td>${escapeHtml(a.experience || '—')}</td>
                            <td>${escapeHtml(a.phone || '—')}</td>
                            <td>${a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}</td>
                            <td><span class="status-badge ${STATUS_BADGE_CLASS[a.status] || 'type-badge'}">${STATUS_LABELS[a.status] || a.status}</span></td>
                            <td><button class="btn btn-secondary btn-sm" onclick="viewCandidate('${a._id}')"><i class="fas fa-eye"></i> View</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ── Job Positions management ─────────────────────────────────────────────
function renderPositionsView() {
    const wrap = document.getElementById('recruitmentViewWrap');
    const positions = window._recruitmentPositions || [];
    wrap.innerHTML = `
        <div class="toolbar">
            <h2 style="font-size:16px;">Job Positions <span class="count">(${positions.length})</span></h2>
            <button class="btn btn-gold btn-sm" onclick="showAddPositionModal()"><i class="fas fa-plus"></i> Add Position</button>
        </div>
        ${positions.length === 0 ? `
            <div class="empty-state"><span class="icon">💼</span><strong>No Positions Yet</strong><p>Add a position so it shows up on the public Careers page and can be linked to applications.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Title</th><th>Qualification</th><th>Experience</th><th>Type</th><th>Applicants</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${positions.map(p => `
                            <tr>
                                <td><strong>${escapeHtml(p.title)}</strong></td>
                                <td>${escapeHtml(p.qualification || '—')}</td>
                                <td>${escapeHtml(p.experience || '—')}</td>
                                <td>${escapeHtml((p.employmentType || '').replace('_', ' ') || '—')}</td>
                                <td>${p.applicantCount || 0}</td>
                                <td><span class="status-badge ${p.status === 'open' ? 'status-active' : 'status-inactive'}">${p.status === 'open' ? 'Open' : 'Closed'}</span></td>
                                <td>
                                    <button class="btn btn-secondary btn-sm" onclick="showEditPositionModal('${p._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                    <button class="btn btn-sm" onclick="togglePositionStatus('${p._id}', '${p.status}')" title="${p.status === 'open' ? 'Close' : 'Reopen'}"><i class="fas fa-${p.status === 'open' ? 'lock' : 'lock-open'}"></i></button>
                                    <button class="btn btn-danger btn-sm" onclick="deletePosition('${p._id}')" title="Delete"><i class="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

function positionFormFields(p = {}) {
    return `
        <div class="form-group"><label>Title *</label><input type="text" id="posTitle" value="${escapeHtml(p.title || '')}" placeholder="e.g. Mathematics Teacher"></div>
        <div class="form-group"><label>Description</label><textarea id="posDescription" rows="3">${escapeHtml(p.description || '')}</textarea></div>
        <div class="form-row">
            <div class="form-group"><label>Qualification</label><input type="text" id="posQualification" value="${escapeHtml(p.qualification || '')}"></div>
            <div class="form-group"><label>Experience</label><input type="text" id="posExperience" value="${escapeHtml(p.experience || '')}" placeholder="e.g. 2+ years"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Employment Type</label>
                <select id="posEmploymentType">
                    <option value="">Select</option>
                    <option value="full_time" ${p.employmentType === 'full_time' ? 'selected' : ''}>Full Time</option>
                    <option value="part_time" ${p.employmentType === 'part_time' ? 'selected' : ''}>Part Time</option>
                    <option value="online" ${p.employmentType === 'online' ? 'selected' : ''}>Online</option>
                    <option value="offline" ${p.employmentType === 'offline' ? 'selected' : ''}>Offline</option>
                    <option value="hybrid" ${p.employmentType === 'hybrid' ? 'selected' : ''}>Hybrid</option>
                </select>
            </div>
            <div class="form-group"><label>Salary (optional)</label><input type="text" id="posSalary" value="${escapeHtml(p.salary || '')}" placeholder="e.g. ₹25,000-35,000/month"></div>
        </div>
        <div class="form-group"><label>Status</label>
            <select id="posStatus">
                <option value="open" ${(p.status || 'open') === 'open' ? 'selected' : ''}>Open</option>
                <option value="closed" ${p.status === 'closed' ? 'selected' : ''}>Closed</option>
            </select>
        </div>
    `;
}

function readPositionForm() {
    return {
        title: document.getElementById('posTitle').value.trim(),
        description: document.getElementById('posDescription').value.trim(),
        qualification: document.getElementById('posQualification').value.trim(),
        experience: document.getElementById('posExperience').value.trim(),
        employmentType: document.getElementById('posEmploymentType').value,
        salary: document.getElementById('posSalary').value.trim(),
        status: document.getElementById('posStatus').value,
    };
}

function showAddPositionModal() {
    showModal('Add Position', 'Publish a new opening on the Careers page', positionFormFields(), async () => {
        const body = readPositionForm();
        if (!body.title) { showToast('Error', 'Position title is required', 'error'); return; }
        const result = await apiCall('/recruitment/positions', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create position', 'error'); return; }
        showToast('Success', 'Position created', 'success');
        closeModal();
        await loadRecruitment();
        recruitmentView = 'positions';
        renderRecruitmentView();
    });
}

function showEditPositionModal(id) {
    const p = (window._recruitmentPositions || []).find(x => x._id === id);
    if (!p) return;
    showModal('Edit Position', `Update "${p.title}"`, positionFormFields(p), async () => {
        const body = readPositionForm();
        if (!body.title) { showToast('Error', 'Position title is required', 'error'); return; }
        const result = await apiCall(`/recruitment/positions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update position', 'error'); return; }
        showToast('Success', 'Position updated', 'success');
        closeModal();
        await loadRecruitment();
        recruitmentView = 'positions';
        renderRecruitmentView();
    });
}

async function togglePositionStatus(id, currentStatus) {
    const nextStatus = currentStatus === 'open' ? 'closed' : 'open';
    const result = await apiCall(`/recruitment/positions/${id}`, { method: 'PUT', body: JSON.stringify({ status: nextStatus, title: (window._recruitmentPositions.find(p => p._id === id) || {}).title }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update position', 'error'); return; }
    showToast('Success', nextStatus === 'closed' ? 'Position closed' : 'Position reopened', 'success');
    await loadRecruitment();
    recruitmentView = 'positions';
    renderRecruitmentView();
}

async function deletePosition(id) {
    const p = (window._recruitmentPositions || []).find(x => x._id === id);
    if (!confirm(`Delete "${p?.title || 'this position'}"? This can't be undone (existing applications keep their history, they just won't show a linked position anymore).`)) return;
    const result = await apiCall(`/recruitment/positions/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete position', 'error'); return; }
    showToast('Success', 'Position deleted', 'success');
    await loadRecruitment();
    recruitmentView = 'positions';
    renderRecruitmentView();
}

// ── Candidate detail panel ──────────────────────────────────────────────
async function viewCandidate(id) {
    const res = await apiCall(`/recruitment/${id}`);
    if (!res || !res.success) { showToast('Error', res?.message || 'Failed to load candidate', 'error'); return; }
    window._recruitmentCandidate = res.data;
    recruitmentDetailTab = 'overview';
    renderCandidatePanel();
}

function closeCandidatePanel() {
    document.getElementById('rPreviewBackdrop')?.remove();
    document.getElementById('rPreviewPanel')?.remove();
}

function switchCandidateTab(tab) {
    recruitmentDetailTab = tab;
    renderCandidatePanel();
}

function renderCandidatePanel() {
    closeCandidatePanel();
    const a = window._recruitmentCandidate;
    if (!a) return;

    const tabs = ['overview', 'documents', 'notes', 'interview', 'demo', 'timeline'];
    const tabLabels = { overview: 'Overview', documents: 'Documents', notes: `Notes (${(a.adminNotes || []).length})`, interview: 'Interview', demo: 'Demo Class', timeline: 'Timeline' };

    const body = document.createElement('div');
    body.innerHTML = `
        <div id="rPreviewBackdrop" class="qpreview-backdrop open" onclick="closeCandidatePanel()"></div>
        <div id="rPreviewPanel" class="qpreview-panel open">
            <div class="qpreview-header">
                <h3>${escapeHtml(a.fullName)}</h3>
                <button class="btn btn-secondary btn-sm" onclick="closeCandidatePanel()"><i class="fas fa-times"></i></button>
            </div>
            <div class="qpreview-tabs">
                ${tabs.map(t => `<button class="qpreview-tab ${recruitmentDetailTab === t ? 'active' : ''}" onclick="switchCandidateTab('${t}')">${tabLabels[t]}</button>`).join('')}
            </div>
            <div class="qpreview-body">
                ${recruitmentDetailTab === 'overview' ? overviewTab(a) : ''}
                ${recruitmentDetailTab === 'documents' ? documentsTab(a) : ''}
                ${recruitmentDetailTab === 'notes' ? notesTab(a) : ''}
                ${recruitmentDetailTab === 'interview' ? interviewTab(a) : ''}
                ${recruitmentDetailTab === 'demo' ? demoTab(a) : ''}
                ${recruitmentDetailTab === 'timeline' ? timelineTab(a) : ''}
            </div>
        </div>
    `;
    document.body.appendChild(body);
}

function field(label, value) {
    if (!value) return '';
    return `<div style="margin-bottom:10px;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">${label}</div><div style="font-size:14px;color:var(--text);">${escapeHtml(String(value))}</div></div>`;
}

function overviewTab(a) {
    return `
        <div class="form-group">
            <label>Status</label>
            <select id="rStatusSelect" onchange="changeCandidateStatus('${a._id}', this.value)">
                ${STATUS_ORDER.concat('rejected').map(st => `<option value="${st}" ${a.status === st ? 'selected' : ''}>${STATUS_LABELS[st]}</option>`).join('')}
            </select>
        </div>
        ${field('Phone', a.phone)}
        ${field('WhatsApp', a.whatsapp)}
        ${field('Email', a.email)}
        ${field('Gender', a.gender)}
        ${field('Date of Birth', a.dob)}
        ${field('Address', [a.address, a.city, a.state, a.pin].filter(Boolean).join(', '))}
        <hr style="border-color:var(--card-border);margin:14px 0;">
        ${field('Qualification', a.qualification)}
        ${field('College', a.college)}
        ${field('University', a.university)}
        ${field('Passing Year', a.passingYear)}
        ${field('Percentage', a.percentage)}
        <hr style="border-color:var(--card-border);margin:14px 0;">
        ${field('Experience', a.experience)}
        ${field('Current Institute', a.currentInstitute)}
        ${field('Preferred Subjects', a.preferredSubjects)}
        ${field('Preferred Classes', a.preferredClasses)}
        ${field('Preferred Boards', a.preferredBoards)}
        ${field('Employment Type', a.employmentType)}
        ${field('Expected Salary', a.expectedSalary)}
        ${field('Joining Date', a.joiningDate)}
        ${(a.skills || []).length ? field('Skills', a.skills.join(', ')) : ''}
    `;
}

function documentsTab(a) {
    const base = `/api/admin/recruitment/${a._id}/files`;
    return `
        ${a.resume ? `<p style="margin-bottom:10px;"><a href="${base}/resume" target="_blank" class="btn btn-secondary btn-sm"><i class="fas fa-file-pdf"></i> Resume</a></p>` : '<p style="color:var(--muted);">No resume.</p>'}
        ${a.photo ? `<p style="margin-bottom:10px;"><a href="${base}/photo" target="_blank" class="btn btn-secondary btn-sm"><i class="fas fa-image"></i> Photo</a></p>` : ''}
        ${a.demoVideo ? `<p style="margin-bottom:10px;"><a href="${base}/demoVideo" target="_blank" class="btn btn-secondary btn-sm"><i class="fas fa-video"></i> Demo Video</a></p>` : ''}
        ${(a.certificates || []).length ? `<div style="margin-top:10px;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Certificates</div>${a.certificates.map((c, i) => `<p style="margin-bottom:8px;"><a href="${base}/certificate?index=${i}" target="_blank" class="btn btn-secondary btn-sm"><i class="fas fa-certificate"></i> ${escapeHtml(c.originalName || `Certificate ${i + 1}`)}</a></p>`).join('')}</div>` : ''}
    `;
}

function notesTab(a) {
    return `
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">
            ${(a.adminNotes || []).length === 0 ? '<p style="color:var(--muted);">No notes yet.</p>' : a.adminNotes.slice().reverse().map(n => `
                <div class="doubt-reply-bubble" style="align-self:stretch;max-width:100%;">
                    <div>${escapeHtml(n.text)}</div>
                    <div class="doubt-reply-meta">${escapeHtml(n.by || 'Admin')} — ${new Date(n.at).toLocaleString()}</div>
                </div>
            `).join('')}
        </div>
        <div class="doubt-reply-form">
            <textarea id="rNoteText" rows="2" placeholder="Add an internal note (never shown to the candidate)..."></textarea>
            <button class="btn btn-gold btn-sm" onclick="addCandidateNote('${a._id}')"><i class="fas fa-paper-plane"></i></button>
        </div>
    `;
}

function interviewTab(a) {
    const iv = a.interview || {};
    return `
        <div class="form-group"><label>Date *</label><input type="date" id="rIvDate" value="${iv.date || ''}"></div>
        <div class="form-group"><label>Time</label><input type="text" id="rIvTime" placeholder="e.g. 4:00 PM" value="${escapeHtml(iv.time || '')}"></div>
        <div class="form-group"><label>Interviewer</label><input type="text" id="rIvInterviewer" value="${escapeHtml(iv.interviewer || '')}"></div>
        <div class="form-group"><label>Meeting Link</label><input type="text" id="rIvLink" placeholder="Optional (Google Meet, Zoom...)" value="${escapeHtml(iv.meetingLink || '')}"></div>
        <div class="form-group"><label>Remarks</label><textarea id="rIvRemarks" rows="3">${escapeHtml(iv.remarks || '')}</textarea></div>
        <button class="btn btn-gold btn-sm" onclick="saveInterview('${a._id}')"><i class="fas fa-calendar-check"></i> ${iv.date ? 'Update' : 'Schedule'} Interview</button>
    `;
}

function demoTab(a) {
    const d = a.demoEvaluation || {};
    const scoreField = (id, label, val) => `<div class="form-group"><label>${label} (0-10)</label><input type="number" id="${id}" min="0" max="10" step="0.5" value="${val ?? ''}"></div>`;
    return `
        <div class="form-group"><label>Topic</label><input type="text" id="rDemoTopic" value="${escapeHtml(d.topic || '')}"></div>
        <div class="form-row">
            <div class="form-group"><label>Class</label><input type="text" id="rDemoClass" value="${escapeHtml(d.class || '')}"></div>
            <div class="form-group"><label>Duration</label><input type="text" id="rDemoDuration" placeholder="e.g. 20 min" value="${escapeHtml(d.duration || '')}"></div>
        </div>
        ${scoreField('rDemoSubject', 'Subject Knowledge', d.subjectKnowledge)}
        ${scoreField('rDemoComm', 'Communication', d.communication)}
        ${scoreField('rDemoConf', 'Confidence', d.confidence)}
        ${scoreField('rDemoClassroom', 'Classroom Handling', d.classroomHandling)}
        ${scoreField('rDemoStudent', 'Student Interaction', d.studentInteraction)}
        ${scoreField('rDemoBoard', 'Board Work', d.boardWork)}
        ${scoreField('rDemoOverall', 'Overall Rating', d.overallRating)}
        <button class="btn btn-gold btn-sm" onclick="saveDemoEvaluation('${a._id}')"><i class="fas fa-chalkboard-teacher"></i> Save Evaluation</button>
        ${d.evaluatedBy ? `<p style="color:var(--muted);font-size:12px;margin-top:10px;">Last evaluated by ${escapeHtml(d.evaluatedBy)} on ${new Date(d.evaluatedAt).toLocaleString()}</p>` : ''}
    `;
}

function timelineTab(a) {
    const history = a.statusHistory || [];
    if (history.length === 0) return '<p style="color:var(--muted);">No history yet.</p>';
    return `
        <div style="display:flex;flex-direction:column;gap:0;">
            ${history.slice().reverse().map((h, i) => `
                <div class="activity-item">
                    <div class="activity-icon"><i class="fas fa-circle" style="font-size:8px;"></i></div>
                    <div class="activity-body">
                        <div class="activity-title">${STATUS_LABELS[h.status] || h.status}</div>
                        <div class="activity-sub">${h.by ? `by ${escapeHtml(h.by)}` : 'System'}</div>
                    </div>
                    <div class="activity-time">${new Date(h.at).toLocaleString()}</div>
                </div>
            `).join('')}
        </div>
    `;
}

async function changeCandidateStatus(id, status) {
    const result = await apiCall(`/recruitment/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update status', 'error'); return; }
    showToast('Success', 'Status updated', 'success');
    window._recruitmentCandidate = result.data;
    await loadRecruitment();
    renderCandidatePanel();
}

async function addCandidateNote(id) {
    const text = document.getElementById('rNoteText').value.trim();
    if (!text) return;
    const result = await apiCall(`/recruitment/${id}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add note', 'error'); return; }
    window._recruitmentCandidate = result.data;
    renderCandidatePanel();
}

async function saveInterview(id) {
    const date = document.getElementById('rIvDate').value;
    if (!date) { showToast('Error', 'Interview date is required', 'error'); return; }
    const body = {
        date,
        time: document.getElementById('rIvTime').value.trim(),
        interviewer: document.getElementById('rIvInterviewer').value.trim(),
        meetingLink: document.getElementById('rIvLink').value.trim(),
        remarks: document.getElementById('rIvRemarks').value.trim(),
    };
    const result = await apiCall(`/recruitment/${id}/interview`, { method: 'PUT', body: JSON.stringify(body) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save interview', 'error'); return; }
    showToast('Success', 'Interview saved', 'success');
    window._recruitmentCandidate = result.data;
    await loadRecruitment();
    renderCandidatePanel();
}

async function saveDemoEvaluation(id) {
    const num = elId => { const v = document.getElementById(elId).value; return v === '' ? null : Number(v); };
    const body = {
        topic: document.getElementById('rDemoTopic').value.trim(),
        class: document.getElementById('rDemoClass').value.trim(),
        duration: document.getElementById('rDemoDuration').value.trim(),
        subjectKnowledge: num('rDemoSubject'), communication: num('rDemoComm'),
        confidence: num('rDemoConf'), classroomHandling: num('rDemoClassroom'),
        studentInteraction: num('rDemoStudent'), boardWork: num('rDemoBoard'), overallRating: num('rDemoOverall'),
    };
    const result = await apiCall(`/recruitment/${id}/demo-evaluation`, { method: 'PUT', body: JSON.stringify(body) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save evaluation', 'error'); return; }
    showToast('Success', 'Demo evaluation saved', 'success');
    window._recruitmentCandidate = result.data;
    await loadRecruitment();
    renderCandidatePanel();
}