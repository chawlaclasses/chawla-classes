// public/admin/js/enquiries.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ENQUIRIES
// ============================================================
async function loadEnquiries() {
    showLoading();
    try {
        const response = await apiCall('/enquiries');
        currentData = response?.data || [];
        renderEnquiries();
    } catch (error) {
        showError('Failed to load enquiries', error.message);
    }
}

function renderEnquiries() {
    const statusColors = { new: 'status-inactive', contacted: 'status-active', converted: 'status-active', closed: 'status-inactive' };
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📞 Enquiries <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showAddEnquiryModal()"><i class="fas fa-plus"></i> Log Enquiry</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">📞</span><strong>No Enquiries</strong><p>Click "Log Enquiry" to record a walk-in, call, or online enquiry.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Name</th><th>Phone</th><th>Interested In</th><th>Source</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(e => `
                            <tr>
                                <td><strong>${escapeHtml(e.name)}</strong></td>
                                <td>${escapeHtml(e.phone)}</td>
                                <td>${escapeHtml(e.interestedClass || '-')}</td>
                                <td>${escapeHtml(e.source || '-')}</td>
                                <td>
                                    <select onchange="updateEnquiryStatus('${e._id}', this.value)" style="background:${e.status === 'new' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)'};color:${e.status === 'new' ? '#dc2626' : '#16a34a'};border:none;border-radius:6px;padding:4px 8px;font-size:12px;">
                                        <option value="new" ${e.status === 'new' ? 'selected' : ''}>New</option>
                                        <option value="contacted" ${e.status === 'contacted' ? 'selected' : ''}>Contacted</option>
                                        <option value="converted" ${e.status === 'converted' ? 'selected' : ''}>Converted</option>
                                        <option value="closed" ${e.status === 'closed' ? 'selected' : ''}>Closed</option>
                                    </select>
                                </td>
                                <td>${new Date(e.createdAt).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

async function updateEnquiryStatus(id, status) {
    const result = await apiCall(`/enquiries/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update enquiry', 'error'); return; }
    showToast('Success', 'Enquiry status updated', 'success');
    refreshEnquiryBadge();
    loadEnquiries();
}