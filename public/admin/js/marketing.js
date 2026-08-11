// public/admin/js/marketing.js
//
// Marketing — admin side. Two halves under one sidebar item, toggled like
// recruitment.js's Applications/Positions:
//   'banners'   → routes/admin/marketing.js (/api/admin/marketing/banners)
//                 Promo banners/offers shown on the public site. Public
//                 read is routes/marketing.js (GET /api/marketing/banners).
//   'campaigns' → routes/admin/marketing-campaigns.js
//                 (/api/admin/marketing/campaigns/*)
//                 Bulk promotional Email/WhatsApp/SMS to leads & students.

const MARKETING_TARGET_LABELS = {
    students: 'All Active Students',
    enquiries: 'Website Enquiries',
    admissions: 'Admission Form Leads',
    all_leads: 'All Leads (Enquiries + Admissions)',
    everyone: 'Everyone (Students + All Leads)',
};
const ENQUIRY_STATUS_OPTIONS = ['new', 'contacted', 'converted', 'closed'];
const ADMISSION_STATUS_OPTIONS = ['new', 'contacted', 'admitted', 'rejected'];

let marketingView = 'banners'; // 'banners' | 'campaigns'

async function loadMarketing() {
    showLoading();
    try {
        const [bannersRes, historyRes] = await Promise.all([
            apiCall('/marketing/banners'),
            apiCall('/marketing/campaigns/history'),
        ]);
        window._marketingBanners = bannersRes?.data || [];
        window._marketingHistory = historyRes?.data || [];
        renderMarketing();
    } catch (error) {
        showError('Failed to load Marketing', error.message);
    }
}

function switchMarketingView(view) {
    marketingView = view;
    renderMarketing();
}

function renderMarketing() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📣 Marketing</h2>
            <div style="display:flex;gap:8px;">
                <button class="btn ${marketingView === 'banners' ? 'btn-gold' : 'btn-secondary'} btn-sm" onclick="switchMarketingView('banners')"><i class="fas fa-flag"></i> Banners &amp; Offers</button>
                <button class="btn ${marketingView === 'campaigns' ? 'btn-gold' : 'btn-secondary'} btn-sm" onclick="switchMarketingView('campaigns')"><i class="fas fa-paper-plane"></i> Campaigns</button>
            </div>
        </div>
        <div id="marketingViewWrap"></div>
    `;
    if (marketingView === 'campaigns') renderCampaignsView();
    else renderBannersView();
}

// ============================================================
// BANNERS
// ============================================================
const PLACEMENT_LABELS = { top_bar: 'Top Bar (site-wide strip)', homepage: 'Homepage Section' };

function renderBannersView() {
    const wrap = document.getElementById('marketingViewWrap');
    const banners = window._marketingBanners || [];

    wrap.innerHTML = `
        <div class="toolbar">
            <h2 style="font-size:16px;">Banners &amp; Offers <span class="count">(${banners.length})</span></h2>
            ${hasPermission('marketing:create') ? `<button class="btn btn-gold btn-sm" onclick="showAddBannerModal()"><i class="fas fa-plus"></i> Add Banner</button>` : ''}
        </div>
        ${banners.length === 0 ? `
            <div class="empty-state"><span class="icon">📣</span><strong>No Banners Yet</strong><p>Add a banner to show a promo bar or offer card on the public website.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Title</th><th>Placement</th><th>Dates</th><th>Priority</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${banners.map(b => `
                            <tr>
                                <td><strong>${escapeHtml(b.title)}</strong><div style="font-size:11px;color:var(--muted);max-width:260px;">${escapeHtml((b.message || '').slice(0, 80))}${(b.message || '').length > 80 ? '…' : ''}</div></td>
                                <td>${escapeHtml(PLACEMENT_LABELS[b.placement] || b.placement || '—')}</td>
                                <td style="font-size:12px;">${b.startDate || '—'} ${b.endDate ? `→ ${b.endDate}` : ''}</td>
                                <td>${b.priority ?? 0}</td>
                                <td><span class="status-badge ${b.isActive ? 'status-active' : 'status-inactive'}">${b.isActive ? 'Active' : 'Inactive'}</span></td>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('marketing:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="showEditBannerModal('${b._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-sm" onclick="toggleBannerActive('${b._id}', ${!b.isActive})" title="${b.isActive ? 'Deactivate' : 'Activate'}"><i class="fas fa-${b.isActive ? 'eye-slash' : 'eye'}"></i></button>
                                    ` : ''}
                                    ${hasPermission('marketing:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteBanner('${b._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

function bannerFormFields(b = {}) {
    return `
        <div class="form-group"><label>Title *</label><input type="text" id="banTitle" value="${escapeHtml(b.title || '')}" placeholder="e.g. Admissions Open — 2027 Batch"></div>
        <div class="form-group"><label>Message *</label><textarea id="banMessage" rows="3" placeholder="e.g. Limited seats left for NEET/JEE 2027 batch. Enroll now!">${escapeHtml(b.message || '')}</textarea></div>
        <div class="form-row">
            <div class="form-group"><label>Placement</label>
                <select id="banPlacement">
                    <option value="homepage" ${(b.placement || 'homepage') === 'homepage' ? 'selected' : ''}>Homepage Section</option>
                    <option value="top_bar" ${b.placement === 'top_bar' ? 'selected' : ''}>Top Bar (site-wide strip)</option>
                </select>
            </div>
            <div class="form-group"><label>Priority (lower shows first)</label><input type="number" id="banPriority" value="${b.priority ?? 0}" min="0" max="999"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Button Text (optional)</label><input type="text" id="banCtaText" value="${escapeHtml(b.ctaText || '')}" placeholder="e.g. Enroll Now"></div>
            <div class="form-group"><label>Button Link (optional)</label><input type="text" id="banCtaLink" value="${escapeHtml(b.ctaLink || '')}" placeholder="e.g. #admission"></div>
        </div>
        <div class="form-group"><label>Image URL (optional)</label><input type="text" id="banImageUrl" value="${escapeHtml(b.imageUrl || '')}" placeholder="e.g. /images/offer.jpg"></div>
        <div class="form-row">
            <div class="form-group"><label>Start Date (optional)</label><input type="date" id="banStartDate" value="${b.startDate || ''}"></div>
            <div class="form-group"><label>End Date (optional)</label><input type="date" id="banEndDate" value="${b.endDate || ''}"></div>
        </div>
        <p style="font-size:11px;color:var(--muted);">Leave dates blank to run indefinitely until you deactivate it.</p>
    `;
}

function readBannerForm() {
    return {
        title: document.getElementById('banTitle').value.trim(),
        message: document.getElementById('banMessage').value.trim(),
        placement: document.getElementById('banPlacement').value,
        priority: parseInt(document.getElementById('banPriority').value, 10) || 0,
        ctaText: document.getElementById('banCtaText').value.trim(),
        ctaLink: document.getElementById('banCtaLink').value.trim(),
        imageUrl: document.getElementById('banImageUrl').value.trim(),
        startDate: document.getElementById('banStartDate').value,
        endDate: document.getElementById('banEndDate').value,
    };
}

function showAddBannerModal() {
    showModal('Add Banner', 'Shows on the public website once created', bannerFormFields(), async () => {
        const body = readBannerForm();
        if (!body.title || !body.message) { showToast('Error', 'Title and message are required', 'error'); return; }
        const result = await apiCall('/marketing/banners', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create banner', 'error'); return; }
        showToast('Success', 'Banner created', 'success');
        closeModal();
        await loadMarketing();
        marketingView = 'banners';
        renderMarketing();
    });
}

function showEditBannerModal(id) {
    const b = (window._marketingBanners || []).find(x => x._id === id);
    if (!b) return;
    showModal('Edit Banner', `Update "${b.title}"`, bannerFormFields(b), async () => {
        const body = readBannerForm();
        if (!body.title || !body.message) { showToast('Error', 'Title and message are required', 'error'); return; }
        const result = await apiCall(`/marketing/banners/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update banner', 'error'); return; }
        showToast('Success', 'Banner updated', 'success');
        closeModal();
        await loadMarketing();
        marketingView = 'banners';
        renderMarketing();
    });
}

async function toggleBannerActive(id, isActive) {
    const result = await apiCall(`/marketing/banners/${id}`, { method: 'PUT', body: JSON.stringify({ isActive }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update banner', 'error'); return; }
    showToast('Success', isActive ? 'Banner activated' : 'Banner deactivated', 'success');
    await loadMarketing();
    marketingView = 'banners';
    renderMarketing();
}

async function deleteBanner(id) {
    const b = (window._marketingBanners || []).find(x => x._id === id);
    if (!confirm(`Delete "${b?.title || 'this banner'}"? This can't be undone.`)) return;
    const result = await apiCall(`/marketing/banners/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete banner', 'error'); return; }
    showToast('Success', 'Banner deleted', 'success');
    await loadMarketing();
    marketingView = 'banners';
    renderMarketing();
}

// ============================================================
// CAMPAIGNS
// ============================================================
function renderCampaignsView() {
    const wrap = document.getElementById('marketingViewWrap');
    const history = window._marketingHistory || [];

    wrap.innerHTML = `
        <div class="builder-grid">
            <div class="builder-panel">
                <h3>✉️ Compose Campaign</h3>
                <div class="form-group"><label>Title *</label><input type="text" id="campTitle" placeholder="e.g. New Batch Launch — NEET 2027"></div>
                <div class="form-group"><label>Message *</label><textarea id="campMessage" rows="4" placeholder="Type your promotional message…"></textarea></div>

                <div class="form-group">
                    <label>Channels *</label>
                    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px;">
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="camp-channel" value="email" checked> 📧 Email</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="camp-channel" value="whatsapp"> 💬 WhatsApp</label>
                        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;"><input type="checkbox" class="camp-channel" value="sms"> 📱 SMS</label>
                    </div>
                    <p style="font-size:11px;color:var(--muted);margin-top:4px;">Email/WhatsApp/SMS need SMTP/Twilio configured in .env — otherwise they're logged but not actually sent.</p>
                </div>

                <div class="form-group">
                    <label>Target By *</label>
                    <select id="campTargetType" onchange="renderCampTargetSubfield()">
                        ${Object.entries(MARKETING_TARGET_LABELS).map(([val, label]) => `<option value="${val}">${label}</option>`).join('')}
                    </select>
                </div>
                <div id="campTargetSubfield"></div>

                <div style="display:flex;align-items:center;gap:10px;margin:10px 0;">
                    <button class="btn btn-secondary btn-sm" onclick="previewCampTargets()"><i class="fas fa-users"></i> Preview Recipients</button>
                    <span id="campPreviewResult" style="font-size:13px;color:var(--muted);"></span>
                </div>

                <button class="btn btn-gold" onclick="sendCampaign()"><i class="fas fa-paper-plane"></i> Send Campaign</button>
            </div>

            <div class="builder-panel">
                <h3>🕒 Recent Campaigns</h3>
                <div class="builder-list" style="max-height:600px;">
                    ${history.length === 0 ? `<div style="color:var(--muted);font-size:12px;padding:12px;text-align:center;">No campaigns sent yet.</div>` : history.map(c => `
                        <div class="builder-card" style="cursor:default;">
                            <div class="builder-card-body">
                                <div class="builder-card-text"><strong>${escapeHtml(c.title)}</strong></div>
                                <div style="font-size:12px;color:var(--text);margin-top:4px;">${escapeHtml(c.message.slice(0, 100))}${c.message.length > 100 ? '…' : ''}</div>
                                <div class="builder-card-meta">
                                    ${c.channels.map(ch => `<span class="diff-chip medium">${ch}</span>`).join('')}
                                    <span style="font-size:10px;color:var(--muted);">${MARKETING_TARGET_LABELS[c.targetType] || c.targetType}${c.targetValue ? ` (${c.targetValue})` : ''} · ${c.recipientCount} contact(s) · ${new Date(c.createdAt).toLocaleString('en-IN')}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    renderCampTargetSubfield();
}

function renderCampTargetSubfield() {
    const targetType = document.getElementById('campTargetType').value;
    const container = document.getElementById('campTargetSubfield');

    if (targetType === 'enquiries') {
        container.innerHTML = `
            <div class="form-group"><label>Enquiry Status (optional — leave blank for all)</label>
                <select id="campTargetValue">
                    <option value="">All Statuses</option>
                    ${ENQUIRY_STATUS_OPTIONS.map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
                </select>
            </div>`;
    } else if (targetType === 'admissions') {
        container.innerHTML = `
            <div class="form-group"><label>Admission Status (optional — leave blank for all)</label>
                <select id="campTargetValue">
                    <option value="">All Statuses</option>
                    ${ADMISSION_STATUS_OPTIONS.map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
                </select>
            </div>`;
    } else if (targetType === 'students') {
        container.innerHTML = `<p style="font-size:12px;color:var(--muted);">Targets every active student.</p>`;
    } else if (targetType === 'all_leads') {
        container.innerHTML = `<p style="font-size:12px;color:var(--muted);">Targets every website enquiry and admission-form lead, deduplicated by phone/email.</p>`;
    } else {
        container.innerHTML = `<p style="font-size:12px;color:var(--muted);">Targets every student, enquiry, and admission-form lead, deduplicated by phone/email.</p>`;
    }
    document.getElementById('campPreviewResult').textContent = '';
}

function getCampTargetValue() {
    const el = document.getElementById('campTargetValue');
    return el ? el.value : '';
}

async function previewCampTargets() {
    const targetType = document.getElementById('campTargetType').value;
    const targetValue = getCampTargetValue();
    const resultEl = document.getElementById('campPreviewResult');
    resultEl.textContent = 'Loading…';

    const params = new URLSearchParams({ targetType });
    if (targetValue) params.set('targetValue', targetValue);
    const result = await apiCall(`/marketing/campaigns/targets/preview?${params.toString()}`);
    if (!result || !result.success) { resultEl.textContent = 'Failed to preview'; return; }

    resultEl.textContent = result.data.count === 0
        ? 'No contacts match this target.'
        : `${result.data.count} contact(s): ${result.data.contacts.slice(0, 5).map(c => c.name).join(', ')}${result.data.count > 5 ? '…' : ''}`;
}

async function sendCampaign() {
    const title = document.getElementById('campTitle').value.trim();
    const message = document.getElementById('campMessage').value.trim();
    const channels = Array.from(document.querySelectorAll('.camp-channel:checked')).map(el => el.value);
    const targetType = document.getElementById('campTargetType').value;
    const targetValue = getCampTargetValue();

    if (!title || !message) { showToast('Error', 'Title and message are required', 'error'); return; }
    if (channels.length === 0) { showToast('Error', 'Select at least one channel', 'error'); return; }
    if (!confirm(`Send "${title}" via ${channels.join(', ')} to ${MARKETING_TARGET_LABELS[targetType]}? This cannot be undone.`)) return;

    const result = await apiCall('/marketing/campaigns/send', {
        method: 'POST',
        body: JSON.stringify({ title, message, channels, targetType, targetValue }),
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send campaign', 'error'); return; }
    showToast('Success', result.message, 'success');
    const historyRes = await apiCall('/marketing/campaigns/history');
    window._marketingHistory = historyRes?.data || [];
    renderCampaignsView();
}
