// public/admin/js/settings.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// SETTINGS
// ============================================================
async function loadSettings() {
    showLoading();
    try {
        const [settingsRes, backupsRes] = await Promise.all([
            apiCall('/settings'),
            apiCall('/settings/backups')
        ]);
        window._settings = settingsRes?.data || {};
        window._backups = backupsRes?.data || [];
        renderSettings();
    } catch (error) {
        showError('Failed to load settings', error.message);
    }
}

function settingsCard(title, icon, bodyHtml) {
    return `
        <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:20px;margin-bottom:16px;">
            <strong style="color:var(--white);display:block;margin-bottom:14px;font-size:15px;">${icon} ${title}</strong>
            ${bodyHtml}
        </div>
    `;
}

function renderSettings() {
    const s = window._settings;
    contentArea.innerHTML = `
        <div class="toolbar"><h2>⚙️ Settings</h2></div>
        <div style="max-width:700px;">

            ${settingsCard('Institute Details', '🏫', `
                <div class="form-group"><label>Institute Name</label><input type="text" id="setInstituteName" value="${escapeHtml(s.instituteName)}"></div>
                <div class="form-group"><label>Academic Session</label><input type="text" id="setAcademicSession" placeholder="e.g., 2026-2027" value="${escapeHtml(s.academicSession)}"></div>
                <div class="form-group"><label>Default Passing Criteria (%)</label><input type="number" id="setPassingCriteria" min="0" max="100" value="${s.passingCriteria}"></div>
                <div style="display:flex;gap:20px;align-items:flex-start;margin-top:10px;">
                    <div>
                        <label style="display:block;color:var(--muted);font-size:12px;margin-bottom:6px;">Logo</label>
                        ${s.logoUrl ? `<img src="${s.logoUrl}" style="height:48px;border-radius:6px;margin-bottom:6px;display:block;">` : ''}
                        <input type="file" id="setLogoFile" accept=".png,.jpg,.jpeg,.svg" style="font-size:12px;">
                        <button class="btn btn-sm btn-gold" style="margin-top:6px;" onclick="uploadBrandingFile('logo')">Upload Logo</button>
                    </div>
                    <div>
                        <label style="display:block;color:var(--muted);font-size:12px;margin-bottom:6px;">Favicon</label>
                        ${s.faviconUrl ? `<img src="${s.faviconUrl}" style="height:32px;border-radius:4px;margin-bottom:6px;display:block;">` : ''}
                        <input type="file" id="setFaviconFile" accept=".png,.jpg,.jpeg,.ico" style="font-size:12px;">
                        <button class="btn btn-sm btn-gold" style="margin-top:6px;" onclick="uploadBrandingFile('favicon')">Upload Favicon</button>
                    </div>
                </div>
                <button class="btn btn-gold" style="margin-top:14px;" onclick="saveInstituteSettings()"><i class="fas fa-save"></i> Save</button>
            `)}

            ${settingsCard('Theme', '🎨', `
                <div class="form-group">
                    <label>Accent Color</label>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <input type="color" id="setThemeColor" value="${s.themeColor}" style="width:50px;height:38px;padding:2px;">
                        <span style="color:var(--muted);font-size:12px;">Applies to the admin dashboard's gold accents (buttons, active states, highlights)</span>
                    </div>
                </div>
                <button class="btn btn-gold" onclick="saveThemeColor()"><i class="fas fa-save"></i> Apply Theme</button>
            `)}

            ${settingsCard('Email Configuration', '📧', `
                <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">Used to send real emails (e.g. fee reminders). Requires valid SMTP credentials from your email provider.</p>
                <div class="form-row">
                    <div class="form-group"><label>SMTP Host</label><input type="text" id="setEmailHost" placeholder="smtp.gmail.com" value="${escapeHtml(s.email?.host || '')}"></div>
                    <div class="form-group"><label>SMTP Port</label><input type="number" id="setEmailPort" value="${s.email?.port || 587}"></div>
                </div>
                <div class="form-group"><label>SMTP Username</label><input type="text" id="setEmailUser" value="${escapeHtml(s.email?.user || '')}"></div>
                <div class="form-group"><label>SMTP Password</label><input type="password" id="setEmailPass" value="${escapeHtml(s.email?.pass || '')}"></div>
                <div class="form-row">
                    <div class="form-group"><label>From Name</label><input type="text" id="setEmailFromName" value="${escapeHtml(s.email?.fromName || '')}"></div>
                    <div class="form-group"><label>From Address</label><input type="text" id="setEmailFromAddress" value="${escapeHtml(s.email?.fromAddress || '')}"></div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button class="btn btn-gold" onclick="saveEmailSettings()"><i class="fas fa-save"></i> Save</button>
                    <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="sendTestEmail()"><i class="fas fa-paper-plane"></i> Send Test Email</button>
                    <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="testSmtpConnectivity()"><i class="fas fa-network-wired"></i> Test Connectivity</button>
                </div>
            `)}

            ${settingsCard('WhatsApp Configuration', '💬', `
                <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">
                    ⚠️ Requires a real WhatsApp Business API account (e.g. Twilio). These fields save your credentials for future use — actually sending messages needs a valid account, which isn't connected here yet.
                </p>
                <div class="form-group"><label>Account SID</label><input type="text" id="setWaSid" value="${escapeHtml(s.whatsapp?.accountSid || '')}"></div>
                <div class="form-group"><label>Auth Token</label><input type="password" id="setWaToken" value="${escapeHtml(s.whatsapp?.authToken || '')}"></div>
                <div class="form-group"><label>From Number</label><input type="text" id="setWaFrom" placeholder="whatsapp:+14155238886" value="${escapeHtml(s.whatsapp?.fromNumber || '')}"></div>
                <button class="btn btn-gold" onclick="saveWhatsAppSettings()"><i class="fas fa-save"></i> Save</button>
            `)}

            ${settingsCard('Social Links', '📸', `
                <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">Shown on the public website's Gallery page (Instagram feed + Google Photos album link).</p>
                <div class="form-group"><label>Instagram Handle or URL</label><input type="text" id="setInstagram" placeholder="e.g. @chawlaclasses or https://instagram.com/chawlaclasses" value="${escapeHtml(s.socialLinks?.instagram || '')}"></div>
                <div class="form-group"><label>Google Photos Album Link</label><input type="text" id="setGooglePhotos" placeholder="https://photos.app.goo.gl/..." value="${escapeHtml(s.socialLinks?.googlePhotos || '')}"></div>
                <button class="btn btn-gold" onclick="saveSocialLinks()"><i class="fas fa-save"></i> Save</button>
            `)}

            ${settingsCard('Google Reviews', '⭐', `
                <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">
                    Shown as a rating badge on the homepage and the Student Reviews page, linking out to your real Google Business listing. No API key/billing involved, and no reviews are stored on this site — rating and review count are typed in here and shown as-is, so refresh them from your Google Business Profile whenever you'd like the number to update.
                </p>
                <div class="form-group">
                    <label>Google Business Profile URL</label>
                    <input type="text" id="setGoogleProfileUrl" placeholder="https://www.google.com/maps/place/..." value="${escapeHtml(s.googleReviews?.profileUrl || '')}">
                    <p style="color:var(--muted);font-size:11px;margin-top:4px;">Paste the URL from your browser's address bar when viewing your business on Google Maps (Share → Copy link also works). This is the only thing "Read Our Google Reviews" and "Write a Review on Google" need — no Place ID lookup required.</p>
                </div>
                <div class="form-group"><label>Google Rating (out of 5)</label><input type="number" id="setGoogleRating" step="0.1" min="0" max="5" value="${s.googleReviews?.rating ?? ''}"></div>
                <div class="form-group"><label>Google Review Count</label><input type="number" id="setGoogleReviewCount" min="0" step="1" value="${s.googleReviews?.reviewCount ?? ''}"></div>
                <div class="form-group">
                    <label><input type="checkbox" id="setGoogleReviewsEnabled" ${s.googleReviews?.enabled ? 'checked' : ''} style="width:auto;margin-right:8px;"> Show Google Reviews on the website</label>
                </div>
                <details style="margin-bottom:12px;">
                    <summary style="color:var(--muted);font-size:12px;cursor:pointer;">Advanced: legacy Place ID (optional)</summary>
                    <div class="form-group" style="margin-top:8px;">
                        <label>Google Place ID <span style="font-weight:400;color:var(--muted);">(optional — only needed if you had this set up before the Profile URL field existed)</span></label>
                        <input type="text" id="setGooglePlaceId" placeholder="e.g. ChIJ..." value="${escapeHtml(s.googleReviews?.placeId || '')}">
                    </div>
                </details>
                ${s.googleReviews?.updatedAt ? `<p style="color:var(--muted);font-size:11px;margin-bottom:12px;">Last updated: ${new Date(s.googleReviews.updatedAt).toLocaleString()}</p>` : ''}
                <button class="btn btn-gold" onclick="saveGoogleReviewsSettings()"><i class="fas fa-save"></i> Save</button>
            `)}

            ${settingsCard('Backup Settings', '💾', `
                <div class="form-group">
                    <label><input type="checkbox" id="setAutoBackup" ${s.backup?.autoBackupEnabled ? 'checked' : ''} style="width:auto;margin-right:8px;"> Enable automatic backups</label>
                </div>
                <div class="form-group"><label>Schedule</label>
                    <select id="setBackupSchedule">
                        <option value="daily" ${s.backup?.schedule === 'daily' ? 'selected' : ''}>Daily (2 AM)</option>
                        <option value="weekly" ${s.backup?.schedule === 'weekly' ? 'selected' : ''}>Weekly (Sunday, 2 AM)</option>
                    </select>
                </div>
                <div style="display:flex;gap:10px;margin-bottom:16px;">
                    <button class="btn btn-gold" onclick="saveBackupSettings()"><i class="fas fa-save"></i> Save</button>
                    <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="createBackupNow()"><i class="fas fa-download"></i> Backup Now</button>
                </div>
                <strong style="color:var(--white);font-size:13px;display:block;margin-bottom:8px;">Existing Backups</strong>
                <div id="backupsList">${renderBackupsList()}</div>
            `)}

            ${settingsCard('Maintenance Mode', '🛠️', `
                <div class="form-group">
                    <label><input type="checkbox" id="setMaintenanceMode" ${s.maintenanceMode ? 'checked' : ''} style="width:auto;margin-right:8px;"> Enable maintenance mode</label>
                    <p style="color:var(--muted);font-size:12px;margin-top:4px;">When enabled, the public site and student portal show a maintenance message. The admin panel stays accessible so you can turn it back off.</p>
                </div>
                <div class="form-group"><label>Maintenance Message</label><textarea id="setMaintenanceMessage">${escapeHtml(s.maintenanceMessage)}</textarea></div>
                <button class="btn btn-gold" onclick="saveMaintenanceSettings()"><i class="fas fa-save"></i> Save</button>
            `)}

            ${settingsCard('Change My Password', '🔑', `
                <p style="color:var(--muted);font-size:12px;margin-bottom:12px;">Changes only your own login password. You'll stay logged in here, but any other devices/browsers where you're currently logged in will be signed out.</p>
                <div class="form-group"><label>Current Password</label><input type="password" id="setCurrentPassword" autocomplete="current-password"></div>
                <div class="form-group"><label>New Password</label><input type="password" id="setNewPassword" autocomplete="new-password" placeholder="At least 8 characters"></div>
                <div class="form-group"><label>Confirm New Password</label><input type="password" id="setConfirmPassword" autocomplete="new-password"></div>
                <button class="btn btn-gold" id="changePasswordBtn" onclick="changePassword()"><i class="fas fa-key"></i> Change Password</button>
            `)}

        </div>
    `;
}

function renderBackupsList() {
    if (!window._backups || window._backups.length === 0) {
        return '<div style="color:var(--muted);font-size:13px;">No backups yet.</div>';
    }
    return window._backups.map(b => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--card-border);">
            <span style="color:var(--white);font-size:13px;">${escapeHtml(b.name)}</span>
            <div>
                <span style="color:var(--muted);font-size:11px;margin-right:10px;">${new Date(b.createdAt).toLocaleString()}</span>
                <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--white);" onclick="restoreBackup('${b.name}')"><i class="fas fa-undo"></i> Restore</button>
                <button class="btn btn-danger btn-sm" onclick="deleteBackup('${b.name}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

async function saveInstituteSettings() {
    const body = {
        instituteName: document.getElementById('setInstituteName').value.trim(),
        academicSession: document.getElementById('setAcademicSession').value.trim(),
        passingCriteria: parseInt(document.getElementById('setPassingCriteria').value, 10) || 33
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify(body) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Institute details saved', 'success');
    loadSettings();
}

async function saveThemeColor() {
    const themeColor = document.getElementById('setThemeColor').value;
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ themeColor }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    document.documentElement.style.setProperty('--gold', themeColor);
    showToast('Success', 'Theme applied', 'success');
}

async function saveSocialLinks() {
    const socialLinks = {
        instagram: document.getElementById('setInstagram').value.trim(),
        googlePhotos: document.getElementById('setGooglePhotos').value.trim()
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ socialLinks }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Social links saved', 'success');
    loadSettings();
}

async function saveGoogleReviewsSettings() {
    const profileUrl = document.getElementById('setGoogleProfileUrl').value.trim();
    const ratingRaw = document.getElementById('setGoogleRating').value;
    const countRaw = document.getElementById('setGoogleReviewCount').value;
    const enabled = document.getElementById('setGoogleReviewsEnabled').checked;

    // Same host allow-list as the public widget (public/js/googleReviews.js)
    // — catch an obviously-wrong URL before it ever reaches the server.
    if (profileUrl && !/^https:\/\/((www\.)?google\.[a-z.]{2,24}\/maps\/|maps\.google\.[a-z.]{2,24}\/|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)/i.test(profileUrl)) {
        showToast('Error', 'Please paste a valid Google Maps URL (e.g. https://www.google.com/maps/place/...)', 'error');
        return;
    }
    if (enabled && !profileUrl) {
        showToast('Error', 'Add your Google Business Profile URL before enabling Google Reviews', 'error');
        return;
    }

    const googleReviews = {
        profileUrl,
        placeId: document.getElementById('setGooglePlaceId').value.trim(),
        rating: ratingRaw === '' ? null : Math.min(5, Math.max(0, parseFloat(ratingRaw))),
        reviewCount: countRaw === '' ? null : Math.max(0, parseInt(countRaw, 10) || 0),
        enabled,
        updatedAt: new Date().toISOString()
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ googleReviews }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Google Reviews settings saved', 'success');
    loadSettings();
}

async function saveEmailSettings() {
    const email = {
        host: document.getElementById('setEmailHost').value.trim(),
        port: parseInt(document.getElementById('setEmailPort').value, 10) || 587,
        user: document.getElementById('setEmailUser').value.trim(),
        pass: document.getElementById('setEmailPass').value,
        fromName: document.getElementById('setEmailFromName').value.trim(),
        fromAddress: document.getElementById('setEmailFromAddress').value.trim()
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ email }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Email settings saved', 'success');
}

async function sendTestEmail() {
    const to = prompt('Send a test email to:');
    if (!to) return;
    showToast('Info', 'Sending test email...', 'info');
    const result = await apiCall('/settings/test-email', { method: 'POST', body: JSON.stringify({ to }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send test email', 'error'); return; }
    showToast('Success', result.message, 'success');
}

// Diagnostic: checks whether outbound SMTP ports are network-reachable at
// all, independent of credentials. Distinguishes "hosting provider is
// blocking SMTP ports" from "your host/port/password is wrong".
async function testSmtpConnectivity() {
    showToast('Info', 'Testing network connectivity to SMTP ports...', 'info');
    const result = await apiCall('/settings/test-smtp-connectivity', { method: 'POST', body: JSON.stringify({}) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Connectivity test failed', 'error'); return; }
    const { probes, verdict } = result.data;
    const line = (label, p) => `${label}: ${p.ok ? '✅ reachable' : '❌ blocked/no response'} — ${p.detail} (${p.ms}ms)`;
    alert([
        line('Port 587', probes.smtp_587),
        line('Port 465', probes.smtp_465),
        line('Control — HTTPS 443', probes.control_https_443),
        '',
        verdict
    ].join('\n'));
    showToast(probes.smtp_587.ok || probes.smtp_465.ok ? 'Info' : 'Warning', verdict, probes.smtp_587.ok || probes.smtp_465.ok ? 'info' : 'error');
}

async function saveWhatsAppSettings() {
    const whatsapp = {
        accountSid: document.getElementById('setWaSid').value.trim(),
        authToken: document.getElementById('setWaToken').value,
        fromNumber: document.getElementById('setWaFrom').value.trim()
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ whatsapp }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'WhatsApp settings saved', 'success');
}

async function saveBackupSettings() {
    const backup = {
        autoBackupEnabled: document.getElementById('setAutoBackup').checked,
        schedule: document.getElementById('setBackupSchedule').value
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify({ backup }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', 'Backup settings saved', 'success');
}

async function createBackupNow() {
    showToast('Info', 'Creating backup...', 'info');
    const result = await apiCall('/settings/backup', { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Backup failed', 'error'); return; }
    showToast('Success', 'Backup created', 'success');
    loadSettings();
}

async function restoreBackup(name) {
    if (!confirm(`Restore backup "${name}"? A safety backup of the current state will be taken first. The server will need a restart to load restored data.`)) return;
    const result = await apiCall(`/settings/backups/${name}/restore`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Restore failed', 'error'); return; }
    showToast('Success', result.message, 'success');
}

async function deleteBackup(name) {
    if (!confirm(`Delete backup "${name}"? This cannot be undone.`)) return;
    const result = await apiCall(`/settings/backups/${name}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete backup', 'error'); return; }
    showToast('Success', 'Backup deleted', 'success');
    loadSettings();
}

async function saveMaintenanceSettings() {
    const body = {
        maintenanceMode: document.getElementById('setMaintenanceMode').checked,
        maintenanceMessage: document.getElementById('setMaintenanceMessage').value.trim()
    };
    const result = await apiCall('/settings', { method: 'PUT', body: JSON.stringify(body) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    showToast('Success', body.maintenanceMode ? 'Maintenance mode enabled' : 'Maintenance mode disabled', 'success');
    loadSettings();
}

async function changePassword() {
    const currentPassword = document.getElementById('setCurrentPassword').value;
    const newPassword = document.getElementById('setNewPassword').value;
    const confirmPassword = document.getElementById('setConfirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('Error', 'Please fill in all three password fields', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showToast('Error', 'New password and confirmation do not match', 'error');
        return;
    }
    if (newPassword.length < 8) {
        showToast('Error', 'New password must be at least 8 characters long', 'error');
        return;
    }

    const btn = document.getElementById('changePasswordBtn');
    btn.disabled = true;
    try {
        const result = await apiCall('/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        if (!result || !result.success) {
            showToast('Error', result?.message || 'Failed to change password', 'error');
            return;
        }
        document.getElementById('setCurrentPassword').value = '';
        document.getElementById('setNewPassword').value = '';
        document.getElementById('setConfirmPassword').value = '';
        showToast('Success', result.message || 'Password changed successfully', 'success');
    } finally {
        btn.disabled = false;
    }
}

async function uploadBrandingFile(kind) {
    const input = document.getElementById(kind === 'logo' ? 'setLogoFile' : 'setFaviconFile');
    const file = input.files[0];
    if (!file) { showToast('Error', 'Please choose a file', 'error'); return; }
    const formData = new FormData();
    formData.append(kind, file);
    try {
        const response = await fetch(`${API_BASE}/settings/${kind}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const result = await response.json();
        if (!result.success) { showToast('Error', result.message || 'Upload failed', 'error'); return; }
        showToast('Success', `${kind === 'logo' ? 'Logo' : 'Favicon'} updated`, 'success');
        loadSettings();
    } catch (error) {
        showToast('Error', error.message, 'error');
    }
}

async function showStudentProfile(id) {
    showLoading();
    try {
        const res = await apiCall(`/students/${id}/profile`);
        if (!res || !res.success) {
            showError('Failed to load profile', res?.message || 'Unknown error');
            return;
        }
        window._currentProfile = res.data;
        _timelineActiveFilter = null;
        window._currentProfileId = id;
        renderStudentProfile();
    } catch (error) {
        showError('Failed to load profile', error.message);
    }
}

function renderStudentProfile() {
    const p = window._currentProfile;
    const id = window._currentProfileId;
    const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>👨‍🎓 ${escapeHtml(p.personalDetails.name)} <span class="count">${escapeHtml(p.personalDetails.class)}</span></h2>
            <div>
                <button class="btn btn-success btn-sm" onclick="showEditProfileModal()"><i class="fas fa-edit"></i> Edit Details</button>
                <button class="btn" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--muted);" onclick="switchSection('students')"><i class="fas fa-arrow-left"></i> Back</button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom:16px;">
            <div class="stat-card">
                <span class="stat-icon">📊</span>
                <div class="stat-value">${p.averagePercentage !== null ? p.averagePercentage + '%' : 'N/A'}</div>
                <div class="stat-label">Average Score</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon">🏅</span>
                <div class="stat-value">${p.rank ? '#' + p.rank + ' / ' + p.classSize : 'N/A'}</div>
                <div class="stat-label">Class Rank</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon">📅</span>
                <div class="stat-value">${p.attendance.percentage !== null ? p.attendance.percentage + '%' : 'N/A'}</div>
                <div class="stat-label">Attendance</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon">⏳</span>
                <div class="stat-value">${money(p.feesHistory.filter(f => f.status !== 'Paid').reduce((s, f) => s + f.amount, 0))}</div>
                <div class="stat-label">Pending Fees</div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <strong style="color:var(--white);display:block;margin-bottom:10px;">👤 Personal Details</strong>
                <div style="color:var(--muted);font-size:13px;line-height:1.8;">
                    <div>Email: <span style="color:var(--white);">${escapeHtml(p.personalDetails.email)}</span></div>
                    <div>Phone: <span style="color:var(--white);">${escapeHtml(p.personalDetails.phone) || 'Not set'}</span></div>
                    <div>Roll No: <span style="color:var(--white);">${escapeHtml(p.personalDetails.rollNumber) || 'Not set'}</span></div>
                    <div>Batch: <span style="color:var(--white);">${escapeHtml(p.personalDetails.batch) || 'Not set'}</span></div>
                    <div>DOB: <span style="color:var(--white);">${escapeHtml(p.personalDetails.dob) || 'Not set'}</span></div>
                    <div>Address: <span style="color:var(--white);">${escapeHtml(p.personalDetails.address) || 'Not set'}</span></div>
                    <div>Joined: <span style="color:var(--white);">${new Date(p.personalDetails.joinedDate).toLocaleDateString()}</span></div>
                    <div>Status: <span class="status-badge ${p.personalDetails.isActive ? 'status-active' : 'status-inactive'}">${p.personalDetails.isActive ? 'Active' : 'Inactive'}</span></div>
                </div>
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <strong style="color:var(--white);display:block;margin-bottom:10px;">👨‍👩‍👦 Parent Details</strong>
                <div style="color:var(--muted);font-size:13px;line-height:1.8;">
                    <div>Name: <span style="color:var(--white);">${escapeHtml(p.parentDetails.parentName) || 'Not set'}</span></div>
                    <div>Phone: <span style="color:var(--white);">${escapeHtml(p.parentDetails.parentPhone) || 'Not set'}</span></div>
                    <div>Email: <span style="color:var(--white);">${escapeHtml(p.parentDetails.parentEmail) || 'Not set'}</span></div>
                    <div>Occupation: <span style="color:var(--white);">${escapeHtml(p.parentDetails.parentOccupation) || 'Not set'}</span></div>
                </div>
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <strong style="color:var(--white);display:block;margin-bottom:10px;">⚠️ Weak Subjects</strong>
                ${p.weakSubjects.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No weak subjects identified yet.</div>' :
                    p.weakSubjects.map(w => `
                        <div style="padding:6px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                            <span style="color:var(--white);font-size:13px;">${escapeHtml(w.subject)}</span>
                            <span style="color:#ef4444;font-weight:600;font-size:13px;">${w.averageScore}%</span>
                        </div>
                    `).join('')}
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <strong style="color:var(--white);display:block;margin-bottom:10px;">📝 Test Results</strong>
                ${p.testResults.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No test attempts yet.</div>' :
                    p.testResults.slice(0, 6).map(r => `
                        <div style="padding:6px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                            <span style="color:var(--white);font-size:13px;">${escapeHtml(r.testTitle)}</span>
                            <span style="color:${r.isPassed ? '#22c55e' : '#ef4444'};font-weight:600;font-size:13px;">${r.percentage}%</span>
                        </div>
                    `).join('')}
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <strong style="color:var(--white);display:block;margin-bottom:10px;">💰 Fees History</strong>
                ${p.feesHistory.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No fee records yet.</div>' :
                    p.feesHistory.map(f => `
                        <div style="padding:6px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                            <span style="color:var(--white);font-size:13px;">${escapeHtml(f.description || 'Fee')} — ${money(f.amount)}</span>
                            <span class="status-badge ${f.status === 'Paid' ? 'status-active' : 'status-inactive'}">${escapeHtml(f.status)}</span>
                        </div>
                    `).join('')}
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <strong style="color:var(--white);">🗒️ Notes</strong>
                    <button class="btn btn-gold" style="padding:4px 10px;font-size:12px;" onclick="showAddNoteModal()">+ Add</button>
                </div>
                ${p.notes.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No notes yet.</div>' :
                    p.notes.map(n => `
                        <div style="padding:6px 0;border-bottom:1px solid var(--card-border);">
                            <div style="color:var(--white);font-size:13px;">${escapeHtml(n.note)}</div>
                            <div style="color:var(--muted);font-size:11px;">${new Date(n.createdAt).toLocaleString()}</div>
                        </div>
                    `).join('')}
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <strong style="color:var(--white);">📁 Documents</strong>
                    <button class="btn btn-gold" style="padding:4px 10px;font-size:12px;" onclick="showUploadDocumentModal()">+ Upload</button>
                </div>
                ${p.documents.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No documents uploaded yet.</div>' :
                    p.documents.map(d => `
                        <div style="padding:6px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;align-items:center;">
                            <span style="color:var(--white);font-size:13px;"><i class="fas fa-file"></i> ${escapeHtml(d.name)}</span>
                            <div>
                                <button class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--muted);" onclick="downloadStudentDocument('${d._id}', '${escapeHtml(d.originalName)}')"><i class="fas fa-download"></i></button>
                                <button class="btn btn-danger btn-sm" onclick="deleteStudentDocument('${d._id}')"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
            </div>

            <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;grid-column:span 2;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <strong style="color:var(--white);">🕒 Student Timeline</strong>
                    <div id="timelineFilters" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                </div>
                <div id="timelineContainer"></div>
            </div>
        </div>
    `;
    renderStudentTimeline(p.timeline || []);
}

const TIMELINE_TYPE_LABELS = {
    admission: 'Admission',
    attendance: 'Attendance',
    fee: 'Fee Payments',
    test: 'Tests',
    result: 'Results',
    certificate: 'Certificates',
    notification: 'Notifications',
};
let _timelineActiveFilter = null;

function renderStudentTimeline(events) {
    window._timelineEvents = events;
    const filtersEl = document.getElementById('timelineFilters');
    const typesPresent = Object.keys(TIMELINE_TYPE_LABELS).filter(t => t === 'certificate' || events.some(e => e.type === t));
    filtersEl.innerHTML = typesPresent.map(t => `
        <button class="btn btn-sm" style="${_timelineActiveFilter === t ? 'background:var(--gold);color:#fff;' : ''}" onclick="filterStudentTimeline('${t}')">${TIMELINE_TYPE_LABELS[t]}</button>
    `).join('') + `<button class="btn btn-sm" onclick="filterStudentTimeline(null)">All</button>`;

    const container = document.getElementById('timelineContainer');
    const filtered = _timelineActiveFilter ? events.filter(e => e.type === _timelineActiveFilter) : events;

    if (_timelineActiveFilter === 'certificate') {
        container.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">No certificate-issuance feature exists yet — this project doesn't track certificates as real data. Ask if you'd like this built (a certificate record + an "Issue Certificate" admin action would show up here).</div>`;
        return;
    }
    if (filtered.length === 0) {
        container.innerHTML = `<div style="color:var(--muted);font-size:13px;">No activity yet.</div>`;
        return;
    }
    container.innerHTML = `
        <div style="position:relative;padding-left:22px;">
            <div style="position:absolute;left:6px;top:4px;bottom:4px;width:2px;background:var(--card-border);"></div>
            ${filtered.map(e => `
                <div style="position:relative;padding:8px 0 8px 14px;">
                    <div style="position:absolute;left:-19px;top:11px;width:11px;height:11px;border-radius:50%;background:var(--dark-bg);border:2px solid var(--gold);"></div>
                    <div style="color:var(--white);font-size:13px;">${e.icon || ''} ${escapeHtml(e.title)}</div>
                    ${e.subtitle ? `<div style="color:var(--muted);font-size:12px;">${escapeHtml(e.subtitle)}</div>` : ''}
                    <div style="color:var(--muted);font-size:11px;">${new Date(e.date).toLocaleString()}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function filterStudentTimeline(type) {
    _timelineActiveFilter = type;
    renderStudentTimeline(window._timelineEvents || []);
}

function showEditProfileModal() {
    const p = window._currentProfile;
    showModal('Edit Student Details', 'Update personal and parent details', `
        <div class="form-group"><label>Phone</label><input type="text" id="editPhone" value="${escapeHtml(p.personalDetails.phone)}"></div>
        <div class="form-group"><label>Date of Birth</label><input type="date" id="editDob" value="${escapeHtml(p.personalDetails.dob)}"></div>
        <div class="form-group"><label>Roll Number</label><input type="text" id="editRollNumber" value="${escapeHtml(p.personalDetails.rollNumber)}"></div>
        <div class="form-group"><label>Batch <span style="color:var(--muted);font-weight:400;">(e.g., Morning, Evening — used for Communication targeting)</span></label><input type="text" id="editBatch" value="${escapeHtml(p.personalDetails.batch || '')}" placeholder="e.g., Morning Batch"></div>
        <div class="form-group"><label>Address</label><textarea id="editAddress">${escapeHtml(p.personalDetails.address)}</textarea></div>
        <div class="form-group"><label>Parent Name</label><input type="text" id="editParentName" value="${escapeHtml(p.parentDetails.parentName)}"></div>
        <div class="form-group"><label>Parent Phone</label><input type="text" id="editParentPhone" value="${escapeHtml(p.parentDetails.parentPhone)}"></div>
        <div class="form-group"><label>Parent Email</label><input type="text" id="editParentEmail" value="${escapeHtml(p.parentDetails.parentEmail)}"></div>
        <div class="form-group"><label>Parent Occupation</label><input type="text" id="editParentOccupation" value="${escapeHtml(p.parentDetails.parentOccupation)}"></div>
    `, async () => {
        const body = {
            phone: document.getElementById('editPhone').value.trim(),
            dob: document.getElementById('editDob').value.trim(),
            rollNumber: document.getElementById('editRollNumber').value.trim(),
            batch: document.getElementById('editBatch').value.trim(),
            address: document.getElementById('editAddress').value.trim(),
            parentName: document.getElementById('editParentName').value.trim(),
            parentPhone: document.getElementById('editParentPhone').value.trim(),
            parentEmail: document.getElementById('editParentEmail').value.trim(),
            parentOccupation: document.getElementById('editParentOccupation').value.trim()
        };
        const result = await apiCall(`/students/${window._currentProfileId}/profile`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update profile', 'error'); return; }
        showToast('Success', 'Profile updated', 'success');
        closeModal();
        showStudentProfile(window._currentProfileId);
    });
}

function showAddNoteModal() {
    showModal('Add Note', 'Private remark about this student — only visible to admins', `
        <div class="form-group"><label>Note *</label><textarea id="newNoteText" placeholder="e.g., Needs extra support in Mathematics"></textarea></div>
    `, async () => {
        const note = document.getElementById('newNoteText').value.trim();
        if (!note) { showToast('Error', 'Note text is required', 'error'); return; }
        const result = await apiCall(`/students/${window._currentProfileId}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add note', 'error'); return; }
        showToast('Success', 'Note added', 'success');
        closeModal();
        showStudentProfile(window._currentProfileId);
    });
}

function showUploadDocumentModal() {
    showModal('Upload Document', 'ID proof, certificate, or any other student document', `
        <div class="form-group"><label>Document Name</label><input type="text" id="docName" placeholder="e.g., Birth Certificate"></div>
        <div class="form-group"><label>File *</label><input type="file" id="docFile"></div>
    `, async () => {
        const file = document.getElementById('docFile').files[0];
        if (!file) { showToast('Error', 'Please choose a file', 'error'); return; }
        const formData = new FormData();
        formData.append('document', file);
        formData.append('name', document.getElementById('docName').value.trim() || file.name);
        try {
            const response = await fetch(`${API_BASE}/students/${window._currentProfileId}/documents`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const result = await response.json();
            if (!result.success) { showToast('Error', result.message || 'Upload failed', 'error'); return; }
            showToast('Success', 'Document uploaded', 'success');
            closeModal();
            showStudentProfile(window._currentProfileId);
        } catch (error) {
            showToast('Error', error.message, 'error');
        }
    });
}

async function downloadStudentDocument(docId, filename) {
    try {
        const response = await fetch(`${API_BASE}/students/${window._currentProfileId}/documents/${docId}/download`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) { showToast('Error', 'Download failed', 'error'); return; }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        showToast('Error', error.message, 'error');
    }
}

async function deleteStudentDocument(docId) {
    if (!confirm('Delete this document?')) return;
    const result = await apiCall(`/students/${window._currentProfileId}/documents/${docId}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete document', 'error'); return; }
    showToast('Success', 'Document deleted', 'success');
    showStudentProfile(window._currentProfileId);
}