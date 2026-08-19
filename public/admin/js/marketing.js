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
const PLACEMENT_LABELS = { top_bar: 'Top Bar (site-wide strip)', homepage: 'Homepage Section', popup: 'Popup (on page load)' };

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
                    <thead><tr><th>Order</th><th>Title</th><th>Placement</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${banners.map((b, idx) => `
                            <tr>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('marketing:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="moveBanner('${b._id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="moveBanner('${b._id}', 1)" ${idx === banners.length - 1 ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                                    ` : `<span style="font-size:12px;color:var(--muted);">${idx + 1}</span>`}
                                </td>
                                <td><strong>${escapeHtml(b.title)}</strong><div style="font-size:11px;color:var(--muted);max-width:260px;">${escapeHtml((b.message || '').slice(0, 80))}${(b.message || '').length > 80 ? '…' : ''}</div></td>
                                <td>${escapeHtml(PLACEMENT_LABELS[b.placement] || b.placement || '—')}</td>
                                <td style="font-size:12px;">${b.startDate || '—'} ${b.endDate ? `→ ${b.endDate}` : ''}</td>
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

// Swap this banner with its neighbour and persist the new order. Banners
// are already priority-sorted (server sorts by `priority` on load), so
// swapping two adjacent array entries and re-sending the whole ID order is
// enough — the reorder endpoint rewrites every banner's `priority` to its
// index in that list.
async function moveBanner(id, direction) {
    const banners = (window._marketingBanners || []).slice();
    const idx = banners.findIndex(x => x._id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= banners.length) return;

    [banners[idx], banners[newIdx]] = [banners[newIdx], banners[idx]];
    const orderedIds = banners.map(b => b._id);

    const result = await apiCall('/marketing/banners/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reorder', 'error'); return; }

    window._marketingBanners = banners.map((b, i) => ({ ...b, priority: i }));
    renderBannersView();
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
                    <option value="popup" ${b.placement === 'popup' ? 'selected' : ''}>Popup (on page load)</option>
                </select>
                <p style="font-size:11px;color:var(--muted);margin-top:4px;">Popup shows once per visitor session, a few seconds after the homepage loads. Only the highest-priority active popup banner is shown.</p>
            </div>
            <div class="form-group"><label>Priority (lower shows first)</label><input type="number" id="banPriority" value="${b.priority ?? 0}" min="0" max="999"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Button Text (optional)</label><input type="text" id="banCtaText" value="${escapeHtml(b.ctaText || '')}" placeholder="e.g. Enroll Now"></div>
            <div class="form-group"><label>Button Link (optional)</label><input type="text" id="banCtaLink" value="${escapeHtml(b.ctaLink || '')}" placeholder="e.g. /#admission or https://..."></div>
        </div>
        <div class="form-group">
            <label>Button Position (on the banner image)</label>
            <select id="banCtaPosition">
                <option value="bottom-right" ${(b.ctaPosition || 'bottom-right') === 'bottom-right' ? 'selected' : ''}>Bottom Right</option>
                <option value="bottom-left" ${b.ctaPosition === 'bottom-left' ? 'selected' : ''}>Bottom Left</option>
                <option value="bottom-center" ${b.ctaPosition === 'bottom-center' ? 'selected' : ''}>Bottom Center</option>
                <option value="top-right" ${b.ctaPosition === 'top-right' ? 'selected' : ''}>Top Right</option>
                <option value="top-left" ${b.ctaPosition === 'top-left' ? 'selected' : ''}>Top Left</option>
                <option value="top-center" ${b.ctaPosition === 'top-center' ? 'selected' : ''}>Top Center</option>
                <option value="center" ${b.ctaPosition === 'center' ? 'selected' : ''}>Center</option>
            </select>
            <p style="font-size:11px;color:var(--muted);margin-top:4px;">Only applies when a Banner Image is set below and Button Text + Link are both filled in — pick a spot on the image that has empty space so the button doesn't sit on top of existing text/logos.</p>
        </div>
        <div class="form-group">
            <label>Banner Image (optional)</label>
            <div id="banImagePreviewWrap" style="margin-bottom:8px;">${bannerImagePreviewHtml(b.imageUrl || '')}</div>
            <input type="text" id="banImageUrl" value="${escapeHtml(b.imageUrl || '')}" placeholder="Paste an image URL, or upload a file below" onchange="handleBannerImageUrlChange()">
            <input type="file" id="banImageFile" accept="image/png,image/jpeg,image/webp" onchange="handleBannerImageSelect(this)" style="margin-top:6px;">
            <div id="banImageUploadProgressWrap" style="display:none;margin-top:6px;">
                <div style="background:var(--border,#e5e7eb);border-radius:4px;height:6px;overflow:hidden;">
                    <div id="banImageUploadProgressBar" style="background:var(--gold,#c9a227);height:100%;width:0%;transition:width .15s ease;"></div>
                </div>
                <span id="banImageUploadProgressText" style="font-size:11px;color:var(--muted);">0%</span>
            </div>
            <p style="font-size:11px;color:var(--muted);margin-top:4px;">JPG, PNG, or WEBP, up to 5MB — paste a URL above or upload a file. Leave empty and the slider shows a text-based banner design instead.</p>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Start Date (optional)</label><input type="date" id="banStartDate" value="${b.startDate || ''}"></div>
            <div class="form-group"><label>End Date (optional)</label><input type="date" id="banEndDate" value="${b.endDate || ''}"></div>
        </div>
        <p style="font-size:11px;color:var(--muted);">Leave dates blank to run indefinitely until you deactivate it.</p>
    `;
}

// Shared by the initial form render, a successful upload, a pasted-URL
// change, and "Remove Image" — one place that decides what the preview
// area shows. onerror on the <img> covers a pasted URL that doesn't
// actually load (dead link, wrong domain, etc.) — swaps to a plain
// message instead of showing a browser broken-image icon, and the Remove
// button stays available either way so a bad URL is never a dead end.
function bannerImagePreviewHtml(url) {
    if (!url) return `<span style="font-size:12px;color:var(--muted);">No image — text-based banner design will be used</span>`;
    return `
        <img src="${escapeHtml(url)}" style="max-width:220px;max-height:110px;border-radius:8px;display:block;margin-bottom:6px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <span style="display:none;font-size:12px;color:#c0392b;margin-bottom:6px;">Couldn't load this image — check the URL or upload a file instead.</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearBannerImage()">Remove Image</button>
    `;
}

// Client-side mirror of the backend's ALLOWED_BANNER_IMAGE_MIMES / 5MB
// limit (routes/admin/marketing.js) — fails fast with a clear message
// instead of waiting on a network round-trip only to get a 400 back.
// The backend check is still the real guard; this is just a faster no.
const BANNER_IMAGE_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const BANNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// XHR (not fetch) specifically so we get real upload progress via
// xhr.upload.onprogress — fetch has no stable, widely-supported way to
// track upload (as opposed to download) progress.
function uploadBannerImageFile(file, onProgress) {
    return new Promise((resolve) => {
        const formData = new FormData();
        formData.append('image', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/marketing/banners/upload-image`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`); // no Content-Type — browser sets the multipart boundary

        xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable || !onProgress) return;
            onProgress(Math.round((e.loaded / e.total) * 100));
        };

        xhr.onload = () => {
            if (xhr.status === 401) {
                localStorage.removeItem('adminToken');
                window.location.href = '/admin/login.html';
                return resolve(null);
            }
            try {
                resolve(JSON.parse(xhr.responseText));
            } catch (error) {
                console.error('Banner image upload error: bad response', error);
                resolve(null);
            }
        };
        xhr.onerror = () => {
            console.error('Banner image upload error: network failure');
            resolve(null);
        };

        xhr.send(formData);
    });
}

function showBannerUploadProgress(show) {
    const wrap = document.getElementById('banImageUploadProgressWrap');
    if (!wrap) return;
    wrap.style.display = show ? 'block' : 'none';
    if (show) setBannerUploadProgress(0);
}

function setBannerUploadProgress(pct) {
    const bar = document.getElementById('banImageUploadProgressBar');
    const text = document.getElementById('banImageUploadProgressText');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = pct + '%';
}

async function handleBannerImageSelect(input) {
    const file = input.files[0];
    if (!file) return;

    // Fail fast on type/size before ever hitting the network — same
    // limits the backend enforces (routes/admin/marketing.js).
    if (!BANNER_IMAGE_ALLOWED_MIMES.includes(file.type)) {
        showToast('Error', 'Only JPG, PNG, or WEBP images are allowed', 'error');
        input.value = '';
        return;
    }
    if (file.size > BANNER_IMAGE_MAX_BYTES) {
        showToast('Error', 'Image is too large. Max size is 5MB.', 'error');
        input.value = '';
        return;
    }

    const previewWrap = document.getElementById('banImagePreviewWrap');
    previewWrap.innerHTML = `<span style="font-size:12px;color:var(--muted);">Uploading…</span>`;
    showBannerUploadProgress(true);

    const result = await uploadBannerImageFile(file, setBannerUploadProgress);
    input.value = ''; // allow re-selecting the same file later
    showBannerUploadProgress(false);

    if (!result || !result.success) {
        showToast('Error', result?.message || 'Image upload failed', 'error');
        previewWrap.innerHTML = bannerImagePreviewHtml(document.getElementById('banImageUrl').value);
        return;
    }

    document.getElementById('banImageUrl').value = result.data.imageUrl;
    previewWrap.innerHTML = bannerImagePreviewHtml(result.data.imageUrl);
    showToast('Success', 'Image uploaded', 'success');
}

// Fires when the admin pastes/edits the URL field directly and clicks
// away — refreshes the preview (and Remove button) to match, same as a
// successful upload does.
function handleBannerImageUrlChange() {
    const url = document.getElementById('banImageUrl').value.trim();
    document.getElementById('banImagePreviewWrap').innerHTML = bannerImagePreviewHtml(url);
}

function clearBannerImage() {
    document.getElementById('banImageUrl').value = '';
    document.getElementById('banImagePreviewWrap').innerHTML = bannerImagePreviewHtml('');
}

function readBannerForm() {
    return {
        title: document.getElementById('banTitle').value.trim(),
        message: document.getElementById('banMessage').value.trim(),
        placement: document.getElementById('banPlacement').value,
        priority: parseInt(document.getElementById('banPriority').value, 10) || 0,
        ctaText: document.getElementById('banCtaText').value.trim(),
        ctaLink: document.getElementById('banCtaLink').value.trim(),
        ctaPosition: document.getElementById('banCtaPosition').value,
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