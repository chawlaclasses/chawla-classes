// public/admin/js/profile-form.js
//
// Shared helpers for the Edit Student / Edit Staff modals (students.js,
// settings.js → showEditProfileModal, staff.js):
//   * "(Optional)" labels and grouped form sections
//   * email format check that only applies when an email is actually entered
//   * profile photo picker: preview, choose / remove, upload via the
//     authenticated photo endpoints (photos are private — they are fetched
//     with the admin token and shown from a blob URL, never a public link)
//
// Classic global-scope script (like the rest of /admin/js) so inline
// onclick="..." handlers can reach these functions.

const PROFILE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/** Blank email is valid; a non-blank email must be well-formed. */
function isValidOptionalEmail(value) {
    const v = (value || '').trim();
    return v === '' || PROFILE_EMAIL_RE.test(v);
}

/** " (Optional)" tag for a field label. */
function optionalTag() {
    return ' <span class="opt-tag">(Optional)</span>';
}

/** Section wrapper used to group fields inside a modal. */
function formSection(title, innerHtml) {
    return `<div class="form-section"><div class="form-section-title">${title}</div>${innerHtml}</div>`;
}

function profileInitial(name) {
    return escapeHtml(((name || '?').trim()[0] || '?').toUpperCase());
}

/**
 * Photo picker markup. `prefix` namespaces the element ids so two pickers can
 * never clash. Call initProfilePhoto() after showModal() to load the current photo.
 */
function profilePhotoFieldHtml(prefix, name) {
    return `
        <div class="photo-field" id="${prefix}PhotoField" data-remove="0">
            <div class="photo-preview">
                <img id="${prefix}PhotoImg" alt="Profile photo" style="display:none;">
                <span id="${prefix}PhotoInitial">${profileInitial(name)}</span>
            </div>
            <div class="photo-actions">
                <label>Profile Photo${optionalTag()}</label>
                <div class="photo-buttons">
                    <button type="button" class="btn btn-sm" style="background:var(--card-bg);border:1px solid var(--card-border);color:var(--text);" onclick="document.getElementById('${prefix}PhotoInput').click()"><i class="fas fa-camera"></i> Choose photo</button>
                    <button type="button" class="btn btn-sm" id="${prefix}PhotoRemoveBtn" style="display:none;background:rgba(239,68,68,0.12);color:#dc2626;border:none;" onclick="removeProfilePhoto('${prefix}')"><i class="fas fa-trash"></i> Remove</button>
                </div>
                <input type="file" id="${prefix}PhotoInput" accept="image/png,image/jpeg" style="display:none;" onchange="onProfilePhotoPicked('${prefix}')">
                <div class="photo-hint">PNG or JPG, up to 3 MB.</div>
            </div>
        </div>`;
}

function _setPhotoPreview(prefix, src) {
    const img = document.getElementById(`${prefix}PhotoImg`);
    const initial = document.getElementById(`${prefix}PhotoInitial`);
    const removeBtn = document.getElementById(`${prefix}PhotoRemoveBtn`);
    if (!img || !initial) return;
    if (src) {
        img.src = src;
        img.style.display = '';
        initial.style.display = 'none';
        if (removeBtn) removeBtn.style.display = '';
    } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        initial.style.display = '';
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

/** Fetches a private photo with the admin token and returns a blob: URL (or null). */
async function fetchProfilePhotoUrl(photoEndpoint) {
    try {
        const response = await fetch(`${API_BASE}${photoEndpoint}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!response.ok) return null;
        return URL.createObjectURL(await response.blob());
    } catch (e) {
        return null;
    }
}

/** Loads the person's current photo (if any) into the picker. */
async function initProfilePhoto(prefix, photoEndpoint, hasPhoto) {
    if (!hasPhoto) return;
    const url = await fetchProfilePhotoUrl(photoEndpoint);
    // The modal may have been closed/replaced while the request was in flight.
    if (url && document.getElementById(`${prefix}PhotoImg`)) _setPhotoPreview(prefix, url);
}

function onProfilePhotoPicked(prefix) {
    const input = document.getElementById(`${prefix}PhotoInput`);
    const file = input && input.files && input.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
        showToast('Error', 'Profile photo must be a PNG or JPG image', 'error');
        input.value = '';
        return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
        showToast('Error', 'Photo is too large (max 3 MB)', 'error');
        input.value = '';
        return;
    }
    document.getElementById(`${prefix}PhotoField`).dataset.remove = '0';
    _setPhotoPreview(prefix, URL.createObjectURL(file));
}

function removeProfilePhoto(prefix) {
    const input = document.getElementById(`${prefix}PhotoInput`);
    if (input) input.value = '';
    document.getElementById(`${prefix}PhotoField`).dataset.remove = '1';
    _setPhotoPreview(prefix, null);
}

/**
 * Applies whatever the admin did with the photo picker (new file → upload,
 * "Remove" → delete, nothing → no-op). Returns { ok, message }. Never throws.
 */
async function applyProfilePhotoChange(prefix, photoEndpoint) {
    const field = document.getElementById(`${prefix}PhotoField`);
    const input = document.getElementById(`${prefix}PhotoInput`);
    if (!field) return { ok: true };
    try {
        const file = input && input.files && input.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('photo', file);
            const response = await fetch(`${API_BASE}${photoEndpoint}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
            const result = await response.json().catch(() => ({}));
            return result.success ? { ok: true } : { ok: false, message: result.message || 'Photo upload failed' };
        }
        if (field.dataset.remove === '1') {
            const response = await fetch(`${API_BASE}${photoEndpoint}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            const result = await response.json().catch(() => ({}));
            return result.success ? { ok: true } : { ok: false, message: result.message || 'Could not remove photo' };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, message: e.message || 'Photo upload failed' };
    }
}
