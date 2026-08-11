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
            ${hasPermission('reviews:edit') ? `<button class="btn btn-gold" onclick="showAddReviewModal()"><i class="fas fa-plus"></i> Add Review</button>` : ''}
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
        wrap.innerHTML = `<div class="empty-state"><span class="icon">⭐</span><strong>No Reviews</strong><p>Reviews submitted from the website's Feedback form will show up here.</p></div>`;
        return;
    }

    wrap.innerHTML = `
        <div class="table-container">
            <table>
                <thead><tr><th>Student</th><th>Class</th><th>Rating</th><th>Feedback</th><th>Source</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
                <tbody>
                    ${list.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.studentName)}</strong>${r.isFeatured ? ' <i class="fas fa-thumbtack" title="Featured" style="color:var(--gold);font-size:11px;"></i>' : ''}</td>
                            <td>${escapeHtml(r.studentClass || '—')}</td>
                            <td style="color:var(--gold);letter-spacing:1px;" title="${r.rating}/5">${reviewStars(r.rating)}</td>
                            <td style="max-width:280px;">${escapeHtml((r.feedback || '').slice(0, 100))}${(r.feedback || '').length > 100 ? '…' : ''}</td>
                            <td>${escapeHtml(r.source || 'website')}</td>
                            <td><span class="status-badge ${REVIEW_STATUS_BADGE[r.status] || 'type-badge'}">${r.status}</span>${r.status === 'rejected' && r.rejectionReason ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${escapeHtml(r.rejectionReason)}</div>` : ''}</td>
                            <td>${new Date(r.createdAt).toLocaleDateString()}</td>
                            <td style="white-space:nowrap;">
                                ${hasPermission('reviews:edit') ? `
                                    ${r.status !== 'approved' ? `<button class="btn btn-secondary btn-sm" onclick="setReviewStatus('${r._id}', 'approved')" title="Approve"><i class="fas fa-check"></i></button>` : ''}
                                    ${r.status !== 'rejected' ? `<button class="btn btn-secondary btn-sm" onclick="showRejectReviewModal('${r._id}')" title="Reject"><i class="fas fa-ban"></i></button>` : ''}
                                    ${r.status === 'approved' ? `<button class="btn btn-secondary btn-sm" onclick="toggleReviewFeature('${r._id}', ${!r.isFeatured})" title="${r.isFeatured ? 'Unfeature' : 'Feature'}"><i class="fas fa-thumbtack"></i></button>` : ''}
                                    <button class="btn btn-secondary btn-sm" onclick="showEditReviewModal('${r._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                ` : ''}
                                ${hasPermission('reviews:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteReview('${r._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
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
    if (!confirm('Delete this review? This cannot be undone.')) return;
    const result = await apiCall(`/reviews/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete review', 'error'); return; }
    showToast('Success', 'Review deleted', 'success');
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
