// public/admin/js/mobile-app.js
//
// Admin -> System -> Mobile App. Manages the single mobile_app_settings
// document: app name / version / APK link / release notes, the Force
// Update switch, and the homepage download banner (with live preview).
//
// Backend: routes/admin/mobile-app.js (GET/PUT /api/admin/mobile-app),
// admin/super_admin only. Consumers: GET /api/mobile-app (website banner),
// GET /api/mobile-app/version (Flutter update check).

window._mobileApp = window._mobileApp || null;

async function loadMobileApp() {
    contentArea.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;
    try {
        const res = await apiCall('/mobile-app');
        if (!res || !res.success) throw new Error(res?.message || 'Failed');
        window._mobileApp = res.data;
        renderMobileApp();
    } catch (e) {
        contentArea.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><strong>Failed to load Mobile App settings</strong></div>`;
    }
}

function renderMobileApp() {
    const s = window._mobileApp || {};
    const canEdit = hasPermission('mobile_app:edit');
    const dis = canEdit ? '' : 'disabled';
    const card = 'background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius);padding:18px;';
    const sw = (id, checked, title, hint) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;">
            <div><div style="font-size:13px;font-weight:600;">${title}</div><div style="font-size:11.5px;color:var(--muted);max-width:340px;">${hint}</div></div>
            <label class="toggle-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${dis} onchange="maUpdatePreview()"><span class="toggle-slider"></span></label>
        </div>`;

    contentArea.innerHTML = `
        <div class="toolbar"><h2>📱 Mobile App</h2></div>
        <p style="font-size:12.5px;color:var(--muted);margin:-6px 0 14px;max-width:720px;">
            Student app ka version, APK link aur website ka download banner yahan se control hota hai.
            Save karte hi app ka update-check aur website dono naye settings use karne lagte hain.
        </p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;">

            <div class="card" style="${card}">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fab fa-android" style="color:#3ddc84;"></i> App details</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 14px;">Naya APK release karte time yahan version badlo.</p>
                <div class="form-group"><label>App Name</label>
                    <input type="text" id="maAppName" value="${escapeHtml(s.appName || '')}" maxlength="80" ${dis}></div>
                <div class="form-group"><label>App Version</label>
                    <input type="text" id="maVersion" value="${escapeHtml(s.version || '')}" maxlength="20" placeholder="1.0.0" ${dis}>
                    <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">Ye <code>pubspec.yaml</code> ke <code>version</code> (+ se pehle wala hissa) se match hona chahiye. Isse chhote version wale users ko update dikhega.</div></div>
                <div class="form-group"><label>APK Download URL</label>
                    <input type="url" id="maApkUrl" value="${escapeHtml(s.apkUrl || '')}" maxlength="500" placeholder="https://.../app-release.apk" ${dis}>
                    <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">Sirf <b>https://</b> link (app me http allowed nahi hai).
                        <a href="${escapeHtml(s.apkUrl || '#')}" target="_blank" rel="noopener" id="maTestLink">Link test karo</a></div></div>
                <div class="form-group"><label>Release Notes</label>
                    <textarea id="maNotes" rows="4" maxlength="1000" placeholder="Bug fixes and improvements" ${dis}>${escapeHtml(s.releaseNotes || '')}</textarea></div>
                ${sw('maForce', s.forceUpdate, 'Force Update', 'ON hone par purane version wale users app tab tak use nahi kar paayenge jab tak update na kar lein. Sirf critical fix par ON karo.')}
            </div>

            <div class="card" style="${card}">
                <h3 style="margin:0 0 4px;font-size:14.5px;"><i class="fas fa-bullhorn" style="color:var(--gold);"></i> Website download banner</h3>
                <p style="font-size:11.5px;color:var(--muted);margin:0 0 6px;">Homepage par app download section.</p>
                ${sw('maShowBanner', s.showBanner, 'Show Download Banner on Website', 'OFF karne par homepage se banner hat jayega.')}
                <div class="form-group"><label>Banner Title</label>
                    <input type="text" id="maBannerTitle" value="${escapeHtml(s.bannerTitle || '')}" maxlength="100" oninput="maUpdatePreview()" ${dis}></div>
                <div class="form-group"><label>Banner Description</label>
                    <textarea id="maBannerDesc" rows="3" maxlength="300" oninput="maUpdatePreview()" ${dis}>${escapeHtml(s.bannerDescription || '')}</textarea></div>
                <div class="form-group"><label>Banner Button Text</label>
                    <input type="text" id="maButtonText" value="${escapeHtml(s.buttonText || '')}" maxlength="30" oninput="maUpdatePreview()" ${dis}></div>

                <div style="font-size:11.5px;color:var(--muted);margin:14px 0 6px;">Preview</div>
                <div id="maPreview" style="border:1px dashed var(--card-border);border-radius:14px;padding:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                    <img src="/images/app-icon.png" alt="" width="52" height="52" style="border-radius:12px;">
                    <div style="flex:1;min-width:160px;">
                        <div id="maPvTitle" style="font-weight:700;font-size:14px;"></div>
                        <div id="maPvDesc" style="font-size:12px;color:var(--muted);margin-top:2px;"></div>
                    </div>
                    <span id="maPvBtn" style="background:linear-gradient(135deg,#ffc400,#f5a623);color:#081b36;font-weight:700;font-size:12.5px;padding:8px 16px;border-radius:999px;"></span>
                </div>
                <div id="maPvOff" style="display:none;font-size:12px;color:#dc2626;margin-top:6px;">Banner abhi OFF hai — website par nahi dikhega.</div>
            </div>
        </div>

        <div style="margin-top:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
            ${canEdit ? `<button class="btn btn-gold" id="maSaveBtn" onclick="maSave()"><i class="fas fa-save"></i> Save Mobile App settings</button>` : '<span style="font-size:12px;color:var(--muted);">Sirf dekhne ki permission hai.</span>'}
            <span style="font-size:11.5px;color:var(--muted);">${s.updatedAt ? 'Last updated: ' + new Date(s.updatedAt).toLocaleString() + (s.updatedBy ? ' by ' + escapeHtml(String(s.updatedBy)) : '') : ''}</span>
        </div>

        <div class="card" style="${card}margin-top:16px;">
            <h3 style="margin:0 0 8px;font-size:14px;"><i class="fas fa-plug" style="color:var(--gold);"></i> API endpoints (public)</h3>
            <div style="font-size:12.5px;line-height:1.9;">
                <code>${location.origin}/api/mobile-app</code> — saari settings<br>
                <code>${location.origin}/api/mobile-app/version</code> — app ka update check
            </div>
        </div>
    `;
    maUpdatePreview();
}

function maUpdatePreview() {
    const g = (id) => document.getElementById(id);
    if (!g('maPvTitle')) return;
    g('maPvTitle').textContent = g('maBannerTitle').value || '—';
    g('maPvDesc').textContent = g('maBannerDesc').value || '';
    g('maPvBtn').textContent = g('maButtonText').value || 'Download App';
    const on = g('maShowBanner').checked;
    g('maPreview').style.opacity = on ? '1' : '.45';
    g('maPvOff').style.display = on ? 'none' : 'block';
}

async function maSave() {
    const g = (id) => document.getElementById(id);
    const version = g('maVersion').value.trim();
    const apkUrl = g('maApkUrl').value.trim();
    if (!/^\d+(\.\d+){1,3}$/.test(version)) { showToast('Error', 'Version aisa hona chahiye: 1.0.0', 'error'); return; }
    if (!/^https:\/\//i.test(apkUrl)) { showToast('Error', 'APK URL https:// se shuru hona chahiye', 'error'); return; }
    if (!g('maAppName').value.trim() || !g('maButtonText').value.trim()) { showToast('Error', 'App name aur button text khali nahi ho sakte', 'error'); return; }

    const forceOn = g('maForce').checked;
    if (forceOn && !(window._mobileApp && window._mobileApp.forceUpdate) &&
        !confirm('Force Update ON karne par purane version wale sab users update hone tak app use nahi kar paayenge. Pakka ON karna hai?')) return;

    const body = {
        appName: g('maAppName').value.trim(),
        version,
        apkUrl,
        releaseNotes: g('maNotes').value.trim(),
        forceUpdate: forceOn,
        showBanner: g('maShowBanner').checked,
        bannerTitle: g('maBannerTitle').value.trim(),
        bannerDescription: g('maBannerDesc').value.trim(),
        buttonText: g('maButtonText').value.trim(),
    };
    const btn = g('maSaveBtn');
    btn.disabled = true;
    const result = await apiCall('/mobile-app', { method: 'PUT', body: JSON.stringify(body) });
    btn.disabled = false;
    if (!result || !result.success) { showToast('Error', result?.message || 'Save nahi hua', 'error'); return; }
    window._mobileApp = result.data;
    showToast('Success', 'Mobile App settings save ho gayi', 'success');
    renderMobileApp();
}

window.loadMobileApp = loadMobileApp;
