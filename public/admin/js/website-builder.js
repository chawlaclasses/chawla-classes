// public/admin/js/website-builder.js
//
// "Website Builder" — GoDaddy/Wix-style homepage section library.
// STRICTLY form-based: every field below is a plain text/number/file
// input. There is no HTML/rich-text/code field anywhere in this file,
// by design (see routes/admin/website-sections.js's header comment).
//
// Flow: Add Section -> pick a TYPE from the picker grid -> fill its fixed
// form -> Save. Existing sections list with reorder (up/down)/edit/
// hide-show/delete, same shape as categories.js/marketing.js's Banners
// view. Talks to routes/admin/website-sections.js
// (/api/admin/website-sections/*); public rendering is index.html's
// loadWebsiteSections, reading routes/website-sections.js.

const SECTION_TYPE_META = {
    hero:          { label: 'Hero Banner',       icon: 'fa-image',        desc: 'Big top banner with heading, subheading, and a button' },
    text:          { label: 'Text Section',      icon: 'fa-align-left',   desc: 'A title, description text, and optional bullet points' },
    image:         { label: 'Image Section',     icon: 'fa-file-image',   desc: 'A single image with a caption' },
    image_text:    { label: 'Image + Text',      icon: 'fa-columns',      desc: 'Text next to an image, either side' },
    gallery:       { label: 'Gallery',           icon: 'fa-images',       desc: 'A grid of multiple photos' },
    testimonials:  { label: 'Testimonials',      icon: 'fa-quote-right',  desc: 'Student reviews with name and photo' },
    faq:           { label: 'FAQ',               icon: 'fa-circle-question', desc: 'Expandable question & answer list' },
    video:         { label: 'Video Section',     icon: 'fa-circle-play',  desc: 'An embedded YouTube/Vimeo or direct video link' },
    cta:           { label: 'CTA Banner',        icon: 'fa-bullhorn',     desc: 'A short call-to-action strip with a button' },
    contact:       { label: 'Contact Section',   icon: 'fa-address-card', desc: 'Phone, email, and address block' },
    table:         { label: 'Table',             icon: 'fa-table',        desc: 'A data table with your own columns and rows (e.g. fee structure, batch timings)' },
    cards:         { label: 'Icon Cards',         icon: 'fa-grip',         desc: 'A grid of cards, each with an icon, title, and list — e.g. course categories, features' },
};

// Matches index.html's actual <section id="..."> elements exactly (see
// the identical HOMEPAGE_ANCHORS allowlist in utils/validators.js) --
// [value, label shown in the dropdown].
const HOMEPAGE_ANCHOR_OPTIONS = [
    ['home', 'Hero (top of page)'], ['about', 'About'], ['courses', 'Courses'],
    ['classes-overview', 'Classes Overview'], ['faculty', 'Leadership'],
    ['results', 'Results'], ['fees', 'Fees & Timings'],
    ['online-classes', 'Online Classes'], ['faq', 'FAQ'],
    ['admission', 'Admission'], ['feedback', 'Feedback'], ['contact', 'Contact'],
];

async function loadWebsiteBuilder() {
    showLoading();
    try {
        const res = await apiCall('/website-sections');
        window._sections = res?.data || [];
        // Which page's sections the list currently shows -- persisted
        // across a reload of this view (e.g. after add/edit/delete) via
        // module state, so the admin doesn't get bounced back to
        // Homepage every time they save something on another page.
        if (!window._currentBuilderPage) window._currentBuilderPage = 'home';
        renderWebsiteBuilder();
    } catch (error) {
        showError('Failed to load Website Builder', error.message);
    }
}

function sectionPreviewText(section) {
    const d = section.data || {};
    switch (section.type) {
        case 'hero': return d.heading || '(no heading)';
        case 'text': return d.title || '(no title)';
        case 'image': return d.caption || '(image)';
        case 'image_text': return d.title || '(no title)';
        case 'gallery': return `${(d.images || []).length} image(s)`;
        case 'testimonials': return `${(d.items || []).length} testimonial(s)`;
        case 'faq': return `${(d.items || []).length} question(s)`;
        case 'video': return d.title || '(video)';
        case 'cta': return d.heading || '(no heading)';
        case 'contact': return d.title || '(contact info)';
        case 'table': return `${(d.rows || []).length} row(s) × ${(d.columns || []).length} column(s)`;
        case 'cards': return `${(d.items || []).length} card(s)`;
        default: return '';
    }
}

function switchBuilderPage(page) {
    window._currentBuilderPage = page;
    renderWebsiteBuilder();
}

function promptNewBuilderPage() {
    const raw = prompt('Name this page (e.g. "gallery", "achievements"). It will be live at /page/your-name — letters, numbers, and hyphens only:');
    if (!raw) return;
    const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) { showToast('Error', 'Enter a valid page name', 'error'); return; }
    window._currentBuilderPage = slug;
    showSectionTypePicker(); // a brand new page starts by adding its first section
}

function renderWebsiteBuilder() {
    const allSections = window._sections || [];
    const currentPage = window._currentBuilderPage || 'home';

    // Every distinct page an admin has created, "home" always first
    // (sections with no `page` at all pre-date this feature and count as
    // "home" -- see routes/website-sections.js's DEFAULT_PAGE handling).
    const pages = Array.from(new Set(allSections.map((s) => s.page || 'home')));
    if (!pages.includes('home')) pages.unshift('home'); else pages.splice(pages.indexOf('home'), 1), pages.unshift('home');

    const sections = allSections
        .filter((s) => (s.page || 'home') === currentPage)
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🧩 Website Builder</h2>
            ${hasPermission('website_builder:create') ? `<button class="btn btn-gold btn-sm" onclick="showSectionTypePicker()"><i class="fas fa-plus"></i> Add Section</button>` : ''}
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:-6px 0 14px;max-width:680px;">
            <strong>Homepage</strong> sections render on the main homepage — use each section's "Position on Homepage" field to place it after any existing section (About, Courses, Results, etc.), not just at the end. Any other page you create gets its own URL — <code>/page/name</code> — and can be linked from a navbar item under <a href="#" onclick="switchSection('categories'); return false;">Admin → Categories</a>.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
            ${pages.map((p) => `
                <button class="btn btn-sm ${p === currentPage ? 'btn-gold' : 'btn-secondary'}" onclick="switchBuilderPage('${p}')">
                    ${p === 'home' ? '<i class="fas fa-house"></i> Homepage' : escapeHtml(p)}
                </button>
            `).join('')}
            ${hasPermission('website_builder:create') ? `<button class="btn btn-secondary btn-sm" onclick="promptNewBuilderPage()"><i class="fas fa-plus"></i> New Page</button>` : ''}
        </div>
        ${currentPage !== 'home' ? `
        <div style="display:flex;align-items:center;gap:14px;margin:-8px 0 14px;flex-wrap:wrap;">
            <p style="font-size:12.5px;color:var(--muted);margin:0;">Live at: <a href="/page/${escapeHtml(currentPage)}" target="_blank"><code>/page/${escapeHtml(currentPage)}</code></a></p>
            ${hasPermission('website_builder:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteBuilderPage('${escapeHtml(currentPage)}')"><i class="fas fa-trash"></i> Delete This Page</button>` : ''}
        </div>` : ''}
        ${sections.length === 0 ? `
            <div class="empty-state"><span class="icon">🧩</span><strong>No Sections Yet</strong><p>Add a section to ${currentPage === 'home' ? 'the homepage' : `"${currentPage}"`} — no coding needed.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Order</th><th>Type</th><th>Preview</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${sections.map((s, idx) => `
                            <tr>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('website_builder:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="moveSection('${s._id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="moveSection('${s._id}', 1)" ${idx === sections.length - 1 ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                                    ` : `<span style="font-size:12px;color:var(--muted);">${idx + 1}</span>`}
                                </td>
                                <td><i class="fas ${SECTION_TYPE_META[s.type]?.icon || 'fa-cube'}" style="color:var(--gold);margin-right:6px;"></i><strong>${SECTION_TYPE_META[s.type]?.label || s.type}</strong>${currentPage === 'home' ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${(!s.anchor || s.anchor === 'end') ? 'At the end' : 'After "' + (HOMEPAGE_ANCHOR_OPTIONS.find(([v]) => v === s.anchor)?.[1] || s.anchor) + '"'}</div>` : ''}</td>
                                <td style="font-size:12.5px;color:var(--muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(sectionPreviewText(s))}</td>
                                <td><span class="status-badge ${s.isActive ? 'status-active' : 'status-inactive'}">${s.isActive ? 'Shown' : 'Hidden'}</span></td>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('website_builder:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="showEditSectionModal('${s._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-sm" onclick="toggleSectionActive('${s._id}', ${!s.isActive})" title="${s.isActive ? 'Hide' : 'Show'}"><i class="fas fa-${s.isActive ? 'eye-slash' : 'eye'}"></i></button>
                                    ` : ''}
                                    ${hasPermission('website_builder:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteSection('${s._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

async function moveSection(id, direction) {
    const currentPage = window._currentBuilderPage || 'home';
    // Only reorder within the currently-viewed page's own sections --
    // window._sections holds every page mixed together, and order values
    // are scoped per-page (see routes/admin/website-sections.js's
    // DEFAULT_PAGE handling), so swapping across pages would be
    // meaningless.
    const sections = (window._sections || [])
        .filter((s) => (s.page || 'home') === currentPage)
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const idx = sections.findIndex(x => x._id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= sections.length) return;

    [sections[idx], sections[newIdx]] = [sections[newIdx], sections[idx]];
    const orderedIds = sections.map(s => s._id);

    const result = await apiCall('/website-sections/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reorder', 'error'); return; }

    const reordered = new Map(sections.map((s, i) => [s._id, i]));
    window._sections = (window._sections || []).map((s) => reordered.has(s._id) ? { ...s, order: reordered.get(s._id) } : s);
    renderWebsiteBuilder();
}

async function toggleSectionActive(id, isActive) {
    const result = await apiCall(`/website-sections/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update', 'error'); return; }
    showToast('Success', isActive ? 'Section shown' : 'Section hidden', 'success');
    await loadWebsiteBuilder();
}

async function deleteSection(id) {
    const s = (window._sections || []).find(x => x._id === id);
    const label = SECTION_TYPE_META[s?.type]?.label || 'this section';
    if (!confirm(`Are you sure you want to delete this ${label}? This can't be undone.`)) return;
    const result = await apiCall(`/website-sections/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete', 'error'); return; }
    showToast('Success', 'Section deleted', 'success');
    await loadWebsiteBuilder();
}

// Deletes every section belonging to a page in one action (not just one
// section at a time) -- the page's own tab disappears afterward since
// window._sections no longer has anything with that `page` value (see
// renderWebsiteBuilder's `pages` list, built from whatever page values
// are actually present in the loaded sections).
async function deleteBuilderPage(page) {
    const count = (window._sections || []).filter((s) => (s.page || 'home') === page).length;
    if (!confirm(`Are you sure you want to delete the "${page}" page? This will permanently delete all ${count} section${count === 1 ? '' : 's'} on it, and the page (/page/${page}) will stop working. This can't be undone.`)) return;
    const result = await apiCall(`/website-sections/page/${encodeURIComponent(page)}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete page', 'error'); return; }
    showToast('Success', result.message || 'Page deleted', 'success');
    window._currentBuilderPage = 'home'; // that page's tab is gone -- fall back to Homepage
    await loadWebsiteBuilder();
}

// ── Step 1: Add Section -> type picker grid ────────────────────────────
// Distinct accent color per card so the picker doesn't look like a flat
// wall of identical gold icons — purely cosmetic grouping (content types
// vs. media types vs. engagement types), no functional meaning.
const SECTION_TYPE_COLORS = {
    hero: '#f4b400', text: '#60a5fa', image: '#34d399', image_text: '#34d399',
    gallery: '#34d399', testimonials: '#f472b6', faq: '#a78bfa',
    video: '#fb923c', cta: '#f4b400', contact: '#60a5fa', table: '#22d3ee', cards: '#f4b400',
};

function showSectionTypePicker() {
    const cards = Object.entries(SECTION_TYPE_META).map(([type, meta]) => {
        const color = SECTION_TYPE_COLORS[type] || '#f4b400';
        return `
        <button type="button" class="ws-type-card" onclick="closeModal(); showAddSectionModal('${type}');"
            style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;
                   background:#1a2332;border:1px solid #2a3548;border-radius:12px;padding:22px 14px;
                   cursor:pointer;font-family:inherit;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;"
            onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 20px rgba(0,0,0,0.25)';"
            onmouseout="this.style.borderColor='#2a3548';this.style.transform='none';this.style.boxShadow='none';">
            <span style="width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                         background:${color}22;flex-shrink:0;">
                <i class="fas ${meta.icon}" style="font-size:18px;color:${color};"></i>
            </span>
            <strong style="font-size:13.5px;color:#e6ebf3;">${meta.label}</strong>
            <span style="font-size:11.5px;color:#8592a8;line-height:1.4;">${meta.desc}</span>
        </button>`;
    }).join('');

    showModal('Add Section', 'Choose a section type to add to the homepage', `
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(160px, 1fr));gap:14px;">
            ${cards}
        </div>
    `, null); // null callback -- this modal has no Save button, cards act immediately
    // showModal() always resets the footer's Save button visible (see
    // ui-helpers.js) -- hidden here since this picker step has no form to
    // submit, only cards that immediately open the next modal on click.
    const saveBtn = document.getElementById('modalSaveBtn');
    if (saveBtn) saveBtn.style.display = 'none';
}

// ── Step 2: per-type form ────────────────────────────────────────────────
function sectionFormFields(type, section = {}) {
    const d = section.data || {};
    const typeFieldsHtml = {
        hero: heroFields, text: textFields, image: imageFields, image_text: imageTextFields,
        gallery: galleryFields, testimonials: testimonialsFields, faq: faqFields,
        video: videoFields, cta: ctaFields, contact: contactFields, table: tableFields, cards: cardsFields,
    }[type](d);
    const currentPage = window._currentBuilderPage || 'home';

    return `
        <input type="hidden" id="secType" value="${type}">
        ${typeFieldsHtml}
        ${currentPage === 'home' ? `
        <div class="form-group" style="margin-top:16px;">
            <label>Position on Homepage</label>
            <select id="secAnchor">
                <option value="end" ${!section.anchor || section.anchor === 'end' ? 'selected' : ''}>At the end (just before the footer)</option>
                ${HOMEPAGE_ANCHOR_OPTIONS.map(([value, label]) => `<option value="${value}" ${section.anchor === value ? 'selected' : ''}>After "${label}"</option>`).join('')}
            </select>
            <p style="font-size:11px;color:var(--muted);margin-top:4px;">Where this section shows up among the homepage's existing sections. If more than one section is placed at the same spot, "Display Order" below decides which comes first.</p>
        </div>` : ''}
        <div class="form-row" style="margin-top:16px;">
            <div class="form-group"><label>Display Order</label><input type="number" id="secOrder" value="${section.order !== undefined ? section.order : ''}" placeholder="Leave blank to add at the end"></div>
            ${section._id ? `
            <div class="form-group">
                <label>Status</label>
                <select id="secIsActive">
                    <option value="true" ${section.isActive !== false ? 'selected' : ''}>Shown</option>
                    <option value="false" ${section.isActive === false ? 'selected' : ''}>Hidden</option>
                </select>
            </div>` : '<div class="form-group"></div>'}
        </div>
    `;
}

// ── Field renderers, one per type ────────────────────────────────────────
function heroFields(d) {
    return `
        <div class="form-group"><label>Heading</label><input type="text" id="secHeading" value="${escapeHtml(d.heading || '')}" placeholder="e.g. Uttam Nagar's Trusted Coaching Institute"></div>
        <div class="form-group"><label>Sub Heading</label><input type="text" id="secSubHeading" value="${escapeHtml(d.subHeading || '')}" placeholder="e.g. Classes 1st-12th, Commerce, Arts, B.Com & BBA"></div>
        ${buttonsRepeaterHtml('heroButtons', legacyButtonsToArray(d))}
        ${imageUploadField('secBackgroundImage', 'Background Image', d.backgroundImage)}
    `;
}

function textFields(d) {
    const points = d.points && d.points.length ? d.points : [''];
    return `
        <div class="form-group"><label>Title</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. About Chawla Classes"></div>
        <div class="form-group"><label>Description</label><textarea id="secDescription" rows="6" placeholder="Write the section's paragraph text here...">${escapeHtml(d.description || '')}</textarea></div>
        <label style="display:block;margin:10px 0 6px;font-size:12.5px;">Points (optional, e.g. key highlights)</label>
        <div id="textPoints">${points.map(p => textPointHtml(p)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('textPoints').insertAdjacentHTML('beforeend', textPointHtml(''))"><i class="fas fa-plus"></i> Add Point</button>
        <div style="margin-top:14px;">${buttonsRepeaterHtml('textButtons', legacyButtonsToArray(d))}</div>
    `;
}

function textPointHtml(value = '') {
    return `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input type="text" class="tx-point" value="${escapeHtml(value)}" placeholder="e.g. Experienced & qualified faculty" style="flex:1;">
            <button type="button" onclick="this.parentElement.remove()" title="Remove point"
                style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;flex-shrink:0;font-size:10px;cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
    `;
}

function imageFields(d) {
    return `
        ${imageUploadField('secImage', 'Image', d.image)}
        <div class="form-group"><label>Caption</label><input type="text" id="secCaption" value="${escapeHtml(d.caption || '')}" placeholder="Optional caption shown under the image"></div>
    `;
}

function imageTextFields(d) {
    return `
        <div class="form-group"><label>Title</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Why Choose Us"></div>
        <div class="form-group"><label>Description</label><textarea id="secDescription" rows="5" placeholder="Write the section's paragraph text here...">${escapeHtml(d.description || '')}</textarea></div>
        ${imageUploadField('secImage', 'Image', d.image)}
        <div class="form-group">
            <label>Image Position</label>
            <select id="secImagePosition">
                <option value="left" ${d.imagePosition === 'left' ? 'selected' : ''}>Left</option>
                <option value="right" ${d.imagePosition !== 'left' ? 'selected' : ''}>Right</option>
            </select>
        </div>
    `;
}

function galleryFields(d) {
    const images = d.images || [];
    return `
        <div class="form-group">
            <label>Images</label>
            <div id="galleryImageGrid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(90px, 1fr));gap:10px;margin-bottom:10px;">
                ${images.map(url => galleryThumbHtml(url)).join('')}
            </div>
            <input type="file" id="galleryFileInput" accept="image/png,image/jpeg,image/webp" multiple onchange="handleGalleryImageSelect(this)">
            <div id="galleryUploadStatus" style="font-size:12px;color:var(--muted);margin-top:6px;"></div>
        </div>
    `;
}

function galleryThumbHtml(url) {
    // Inline-styled (not a CSS class) so this thumbnail always renders at
    // a fixed, constrained size regardless of admin.css load/cache state
    // -- see the identical reasoning on showSectionTypePicker's cards
    // above. Without this, a raw <img> with no size constraint renders at
    // its native resolution, which for an uploaded poster/flyer-sized
    // photo can be 1000px+ wide and blow out the whole modal.
    return `<div class="gallery-upload-thumb" data-url="${escapeHtml(url)}" style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;background:#0f1622;">
        <img src="${escapeHtml(url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">
        <button type="button" onclick="this.parentElement.remove()" title="Remove"
            style="position:absolute;top:4px;right:4px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:10px;cursor:pointer;">
            <i class="fas fa-times"></i>
        </button>
    </div>`;
}

function testimonialsFields(d) {
    const items = (d.items && d.items.length) ? d.items : [{}];
    return `
        <div class="form-group"><label>Section Title (optional)</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. What Our Students Say"></div>
        <label style="display:block;margin-bottom:8px;">Testimonials</label>
        <div id="testimonialItems">${items.map(item => testimonialItemHtml(item)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('testimonialItems').insertAdjacentHTML('beforeend', testimonialItemHtml({}))"><i class="fas fa-plus"></i> Add Testimonial</button>
    `;
}

function testimonialItemHtml(item = {}) {
    const points = item.points && item.points.length ? item.points : [''];
    return `
        <div class="repeatable-item" style="position:relative;background:#1a2332;border:1px solid #2a3548;border-radius:10px;padding:16px;margin-bottom:12px;">
            <button type="button" class="repeatable-remove" onclick="this.parentElement.remove()" title="Remove"
                style="position:absolute;top:10px;right:10px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i></button>
            <div class="form-row">
                <div class="form-group"><label>Student Name</label><input type="text" class="ti-name" value="${escapeHtml(item.name || '')}" placeholder="e.g. Priya Sharma"></div>
                <div class="form-group"><label>Photo (optional)</label>${imageUploadFieldInline('ti-photo', item.photo)}</div>
            </div>
            <div class="form-group"><label>Title (optional, e.g. designation/class)</label><input type="text" class="ti-title" value="${escapeHtml(item.title || '')}" placeholder="e.g. Founder & Academic Director / Class 12 Student"></div>
            <div class="form-group"><label>Review (optional)</label><textarea class="ti-review" rows="3" placeholder="What the student said...">${escapeHtml(item.review || '')}</textarea></div>
            <label style="display:block;margin:10px 0 6px;font-size:12.5px;">Points (optional, e.g. key highlights)</label>
            <div class="ti-points">${points.map(p => testimonialPointHtml(p)).join('')}</div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend', testimonialPointHtml(''))"><i class="fas fa-plus"></i> Add Point</button>
        </div>
    `;
}

function testimonialPointHtml(value = '') {
    return `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input type="text" class="ti-point" value="${escapeHtml(value)}" placeholder="e.g. Scored 95% in Class 12 Boards" style="flex:1;">
            <button type="button" onclick="this.parentElement.remove()" title="Remove point"
                style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;flex-shrink:0;font-size:10px;cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
    `;
}

function faqFields(d) {
    const items = (d.items && d.items.length) ? d.items : [{}];
    return `
        <label style="display:block;margin-bottom:8px;">FAQs</label>
        <div id="faqItems">${items.map(item => faqItemHtml(item)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('faqItems').insertAdjacentHTML('beforeend', faqItemHtml({}))"><i class="fas fa-plus"></i> Add FAQ</button>
    `;
}

function faqItemHtml(item = {}) {
    return `
        <div class="repeatable-item" style="position:relative;background:#1a2332;border:1px solid #2a3548;border-radius:10px;padding:16px;margin-bottom:12px;">
            <button type="button" class="repeatable-remove" onclick="this.parentElement.remove()" title="Remove"
                style="position:absolute;top:10px;right:10px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i></button>
            <div class="form-group"><label>Question</label><input type="text" class="fi-question" value="${escapeHtml(item.question || '')}" placeholder="e.g. What are your class timings?"></div>
            <div class="form-group"><label>Answer</label><textarea class="fi-answer" rows="2" placeholder="Write the answer here...">${escapeHtml(item.answer || '')}</textarea></div>
        </div>
    `;
}

function videoFields(d) {
    return `
        <div class="form-group"><label>Title (optional)</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Take a Tour of Chawla Classes"></div>
        <div class="form-group"><label>Video URL</label><input type="text" id="secVideoUrl" value="${escapeHtml(d.videoUrl || '')}" placeholder="e.g. https://www.youtube.com/watch?v=..."></div>
    `;
}

function ctaFields(d) {
    return `
        <div class="form-group"><label>Heading</label><input type="text" id="secHeading" value="${escapeHtml(d.heading || '')}" placeholder="e.g. Admissions Open for 2026-27"></div>
        <div class="form-group"><label>Description</label><textarea id="secDescription" rows="3" placeholder="e.g. Limited seats available">${escapeHtml(d.description || '')}</textarea></div>
        ${buttonsRepeaterHtml('ctaButtons', legacyButtonsToArray(d))}
    `;
}

function contactFields(d) {
    return `
        <div class="form-group"><label>Title</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Get In Touch"></div>
        <div class="form-row">
            <div class="form-group"><label>Phone</label><input type="text" id="secPhone" value="${escapeHtml(d.phone || '')}" placeholder="e.g. 9717914003"></div>
            <div class="form-group"><label>Email</label><input type="text" id="secEmail" value="${escapeHtml(d.email || '')}" placeholder="e.g. info@chawlaclasses.in"></div>
        </div>
        <div class="form-group"><label>Address</label><input type="text" id="secAddress" value="${escapeHtml(d.address || '')}" placeholder="e.g. Shani Bazar, Uttam Nagar, New Delhi"></div>
    `;
}

// ── Table (e.g. fee structure / batch timings) ───────────────────────────
// Columns and rows are two separate repeatable lists, kept in sync: adding/
// removing a column adds/removes the matching cell in every existing row,
// so a row can never end up with a different cell count than there are
// column headings (which is exactly what the validator in utils/
// validators.js requires).
function tableFields(d) {
    const columns = (d.columns && d.columns.length) ? d.columns : ['Class / Batch', 'Timing', 'Fee'];
    const rows = (d.rows && d.rows.length) ? d.rows : [columns.map(() => '')];
    return `
        <div class="form-group"><label>Title (optional)</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Fee Structure &amp; Batch Timings"></div>

        <label style="display:block;margin:18px 0 4px;font-size:13px;">Columns</label>
        <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;">These become the table's header row. Rename one and every row below updates to match.</p>
        <div id="tableColumns">${columns.map(c => tableColumnInputHtml(c)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="tableAddColumn()"><i class="fas fa-plus"></i> Add Column</button>

        <label style="display:block;margin:18px 0 4px;font-size:13px;">Rows</label>
        <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;">Each box is labeled with its column, so it's always clear what goes where.</p>
        <div id="tableRows">${rows.map(r => tableRowHtml(r, columns)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="tableAddRow()"><i class="fas fa-plus"></i> Add Row</button>
    `;
}

function tableColumnInputHtml(value = '') {
    return `
        <div class="table-col-item" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <i class="fas fa-grip-lines" style="color:#4a5568;font-size:11px;"></i>
            <input type="text" class="table-col-input" value="${escapeHtml(value)}" placeholder="e.g. Class / Batch" oninput="tableSyncRows()" style="flex:1;">
            <button type="button" onclick="tableRemoveColumn(this)" title="Remove column"
                style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:24px;height:24px;flex-shrink:0;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
    `;
}

function tableRowHtml(cells = [], colHeadings = []) {
    return `
        <div class="table-row-group" style="position:relative;background:#1a2332;border:1px solid #2a3548;border-radius:10px;padding:14px 40px 14px 14px;margin-bottom:10px;">
            <button type="button" class="repeatable-remove" onclick="this.closest('.table-row-group').remove()" title="Remove row"
                style="position:absolute;top:10px;right:10px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i></button>
            <div class="table-row-cells" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:10px;">
                ${cells.map((v, i) => tableCellFieldHtml(colHeadings[i] || `Column ${i + 1}`, v)).join('')}
            </div>
        </div>
    `;
}

// One cell = its column's name as a small label sitting right above the
// input (and repeated as the placeholder), so which column a box belongs
// to is never ambiguous, even once a row has 4-5 cells in it.
function tableCellFieldHtml(label, value = '') {
    return `
        <div class="table-cell-field">
            <label style="display:block;font-size:10.5px;font-weight:600;color:#8592a8;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(label)}</label>
            <input type="text" class="table-cell-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(label)}" style="width:100%;box-sizing:border-box;">
        </div>
    `;
}

function tableAddColumn() {
    document.getElementById('tableColumns').insertAdjacentHTML('beforeend', tableColumnInputHtml(''));
    tableSyncRows();
}

function tableRemoveColumn(btn) {
    const columnsWrap = document.getElementById('tableColumns');
    if (columnsWrap.children.length <= 1) return; // keep at least one column
    btn.closest('.table-col-item').remove();
    tableSyncRows();
}

function tableAddRow() {
    const colHeadings = Array.from(document.querySelectorAll('#tableColumns .table-col-input')).map(el => el.value.trim() || 'Column');
    document.getElementById('tableRows').insertAdjacentHTML('beforeend', tableRowHtml(colHeadings.map(() => ''), colHeadings));
}

// Re-labels every existing row's cells to match the current column list --
// called whenever a column is added, removed, or renamed. Existing cell
// values are preserved by position; a value with no column left under it
// (a column got removed) is simply dropped along with that cell.
function tableSyncRows() {
    const colHeadings = Array.from(document.querySelectorAll('#tableColumns .table-col-input')).map(el => el.value.trim() || 'Column');
    document.querySelectorAll('#tableRows .table-row-cells').forEach(cellsEl => {
        const existingValues = Array.from(cellsEl.querySelectorAll('.table-cell-input')).map(el => el.value);
        cellsEl.innerHTML = colHeadings.map((label, i) => tableCellFieldHtml(label, existingValues[i] || '')).join('');
    });
}

// ── Icon Cards (e.g. course categories, features) ────────────────────────
// Each card is its own repeatable-item (icon + title), containing a
// second, nested repeatable list of plain-text lines -- structurally two
// levels of the same "add/remove" pattern used everywhere else in this
// file (testimonials/faq at the outer level, table rows at the inner).
const CARD_ICON_SUGGESTIONS = [
    'fa-school', 'fa-book-open', 'fa-chart-line', 'fa-landmark', 'fa-briefcase',
    'fa-user-tie', 'fa-globe', 'fa-trophy', 'fa-graduation-cap', 'fa-calculator',
    'fa-flask', 'fa-laptop-code', 'fa-users', 'fa-award', 'fa-book',
];

function cardsFields(d) {
    const items = (d.items && d.items.length) ? d.items : [{}];
    return `
        <div class="form-group"><label>Title (optional)</label><input type="text" id="secTitle" value="${escapeHtml(d.title || '')}" placeholder="e.g. Courses We Offer"></div>
        <div class="form-group"><label>Subtitle (optional)</label><input type="text" id="secSubtitle" value="${escapeHtml(d.subtitle || '')}" placeholder="e.g. Academic Excellence from School to College"></div>

        <label style="display:block;margin:18px 0 4px;font-size:13px;">Cards</label>
        <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;">Icon is a Font Awesome name (without "fas fa-", just the part after, e.g. <code>fa-school</code>) — see <a href="https://fontawesome.com/search?o=r&m=free" target="_blank" rel="noopener">fontawesome.com</a> for more.</p>
        <datalist id="cardIconSuggestions">${CARD_ICON_SUGGESTIONS.map(i => `<option value="${i}">`).join('')}</datalist>
        <div id="cardItems">${items.map(item => cardItemHtml(item)).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('cardItems').insertAdjacentHTML('beforeend', cardItemHtml({}))"><i class="fas fa-plus"></i> Add Card</button>

        <div style="margin-top:20px;">${buttonsRepeaterHtml('cardsButtons', d.buttons || [])}</div>
    `;
}

function cardItemHtml(item = {}) {
    const lines = (item.lines && item.lines.length) ? item.lines : [''];
    const buttons = legacyButtonsToArray(item);
    const icon = item.icon || 'fa-school';
    return `
        <div class="repeatable-item card-item" style="position:relative;background:#1a2332;border:1px solid #2a3548;border-radius:10px;padding:16px;margin-bottom:12px;">
            <button type="button" class="repeatable-remove" onclick="this.closest('.card-item').remove()" title="Remove card"
                style="position:absolute;top:10px;right:10px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i></button>
            <div class="form-row">
                <div class="form-group">
                    <label>Icon</label>
                    <input type="text" class="ci-icon" list="cardIconSuggestions" value="${escapeHtml(icon)}" placeholder="e.g. fa-school" oninput="this.closest('.card-item').querySelector('.ci-icon-preview').className = 'fas ' + (this.value.trim() || 'fa-circle') + ' ci-icon-preview'">
                </div>
                <div class="form-group" style="max-width:60px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;">
                    <span style="width:34px;height:34px;border-radius:50%;background:#0b1f3a;display:flex;align-items:center;justify-content:center;">
                        <i class="fas ${escapeHtml(icon)} ci-icon-preview" style="color:#f4b400;font-size:14px;"></i>
                    </span>
                </div>
            </div>
            <div class="form-group"><label>Title</label><input type="text" class="ci-title" value="${escapeHtml(item.title || '')}" placeholder="e.g. Junior Wing"></div>
            <div class="form-group"><label>Description (optional)</label><textarea class="ci-description" rows="2" placeholder="e.g. A short line about this card">${escapeHtml(item.description || '')}</textarea></div>
            <label style="display:block;margin:10px 0 6px;font-size:12.5px;">Lines (optional, e.g. subjects, one per box)</label>
            <div class="card-lines">${lines.map(l => cardLineHtml(l)).join('')}</div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend', cardLineHtml(''))"><i class="fas fa-plus"></i> Add Line</button>
            <div class="form-group" style="margin-top:14px;"><label>Subtitle (optional)</label><input type="text" class="ci-subtitle" value="${escapeHtml(item.subtitle || '')}" placeholder="e.g. Classes 1-5"></div>
            <label style="display:block;margin:14px 0 6px;font-size:12.5px;">Buttons (optional)</label>
            <div class="ci-buttons">${buttons.map(b => cardButtonItemHtml(b.text || '', b.link || '', b.icon || '')).join('')}</div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.insertAdjacentHTML('beforeend', cardButtonItemHtml('', '', ''))"><i class="fas fa-plus"></i> Add Button</button>
        </div>
    `;
}

function cardButtonItemHtml(text = '', link = '', icon = '') {
    return `
        <div class="form-row ci-btn-item" style="margin-bottom:6px;align-items:flex-end;">
            <div class="form-group"><label>Button Text</label><input type="text" class="ci-btn-text" value="${escapeHtml(text)}" placeholder="e.g. Know More"></div>
            <div class="form-group"><label>Icon (optional)</label><input type="text" class="ci-btn-icon" list="cardIconSuggestions" value="${escapeHtml(icon)}" placeholder="e.g. fa-paper-plane"></div>
            <div class="form-group" style="display:flex;gap:8px;align-items:center;">
                <div style="flex:1;"><label>Button Link</label><input type="text" class="ci-btn-link" value="${escapeHtml(link)}" placeholder="e.g. #admission"></div>
                <button type="button" onclick="this.closest('.ci-btn-item').remove()" title="Remove button"
                    style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;flex-shrink:0;font-size:10px;cursor:pointer;"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
}

// ── Multi-button repeater (used by Hero / Text / CTA sections so admin
// can add more than one button, e.g. "Enroll Now" + "Download Brochure") ──
function buttonsRepeaterHtml(containerId, buttons) {
    const list = buttons && buttons.length ? buttons : [{ text: '', link: '', icon: '' }];
    return `
        <label style="display:block;margin:10px 0 6px;font-size:12.5px;">Buttons (optional)</label>
        <datalist id="buttonIconSuggestions">${CARD_ICON_SUGGESTIONS.map(i => `<option value="${i}">`).join('')}</datalist>
        <div id="${containerId}">${list.map(b => buttonItemHtml(b.text || '', b.link || '', b.icon || '')).join('')}</div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('${containerId}').insertAdjacentHTML('beforeend', buttonItemHtml('', '', ''))"><i class="fas fa-plus"></i> Add Button</button>
    `;
}

function buttonItemHtml(text = '', link = '', icon = '') {
    return `
        <div class="form-row btn-repeat-item" style="margin-bottom:6px;align-items:flex-end;">
            <div class="form-group"><label>Button Text</label><input type="text" class="btn-item-text" value="${escapeHtml(text)}" placeholder="e.g. Enroll Now"></div>
            <div class="form-group"><label>Icon (optional)</label><input type="text" class="btn-item-icon" list="buttonIconSuggestions" value="${escapeHtml(icon)}" placeholder="e.g. fa-paper-plane"></div>
            <div class="form-group" style="display:flex;gap:8px;align-items:center;">
                <div style="flex:1;"><label>Button Link</label><input type="text" class="btn-item-link" value="${escapeHtml(link)}" placeholder="e.g. #admission"></div>
                <button type="button" onclick="this.closest('.btn-repeat-item').remove()" title="Remove button"
                    style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;flex-shrink:0;font-size:10px;cursor:pointer;"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
}

function readButtonsRepeater(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} .btn-repeat-item`))
        .map(el => ({
            text: el.querySelector('.btn-item-text').value.trim(),
            link: el.querySelector('.btn-item-link').value.trim(),
            icon: el.querySelector('.btn-item-icon').value.trim(),
        }))
        .filter(b => b.text || b.link);
}

// Normalizes legacy single buttonText/buttonLink (old saved sections) into
// the buttons[] array shape, so old data still populates the repeater.
function legacyButtonsToArray(d) {
    if (Array.isArray(d.buttons) && d.buttons.length) return d.buttons;
    if (d.buttonText || d.buttonLink) return [{ text: d.buttonText || '', link: d.buttonLink || '', icon: d.buttonIcon || '' }];
    return [];
}

function cardLineHtml(value = '') {
    return `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
            <input type="text" class="ci-line" value="${escapeHtml(value)}" placeholder="e.g. Mathematics" style="flex:1;">
            <button type="button" onclick="this.parentElement.remove()" title="Remove line"
                style="background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;flex-shrink:0;font-size:10px;cursor:pointer;"><i class="fas fa-times"></i></button>
        </div>
    `;
}

// ── Image upload widget (shared across every image field) ───────────────
// Two variants: imageUploadField() for a standalone field with its own
// id (hero background, image/image+text) and imageUploadFieldInline()
// for one embedded inside a repeatable item (testimonial photo), which
// uses a class instead of an id since multiple can exist on the page at
// once. Both upload through the same POST /website-sections/upload-image
// endpoint and just store the returned URL in a hidden input.
function imageUploadField(id, label, url) {
    return `
        <div class="form-group">
            <label>${escapeHtml(label)}</label>
            <div id="${id}Preview">${imagePreviewHtml(url, id)}</div>
            <input type="file" accept="image/png,image/jpeg,image/webp" onchange="handleSectionImageSelect(this, '${id}', '${id}Preview')">
            <input type="hidden" id="${id}" value="${escapeHtml(url || '')}">
        </div>
    `;
}

function imageUploadFieldInline(cls, url) {
    // No shared id -- each repeatable-item block gets its own instance via
    // querySelector scoped to that block at read-time (readTestimonials()).
    const uid = 'inl_' + Math.random().toString(36).slice(2, 9);
    return `
        <div class="${cls}-preview" id="${uid}Preview">${imagePreviewHtml(url, uid)}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" onchange="handleSectionImageSelect(this, '${uid}', '${uid}Preview')">
        <input type="hidden" class="${cls}" id="${uid}" value="${escapeHtml(url || '')}">
    `;
}

function imagePreviewHtml(url, hiddenId) {
    if (!url) return `<span style="font-size:12px;color:var(--muted);">No image uploaded</span>`;
    return `<div style="position:relative;display:inline-block;margin-bottom:6px;"><img src="${escapeHtml(url)}" style="max-width:160px;max-height:100px;border-radius:8px;display:block;"><button type="button" onclick="document.getElementById('${hiddenId}').value='';document.getElementById('${hiddenId}Preview').innerHTML=imagePreviewHtml('','${hiddenId}')" style="position:absolute;top:-6px;right:-6px;background:#dc2626;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:11px;cursor:pointer;">✕</button></div>`;
}

const SECTION_IMAGE_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const SECTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Same XHR-for-upload-progress approach as marketing.js's
// uploadBannerImageFile — fetch() has no reliable cross-browser upload
// progress event, XHR does.
function uploadSectionImageFile(file, onProgress) {
    return new Promise((resolve) => {
        const formData = new FormData();
        formData.append('image', file);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/website-sections/upload-image`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`); // no Content-Type -- browser sets the multipart boundary
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
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { resolve(null); }
        };
        xhr.onerror = () => resolve(null);
        xhr.send(formData);
    });
}

async function handleSectionImageSelect(input, hiddenId, previewId) {
    const file = input.files[0];
    if (!file) return;
    if (!SECTION_IMAGE_ALLOWED_MIMES.includes(file.type)) {
        showToast('Error', 'Only JPG, PNG, or WEBP images are allowed', 'error');
        input.value = '';
        return;
    }
    if (file.size > SECTION_IMAGE_MAX_BYTES) {
        showToast('Error', 'Image is too large. Max size is 5MB.', 'error');
        input.value = '';
        return;
    }

    const previewEl = document.getElementById(previewId);
    previewEl.innerHTML = `<span style="font-size:12px;color:var(--muted);">Uploading…</span>`;

    const result = await uploadSectionImageFile(file);
    input.value = '';

    if (!result || !result.success) {
        showToast('Error', result?.message || 'Image upload failed', 'error');
        previewEl.innerHTML = imagePreviewHtml(document.getElementById(hiddenId).value, hiddenId);
        return;
    }
    document.getElementById(hiddenId).value = result.data.imageUrl;
    previewEl.innerHTML = imagePreviewHtml(result.data.imageUrl, hiddenId);
}

// Gallery: uploads every selected file in sequence (simplest correct
// behavior — avoids N simultaneous XHRs racing to update the same status
// line) and appends a thumbnail per successful upload.
async function handleGalleryImageSelect(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const status = document.getElementById('galleryUploadStatus');
    const grid = document.getElementById('galleryImageGrid');

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        status.textContent = `Uploading ${i + 1} of ${files.length}…`;
        if (!SECTION_IMAGE_ALLOWED_MIMES.includes(file.type)) {
            showToast('Error', `${file.name}: only JPG, PNG, or WEBP images are allowed`, 'error');
            continue;
        }
        if (file.size > SECTION_IMAGE_MAX_BYTES) {
            showToast('Error', `${file.name}: too large (max 5MB)`, 'error');
            continue;
        }
        const result = await uploadSectionImageFile(file);
        if (!result || !result.success) {
            showToast('Error', `${file.name}: ${result?.message || 'upload failed'}`, 'error');
            continue;
        }
        grid.insertAdjacentHTML('beforeend', galleryThumbHtml(result.data.imageUrl));
    }
    status.textContent = '';
    input.value = '';
}

// ── Read the open form back into a `data` object matching the type's
//    validator shape (utils/validators.js's SECTION_FIELD_VALIDATORS) ────
function readSectionForm() {
    const type = document.getElementById('secType').value;
    const readers = {
        hero: () => ({
            heading: val('secHeading'), subHeading: val('secSubHeading'),
            buttons: readButtonsRepeater('heroButtons'),
            backgroundImage: val('secBackgroundImage'),
        }),
        text: () => ({
            title: val('secTitle'), description: val('secDescription'),
            points: Array.from(document.querySelectorAll('#textPoints .tx-point')).map(p => p.value.trim()).filter(Boolean),
            buttons: readButtonsRepeater('textButtons'),
        }),
        image: () => ({ image: val('secImage'), caption: val('secCaption') }),
        image_text: () => ({
            title: val('secTitle'), description: val('secDescription'),
            image: val('secImage'), imagePosition: val('secImagePosition') || 'right',
        }),
        gallery: () => ({
            images: Array.from(document.querySelectorAll('#galleryImageGrid .gallery-upload-thumb')).map(el => el.dataset.url),
        }),
        testimonials: () => ({
            title: val('secTitle'),
            items: Array.from(document.querySelectorAll('#testimonialItems .repeatable-item')).map(el => ({
                name: el.querySelector('.ti-name').value.trim(),
                title: el.querySelector('.ti-title').value.trim(),
                review: el.querySelector('.ti-review').value.trim(),
                photo: el.querySelector('.ti-photo')?.value.trim() || '',
                points: Array.from(el.querySelectorAll('.ti-point')).map(p => p.value.trim()).filter(Boolean),
            })).filter(item => item.name || item.review),
        }),
        faq: () => ({
            items: Array.from(document.querySelectorAll('#faqItems .repeatable-item')).map(el => ({
                question: el.querySelector('.fi-question').value.trim(),
                answer: el.querySelector('.fi-answer').value.trim(),
            })).filter(item => item.question || item.answer),
        }),
        video: () => ({ title: val('secTitle'), videoUrl: val('secVideoUrl') }),
        cta: () => ({
            heading: val('secHeading'), description: val('secDescription'),
            buttons: readButtonsRepeater('ctaButtons'),
        }),
        contact: () => ({
            title: val('secTitle'), phone: val('secPhone'),
            email: val('secEmail'), address: val('secAddress'),
        }),
        table: () => ({
            title: val('secTitle'),
            columns: Array.from(document.querySelectorAll('#tableColumns .table-col-input')).map(el => el.value.trim()).filter(Boolean),
            rows: Array.from(document.querySelectorAll('#tableRows .table-row-group')).map(rowEl =>
                Array.from(rowEl.querySelectorAll('.table-cell-input')).map(el => el.value.trim())
            ).filter(row => row.some(cell => cell)),
        }),
        cards: () => ({
            title: val('secTitle'),
            subtitle: val('secSubtitle'),
            items: Array.from(document.querySelectorAll('#cardItems .card-item')).map(el => ({
                icon: el.querySelector('.ci-icon').value.trim(),
                title: el.querySelector('.ci-title').value.trim(),
                description: el.querySelector('.ci-description').value.trim(),
                subtitle: el.querySelector('.ci-subtitle').value.trim(),
                lines: Array.from(el.querySelectorAll('.ci-line')).map(l => l.value.trim()).filter(Boolean),
                buttons: Array.from(el.querySelectorAll('.ci-buttons .ci-btn-item')).map(b => ({
                    text: b.querySelector('.ci-btn-text').value.trim(),
                    link: b.querySelector('.ci-btn-link').value.trim(),
                    icon: b.querySelector('.ci-btn-icon').value.trim(),
                })).filter(b => b.text || b.link),
            })).filter(item => item.title || item.lines.length),
            buttons: readButtonsRepeater('cardsButtons'),
        }),
    };

    const body = { type, data: readers[type]() };
    const anchorEl = document.getElementById('secAnchor');
    if (anchorEl) body.anchor = anchorEl.value;
    const orderVal = document.getElementById('secOrder')?.value;
    if (orderVal !== '' && orderVal !== undefined) body.order = parseInt(orderVal, 10);
    const activeEl = document.getElementById('secIsActive');
    if (activeEl) body.isActive = activeEl.value === 'true';
    return body;
}

function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function showAddSectionModal(type) {
    const meta = SECTION_TYPE_META[type];
    showModal(`Add ${meta.label}`, meta.desc, sectionFormFields(type), async () => {
        const body = readSectionForm();
        body.page = window._currentBuilderPage || 'home';
        const result = await apiCall('/website-sections', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to add section', 'error'); return; }
        showToast('Success', 'Section added', 'success');
        closeModal();
        await loadWebsiteBuilder();
    });
}

function showEditSectionModal(id) {
    const section = (window._sections || []).find(x => x._id === id);
    if (!section) return;
    const meta = SECTION_TYPE_META[section.type];
    showModal(`Edit ${meta.label}`, meta.desc, sectionFormFields(section.type, section), async () => {
        const body = readSectionForm();
        const result = await apiCall(`/website-sections/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save', 'error'); return; }
        showToast('Success', 'Saved', 'success');
        closeModal();
        await loadWebsiteBuilder();
    });
}