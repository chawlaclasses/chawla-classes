// public/admin/js/app-download.js
//
// Admin -> App Download. Lets the admin:
//   - upload the student app's APK (stored in R2, served via /download-app)
//     OR paste an external link (Play Store / Drive / any URL),
//   - edit the button text and the footer text,
//   - choose where the button shows on the public website
//     (header, mobile menu, footer, floating button),
//   - copy the permanent /download-app link to use anywhere else.
//
// Backend: routes/admin/app-download.js (GET/PUT /api/admin/app-download,
// POST /upload, DELETE /file). Public side: routes/appDownload.js +
// public/js/app-download.js.

window._appDownload = window._appDownload || null;

async function loadAppDownload() {
    contentArea.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const res = await apiCall('/app-download');
        if (!res || !res.success) throw new Error(res?.message || 'Failed');
        window._appDownload = res.data;
        renderAppDownload();
    } catch (e) {
        contentArea.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><strong>Failed to load App Download settings</strong></div>`;
    }
}

function _adFormatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function renderAppDownload() {
    const s = window._appDownload || {};
    const p = s.placements || {};
    const canEdit = hasPermission('footer:edit');
    const dis = canEdit ? '' : 'disabled';
    const file = s.file;
    const publicLink = `${location.origin}/download-app`;
    const card = 'background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius);padding:18px;';
    const toggle = (id, checked, title, hint) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--card-border);">
            <div><div style="font-size:13px;font-weight:600;">${title}</div><div style="font-size:11.5px;color:var(--muted);">${hint}</div></div>
            <label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${dis}><span class="toggle-slider"></span></label>
        </div>`;

    contentArea.innerHTML = `
        <div class="toolbar"><h2>🔘 Download Buttons</h2></div>
        <p style="font-size:12.5px;color:var(--muted);margin:-6px 0 14px;max-width:700px;">
            Website par download button kahan dikhe (header / mobile menu / footer / floating) yahan chuno. App ka version,
            APK link aur homepage banner <b>Mobile App</b> section me hai.
            Changes saare public pages par turant live ho jaate hain.
        </p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;">

            <div class="card" style="${card}">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-file-upload" style="color:var(--gold);"></i> 1. App file / link</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">Button dabane par visitor ko yahi file ya link milega.</p>

                <div class="form-group">
                    <label>Download source</label>
                    <select id="adSource" ${dis} onchange="adToggleSource()">
                        <option value="upload" ${s.source === 'upload' ? 'selected' : ''}>Uploaded APK file</option>
                        <option value="link" ${s.source !== 'upload' ? 'selected' : ''}>External link (Play Store / other URL)</option>
                    </select>
                </div>

                <div id="adUploadBox" style="display:${s.source === 'upload' ? 'block' : 'none'};">
                    ${file ? `
                        <div style="border:1px solid var(--card-border);border-radius:10px;padding:12px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                            <i class="fab fa-android" style="font-size:28px;color:#3ddc84;"></i>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:600;font-size:13px;word-break:break-all;">${escapeHtml(file.name)}</div>
                                <div style="font-size:11.5px;color:var(--muted);">${_adFormatSize(file.size)} · uploaded ${file.uploadedAt ? new Date(file.uploadedAt).toLocaleString() : ''}</div>
                            </div>
                            ${canEdit ? `<button class="btn btn-danger btn-sm" onclick="adRemoveFile()"><i class="fas fa-trash"></i> Remove</button>` : ''}
                        </div>` : `
                        <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;">Abhi koi APK upload nahi hui.</div>`}
                    ${canEdit ? `
                    <div class="form-group">
                        <label>${file ? 'Replace APK (.apk)' : 'Upload APK (.apk)'}</label>
                        <input type="file" id="adApkFile" accept=".apk,application/vnd.android.package-archive">
                    </div>
                    <div class="form-group">
                        <label>App version (optional)</label>
                        <input type="text" id="adUploadVersion" value="${escapeHtml(s.versionLabel || '')}" maxlength="20" placeholder="1.0.1">
                    </div>
                    <div id="adProgressWrap" style="display:none;margin-bottom:10px;">
                        <div style="height:8px;background:var(--card-border);border-radius:99px;overflow:hidden;"><div id="adProgressBar" style="height:100%;width:0;background:var(--gold);transition:width .2s;"></div></div>
                        <div id="adProgressText" style="font-size:11.5px;color:var(--muted);margin-top:4px;"></div>
                    </div>
                    <button class="btn btn-gold btn-sm" id="adUploadBtn" onclick="adUploadApk()"><i class="fas fa-upload"></i> Upload APK</button>` : ''}
                </div>

                <div id="adLinkBox" style="display:${s.source === 'upload' ? 'none' : 'block'};">
                    <div class="form-group">
                        <label>Download link</label>
                        <input type="url" id="adExternalUrl" value="${escapeHtml(s.externalUrl || '')}" maxlength="500" placeholder="https://play.google.com/store/apps/details?id=com.chawlaclasses.student" ${dis}>
                        <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">Khali chhodoge to Play Store wala default link khulega.</div>
                    </div>
                </div>
            </div>

            <div class="card" style="${card}">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-eye" style="color:var(--gold);"></i> 2. Kahan dikhana hai</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 6px;">Jo chaho on karo — ek, kuch ya sab jagah.</p>
                ${toggle('adEnabled', s.enabled, 'Download button (master switch)', 'Off karne par website se sab jagah se hat jayega')}
                ${toggle('adPlHeader', p.header, 'Header', 'Desktop navbar me Login ke baad')}
                ${toggle('adPlMobile', p.mobileMenu, 'Mobile menu', 'Phone ke hamburger menu ke andar')}
                ${toggle('adPlFooter', p.footer, 'Footer', 'Har page ke footer me app strip')}
                ${toggle('adPlFloating', p.floating, 'Floating button', 'Screen ke bottom-left corner me tairta hua button')}

                <div class="form-group" style="margin-top:14px;">
                    <label>Button text</label>
                    <input type="text" id="adButtonLabel" value="${escapeHtml(s.buttonLabel || 'Get App')}" maxlength="40" ${dis}>
                </div>
                <div class="form-group">
                    <label>Footer text</label>
                    <input type="text" id="adFooterText" value="${escapeHtml(s.footerText || '')}" maxlength="100" placeholder="Chawla Classes Student App" ${dis}>
                </div>
                ${canEdit ? `<button class="btn btn-gold btn-sm" onclick="adSaveSettings()"><i class="fas fa-save"></i> Save settings</button>` : ''}
            </div>

            <div class="card" style="${card}">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-link" style="color:var(--gold);"></i> 3. Kahin bhi use karo</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 12px;">
                    Ye link kabhi nahi badalta. Naya APK upload karne par bhi yahi link chalega. Ise Website Builder ke button,
                    WhatsApp message, poster ke QR code — kahin bhi laga sakte ho.
                </p>
                <div style="display:flex;gap:8px;">
                    <input type="text" id="adPublicLink" value="${escapeHtml(publicLink)}" readonly style="flex:1;">
                    <button class="btn btn-gold btn-sm" onclick="adCopyLink()"><i class="fas fa-copy"></i> Copy</button>
                </div>
                <div style="font-size:12px;color:var(--muted);margin-top:14px;">
                    <i class="fas fa-chart-bar"></i> Total downloads: <strong>${Number(s.downloadCount || 0)}</strong>
                </div>
            </div>

        </div>
    `;
}

function adToggleSource() {
    const v = document.getElementById('adSource').value;
    document.getElementById('adUploadBox').style.display = v === 'upload' ? 'block' : 'none';
    document.getElementById('adLinkBox').style.display = v === 'upload' ? 'none' : 'block';
}

function adCopyLink() {
    const el = document.getElementById('adPublicLink');
    el.select();
    const done = () => showToast('Success', 'Link copied', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).then(done, () => { document.execCommand('copy'); done(); });
    } else { document.execCommand('copy'); done(); }
}

async function adSaveSettings() {
    const source = document.getElementById('adSource').value;
    const patch = {
        enabled: document.getElementById('adEnabled').checked,
        source,
        externalUrl: document.getElementById('adExternalUrl').value.trim(),
        buttonLabel: document.getElementById('adButtonLabel').value.trim(),
        footerText: document.getElementById('adFooterText').value.trim(),
        placements: {
            header: document.getElementById('adPlHeader').checked,
            mobileMenu: document.getElementById('adPlMobile').checked,
            footer: document.getElementById('adPlFooter').checked,
            floating: document.getElementById('adPlFloating').checked,
        },
    };
    const versionEl = document.getElementById('adUploadVersion');
    if (versionEl) patch.versionLabel = versionEl.value.trim();

    const result = await apiCall('/app-download', { method: 'PUT', body: JSON.stringify(patch) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
    window._appDownload = result.data;
    showToast('Success', 'Saved — website par live ho gaya', 'success');
    renderAppDownload();
}

function adUploadApk() {
    const input = document.getElementById('adApkFile');
    const file = input && input.files && input.files[0];
    if (!file) { showToast('Error', 'Pehle .apk file chuno', 'error'); return; }
    if (!/\.apk$/i.test(file.name)) { showToast('Error', 'Sirf .apk file upload ho sakti hai', 'error'); return; }

    const fd = new FormData();
    fd.append('apk', file);
    const v = (document.getElementById('adUploadVersion').value || '').trim();
    if (v) fd.append('versionLabel', v);

    const btn = document.getElementById('adUploadBtn');
    const wrap = document.getElementById('adProgressWrap');
    const bar = document.getElementById('adProgressBar');
    const txt = document.getElementById('adProgressText');
    btn.disabled = true;
    wrap.style.display = 'block';
    bar.style.width = '0';
    txt.textContent = 'Uploading...';

    // XHR (not fetch) so a 100MB+ APK can show real upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/app-download/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        txt.textContent = pct < 100
            ? `Uploading... ${pct}% (${_adFormatSize(e.loaded)} / ${_adFormatSize(e.total)})`
            : 'Processing on server...';
    };
    xhr.onerror = () => {
        btn.disabled = false; wrap.style.display = 'none';
        showToast('Error', 'Upload fail ho gaya. Internet check karke dobara try karo.', 'error');
    };
    xhr.onload = async () => {
        btn.disabled = false;
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON error page */ }
        if (xhr.status === 401) { localStorage.removeItem('adminToken'); location.href = '/admin/login.html'; return; }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.success) {
            window._appDownload = data.data;
            showToast('Success', 'APK upload ho gayi', 'success');
            // Uploaded file only matters if source is 'upload' (server already switched it) —
            // make sure the button is live too if it was off.
            renderAppDownload();
        } else {
            wrap.style.display = 'none';
            showToast('Error', (data && data.message) || `Upload failed (${xhr.status})`, 'error');
        }
    };
    xhr.send(fd);
}

async function adRemoveFile() {
    if (!confirm('Uploaded APK hata den? Jab tak nayi APK ya link nahi doge, button Play Store link par jayega.')) return;
    const result = await apiCall('/app-download/file', { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to remove', 'error'); return; }
    window._appDownload = result.data;
    showToast('Success', 'APK hata di gayi', 'success');
    renderAppDownload();
}

window.loadAppDownload = loadAppDownload;
