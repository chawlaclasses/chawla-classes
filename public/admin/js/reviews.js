// public/admin/js/reviews.js
//
// Review Management — admin side. Talks to routes/admin/reviews.js
// (/api/admin/reviews). Public submission is index.html's "Student
// Feedback & Rating" form + the "Student Reviews" section →
// routes/reviews.js (no auth, GET /approved / POST /). This file is the
// moderation half: approve/reject what came in from the website, edit,
// feature, or add a review directly.

const REVIEW_STATUS_BADGE = {
    pending: 'status-review',
    approved: 'status-active',
    rejected: 'status-inactive',
};

let reviewsStatusFilter = ''; // '' = all

function reviewStars(rating) {
    const n = Math.max(0, Math.min(5, Number(rating) || 0));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
}

async function loadReviews() {
    showLoading();
    try {
        const [dashRes, listRes] = await Promise.all([
            apiCall('/reviews/dashboard'),
            apiCall(`/reviews${reviewsStatusFilter ? `?status=${reviewsStatusFilter}` : ''}`),
        ]);
        window._reviewsStats = dashRes?.data || {};
        window._reviewsList = listRes?.data || [];
        renderReviews();
    } catch (error) {
        showError('Failed to load reviews', error.message);
    }
}

async function reloadReviewsList() {
    const res = await apiCall(`/reviews${reviewsStatusFilter ? `?status=${reviewsStatusFilter}` : ''}`);
    window._reviewsList = res?.data || [];
    renderReviewsTable();
}

function switchReviewsFilter(status) {
    reviewsStatusFilter = status;
    reloadReviewsList();
    document.querySelectorAll('.reviews-filter-btn').forEach(btn => {
        btn.classList.toggle('btn-gold', btn.dataset.status === status);
        btn.classList.toggle('btn-secondary', btn.dataset.status !== status);
    });
}

function renderReviews() {
    const s = window._reviewsStats || {};
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>⭐ Reviews <span class="count">(${s.total || 0})</span></h2>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-secondary" onclick="showReviewVerificationsModal()"><i class="fas fa-shield-alt"></i> Verifications</button>
                ${hasPermission('reviews:edit') ? `<button class="btn btn-gold" onclick="showAddReviewModal()"><i class="fas fa-plus"></i> Add Review</button>` : ''}
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom:20px;">
            ${statCard('Total', s.total, 'acc-blue', 'fa-star')}
            ${statCard('Pending', s.pending, 'acc-orange', 'fa-hourglass-half')}
            ${statCard('Approved', s.approved, 'acc-green', 'fa-check-circle')}
            ${statCard('Rejected', s.rejected, 'acc-purple', 'fa-times-circle')}
            ${statCard('Avg Rating', s.avgRating, 'acc-blue', 'fa-chart-line')}
        </div>

        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            <button class="reviews-filter-btn btn ${reviewsStatusFilter === '' ? 'btn-gold' : 'btn-secondary'} btn-sm" data-status="" onclick="switchReviewsFilter('')">All</button>
            <button class="reviews-filter-btn btn ${reviewsStatusFilter === 'pending' ? 'btn-gold' : 'btn-secondary'} btn-sm" data-status="pending" onclick="switchReviewsFilter('pending')">Pending</button>
            <button class="reviews-filter-btn btn ${reviewsStatusFilter === 'approved' ? 'btn-gold' : 'btn-secondary'} btn-sm" data-status="approved" onclick="switchReviewsFilter('approved')">Approved</button>
            <button class="reviews-filter-btn btn ${reviewsStatusFilter === 'rejected' ? 'btn-gold' : 'btn-secondary'} btn-sm" data-status="rejected" onclick="switchReviewsFilter('rejected')">Rejected</button>
            <button class="reviews-filter-btn btn ${reviewsStatusFilter === 'deleted' ? 'btn-gold' : 'btn-secondary'} btn-sm" data-status="deleted" onclick="switchReviewsFilter('deleted')" style="margin-left:auto;"><i class="fas fa-trash"></i> Trash</button>
        </div>

        <div id="reviewsTableWrap"></div>
    `;
    renderReviewsTable();
}

function renderReviewsTable() {
    const list = window._reviewsList || [];
    const wrap = document.getElementById('reviewsTableWrap');
    if (!wrap) return;

    if (list.length === 0) {
        const trashView = reviewsStatusFilter === 'deleted';
        wrap.innerHTML = trashView
            ? `<div class="empty-state"><span class="icon">🗑️</span><strong>Trash is empty</strong><p>Deleted reviews will show up here and can be restored.</p></div>`
            : `<div class="empty-state"><span class="icon">⭐</span><strong>No Reviews</strong><p>Reviews submitted from the website's Feedback form will show up here.</p></div>`;
        return;
    }

    wrap.innerHTML = `
        <div class="table-container">
            <table>
                <thead><tr><th>Student</th><th>Class</th><th>Email / Mobile</th><th>Rating</th><th>Feedback</th><th>Source</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
                <tbody>
                    ${list.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.studentName)}</strong>${r.isFeatured ? ' <i class="fas fa-thumbtack" title="Featured" style="color:var(--gold);font-size:11px;"></i>' : ''}</td>
                            <td>${escapeHtml(r.studentClass || '—')}</td>
                            <td style="font-size:12px;color:var(--muted);">${r.email ? escapeHtml(r.email) : '—'}${r.phone ? `<br>${escapeHtml(r.phone)}` : ''}</td>
                            <td style="color:var(--gold);letter-spacing:1px;" title="${r.rating}/5">${reviewStars(r.rating)}</td>
                            <td style="max-width:280px;">${escapeHtml((r.feedback || '').slice(0, 100))}${(r.feedback || '').length > 100 ? '…' : ''}</td>
                            <td>${escapeHtml(r.source || 'website')}</td>
                            <td><span class="status-badge ${REVIEW_STATUS_BADGE[r.status] || 'type-badge'}">${r.status}</span>${r.status === 'rejected' && r.rejectionReason ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(r.rejectionReason)}</div>` : ''}</td>
                            <td>${new Date(r.createdAt).toLocaleDateString()}${r.editCount ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;" title="Last edited: ${new Date(r.lastEditedAt).toLocaleString()}"><i class="fas fa-pen" style="font-size:9px;"></i> Edited ${r.editCount}x · ${new Date(r.lastEditedAt).toLocaleDateString()}</div>` : ''}${r.deleted ? `<div style="font-size:11px;color:var(--danger, #dc2626);margin-top:2px;" title="Deleted by ${escapeHtml(r.deletedBy || '—')}"><i class="fas fa-trash" style="font-size:9px;"></i> Deleted ${new Date(r.deletedAt).toLocaleDateString()} by ${escapeHtml(r.deletedBy || '—')}</div>` : ''}</td>
                            <td style="white-space:nowrap;">
                                ${r.deleted ? `
                                    ${hasPermission('reviews:delete') ? `<button class="btn btn-secondary btn-sm" onclick="restoreReview('${r._id}')" title="Restore"><i class="fas fa-trash-restore"></i> Restore</button>` : ''}
                                ` : `
                                    ${hasPermission('reviews:edit') ? `
                                        ${r.status !== 'approved' ? `<button class="btn btn-secondary btn-sm" onclick="setReviewStatus('${r._id}', 'approved')" title="Approve"><i class="fas fa-check"></i></button>` : ''}
                                        ${r.status !== 'rejected' ? `<button class="btn btn-secondary btn-sm" onclick="showRejectReviewModal('${r._id}')" title="Reject"><i class="fas fa-ban"></i></button>` : ''}
                                        ${r.status === 'approved' ? `<button class="btn btn-secondary btn-sm" onclick="toggleReviewFeature('${r._id}', ${!r.isFeatured})" title="${r.isFeatured ? 'Unfeature' : 'Feature'}"><i class="fas fa-thumbtack"></i></button>` : ''}
                                        <button class="btn btn-secondary btn-sm" onclick="showEditReviewModal('${r._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                    ` : ''}
                                    ${hasPermission('reviews:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteReview('${r._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                `}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function setReviewStatus(id, status, rejectionReason) {
    const body = { status };
    if (status === 'rejected') body.rejectionReason = rejectionReason || '';
    const result = await apiCall(`/reviews/${id}/status`, { method: 'PUT', body: JSON.stringify(body) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update review', 'error'); return; }
    showToast('Success', `Review ${status}`, 'success');
    refreshReviewsBadge();
    await loadReviews();
}

function showRejectReviewModal(id) {
    showModal('Reject Review', 'Optional — a short internal note on why', `
        <div class="form-group"><label>Reason (optional, internal only)</label><textarea id="reviewRejectReason" rows="3" placeholder="e.g. Looks spammy / duplicate submission"></textarea></div>
    `, async () => {
        const reason = document.getElementById('reviewRejectReason').value.trim();
        closeModal();
        await setReviewStatus(id, 'rejected', reason);
    });
}

async function toggleReviewFeature(id, isFeatured) {
    const result = await apiCall(`/reviews/${id}/feature`, { method: 'PUT', body: JSON.stringify({ isFeatured }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update review', 'error'); return; }
    showToast('Success', result.message, 'success');
    await loadReviews();
}

async function deleteReview(id) {
    if (!confirm('Delete this review? It will be moved to Trash and can be restored later.')) return;
    const result = await apiCall(`/reviews/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete review', 'error'); return; }
    showToast('Success', 'Review moved to Trash', 'success');
    refreshReviewsBadge();
    await loadReviews();
}

async function restoreReview(id) {
    const result = await apiCall(`/reviews/${id}/restore`, { method: 'PUT' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to restore review', 'error'); return; }
    showToast('Success', 'Review restored', 'success');
    refreshReviewsBadge();
    await loadReviews();
}

function reviewFormFields(r = {}) {
    return `
        <div class="form-group"><label>Student Name *</label><input type="text" id="revStudentName" value="${escapeHtml(r.studentName || '')}"></div>
        <div class="form-group"><label>Class *</label><input type="text" id="revStudentClass" value="${escapeHtml(r.studentClass || '')}" placeholder="e.g. 10th Class"></div>
        <div class="form-group"><label>Rating *</label>
            <select id="revRating">
                ${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${Number(r.rating) === n ? 'selected' : ''}>${n} Star${n > 1 ? 's' : ''}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Feedback *</label><textarea id="revFeedback" rows="4">${escapeHtml(r.feedback || '')}</textarea></div>
    `;
}

function readReviewForm() {
    return {
        studentName: document.getElementById('revStudentName').value.trim(),
        studentClass: document.getElementById('revStudentClass').value.trim(),
        rating: parseInt(document.getElementById('revRating').value, 10),
        feedback: document.getElementById('revFeedback').value.trim(),
    };
}

function showAddReviewModal() {
    showModal('Add Review', 'For a verbal/WhatsApp testimonial — goes live immediately', reviewFormFields(), async () => {
        const body = readReviewForm();
        if (!body.studentName || !body.studentClass || !body.feedback) {
            showToast('Error', 'Name, class, and feedback are required', 'error');
            return;
        }
        const result = await apiCall('/reviews', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add review', 'error'); return; }
        showToast('Success', 'Review added', 'success');
        closeModal();
        await loadReviews();
    });
}

function showEditReviewModal(id) {
    const r = (window._reviewsList || []).find(x => x._id === id);
    if (!r) return;
    showModal('Edit Review', `Update the review from ${r.studentName}`, reviewFormFields(r), async () => {
        const body = readReviewForm();
        if (!body.studentName || !body.studentClass || !body.feedback) {
            showToast('Error', 'Name, class, and feedback are required', 'error');
            return;
        }
        const result = await apiCall(`/reviews/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update review', 'error'); return; }
        showToast('Success', 'Review updated', 'success');
        closeModal();
        await loadReviews();
    });
}

// Sidebar badge — count of pending reviews awaiting moderation
async function refreshReviewsBadge() {
    try {
        if (typeof apiCall !== 'function') return;
        const res = await apiCall('/reviews/dashboard');
        const count = res?.data?.pending || 0;
        const badge = document.getElementById('reviewsBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
    } catch (e) {
        console.debug('[reviews.js] Failed to refresh reviews badge:', e);
    }
}

// ============================================================
// Identity verifications — the email/mobile OTP gate on the public
// Feedback form (public/feedback.html -> routes/reviews.js). One
// verified email/mobile can complete exactly one review; this lets
// Rohit see who has verified/submitted and reset a record so someone
// can go through verification again (e.g. they mistyped their email
// the first time and never actually got a review through).
// ============================================================
async function showReviewVerificationsModal() {
    let records = [];
    try {
        const res = await apiCall('/reviews/verifications');
        records = res?.data || [];
    } catch (e) {
        showToast('Error', 'Failed to load verifications', 'error');
        return;
    }

    const rowsHtml = records.length === 0
        ? `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">No verification attempts yet</td></tr>`
        : records.map(r => `
            <tr>
                <td style="font-size:12.5px;">${escapeHtml(r.email)}<br><span style="color:var(--muted);">${escapeHtml(r.phone)}</span></td>
                <td>${r.verified ? '<span class="status-badge status-active">Verified</span>' : '<span class="status-badge status-inactive">Not verified</span>'}</td>
                <td>${r.used ? '<span class="status-badge status-active">Review submitted</span>' : '<span class="status-badge type-badge">Not used</span>'}</td>
                <td style="font-size:12px;color:var(--muted);">${new Date(r.createdAt).toLocaleString()}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="resetReviewVerification('${r._id}')" title="Reset — lets this email/mobile verify and submit again"><i class="fas fa-undo"></i> Reset</button></td>
            </tr>
        `).join('');

    showModal('Review Verifications', 'One review per verified email/mobile — reset a record to let someone submit again', `
        <div class="table-container" style="max-height:60vh;overflow-y:auto;">
            <table>
                <thead><tr><th>Email / Mobile</th><th>Verified</th><th>Used</th><th>First requested</th><th></th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    `, null);
    document.getElementById('modalSaveBtn').style.display = 'none';
}

async function resetReviewVerification(id) {
    if (!confirm('Reset this verification? The email/mobile number will be able to verify and submit a new review again — their existing review (if any) is not affected.')) return;
    const result = await apiCall(`/reviews/verifications/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reset verification', 'error'); return; }
    showToast('Success', result.message, 'success');
    closeModal();
    showReviewVerificationsModal();
}