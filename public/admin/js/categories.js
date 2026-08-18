// public/admin/js/categories.js
//
// Homepage nav Categories — admin side. Manages the categories that
// render as index.html's navbar (desktop #navLinks) and mobile drawer
// (#drawerNav), replacing what used to be a hardcoded
// Home/About/Courses/Leadership/Results/Fees & Timings/Classes/Admission/
// Careers/Feedback/Contact list. Public read is
// routes/categories.js (GET /api/categories); this file talks to the
// admin CRUD in routes/admin/categories.js (/api/admin/categories/*).
//
// Follows the exact same shape as marketing.js's Banners view
// (load -> render table -> modal add/edit -> reorder via up/down buttons
// -> toggle active -> delete with confirm), so anyone already familiar
// with that screen can maintain this one too.

async function loadCategories() {
    showLoading();
    try {
        const res = await apiCall('/categories');
        window._categories = res?.data || [];
        renderCategories();
    } catch (error) {
        showError('Failed to load Categories', error.message);
    }
}

function renderCategories() {
    const categories = window._categories || [];

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🗂️ Categories</h2>
            ${hasPermission('categories:create') ? `<button class="btn btn-gold btn-sm" onclick="showAddCategoryModal()"><i class="fas fa-plus"></i> Add Category</button>` : ''}
        </div>
        <p style="font-size:12.5px;color:var(--muted);margin:-6px 0 14px;max-width:640px;">
            These control the public website's navbar (top menu + mobile menu). Inactive categories are hidden from visitors but stay listed here. Use the arrows to change the order they appear in.
        </p>
        ${categories.length === 0 ? `
            <div class="empty-state"><span class="icon">🗂️</span><strong>No Categories Yet</strong><p>Add a category to build the homepage navbar.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Order</th><th>Name</th><th>Slug</th><th>URL</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${categories.map((c, idx) => `
                            <tr>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('categories:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="moveCategory('${c._id}', -1)" ${idx === 0 ? 'disabled' : ''} title="Move up"><i class="fas fa-arrow-up"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="moveCategory('${c._id}', 1)" ${idx === categories.length - 1 ? 'disabled' : ''} title="Move down"><i class="fas fa-arrow-down"></i></button>
                                    ` : `<span style="font-size:12px;color:var(--muted);">${idx + 1}</span>`}
                                </td>
                                <td><strong>${c.icon ? `<i class="fas ${escapeHtml(c.icon)}" style="width:16px;color:var(--muted);"></i> ` : ''}${escapeHtml(c.name)}</strong></td>
                                <td><code style="font-size:12px;">${escapeHtml(c.slug)}</code></td>
                                <td style="font-size:12px;color:var(--muted);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.url)}</td>
                                <td><span class="status-badge ${c.isActive ? 'status-active' : 'status-inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
                                <td style="font-size:12px;">${c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
                                <td style="white-space:nowrap;">
                                    ${hasPermission('categories:edit') ? `
                                        <button class="btn btn-secondary btn-sm" onclick="showEditCategoryModal('${c._id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-sm" onclick="toggleCategoryActive('${c._id}', ${!c.isActive})" title="${c.isActive ? 'Deactivate' : 'Activate'}"><i class="fas fa-${c.isActive ? 'eye-slash' : 'eye'}"></i></button>
                                    ` : ''}
                                    ${hasPermission('categories:delete') ? `<button class="btn btn-danger btn-sm" onclick="deleteCategory('${c._id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

// Swap this category with its neighbour and persist the new order.
// Categories are already order-sorted (server sorts by `order` on load),
// so swapping two adjacent array entries and re-sending the whole ID
// order is enough — the reorder endpoint rewrites every category's
// `order` to its index in that list. Same approach as marketing.js's
// moveBanner().
async function moveCategory(id, direction) {
    const categories = (window._categories || []).slice();
    const idx = categories.findIndex(x => x._id === id);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= categories.length) return;

    [categories[idx], categories[newIdx]] = [categories[newIdx], categories[idx]];
    const orderedIds = categories.map(c => c._id);

    const result = await apiCall('/categories/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to reorder', 'error'); return; }

    window._categories = categories.map((c, i) => ({ ...c, order: i }));
    renderCategories();
}

function categoryFormFields(c = {}) {
    return `
        <div class="form-row">
            <div class="form-group"><label>Category Name</label><input type="text" id="catName" value="${escapeHtml(c.name || '')}" placeholder="e.g. Gallery" oninput="autoFillCategorySlug()"></div>
            <div class="form-group"><label>Slug</label><input type="text" id="catSlug" value="${escapeHtml(c.slug || '')}" placeholder="e.g. gallery" data-auto="${c.slug ? 'false' : 'true'}" oninput="this.dataset.auto='false'"></div>
        </div>
        <div class="form-group">
            <label>URL</label>
            <input type="text" id="catUrl" value="${escapeHtml(c.url || '')}" placeholder="e.g. #gallery, /gallery.html, or https://...">
            <p style="font-size:11px;color:var(--muted);margin-top:4px;">Use "#section-id" to scroll to a section already on the homepage (like the existing menu), or "/page.html" for a separate page, or a full https:// link.</p>
        </div>
        <div class="form-row">
            <div class="form-group">
                <label>Icon (optional)</label>
                <input type="text" id="catIcon" value="${escapeHtml(c.icon || '')}" placeholder="e.g. fa-images">
                <p style="font-size:11px;color:var(--muted);margin-top:4px;">A <a href="https://fontawesome.com/search?o=r&m=free" target="_blank" rel="noopener">Font Awesome</a> icon name (without "fas"), shown in the mobile menu.</p>
            </div>
            <div class="form-group"><label>Display Order</label><input type="number" id="catOrder" value="${c.order !== undefined ? c.order : ''}" placeholder="Leave blank to add at the end"></div>
        </div>
        ${c._id ? `
        <div class="form-group">
            <label>Status</label>
            <select id="catIsActive">
                <option value="true" ${c.isActive !== false ? 'selected' : ''}>Active</option>
                <option value="false" ${c.isActive === false ? 'selected' : ''}>Inactive</option>
            </select>
        </div>` : ''}
    `;
}

// Convenience only — lets the admin type "Gallery" once and get a
// "gallery" slug for free, same as most CMS category forms. Stops
// auto-filling the moment they've touched the slug field themselves
// (tracked via data-auto, set to 'false' by categoryFormFields' oninput
// above), so it never clobbers a slug they deliberately customized.
function autoFillCategorySlug() {
    const slugInput = document.getElementById('catSlug');
    if (!slugInput || slugInput.dataset.auto === 'false') return;
    const name = document.getElementById('catName').value;
    slugInput.value = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function readCategoryForm() {
    const body = {
        name: document.getElementById('catName').value.trim(),
        slug: document.getElementById('catSlug').value.trim().toLowerCase(),
        url: document.getElementById('catUrl').value.trim(),
        icon: document.getElementById('catIcon').value.trim(),
    };
    const orderVal = document.getElementById('catOrder').value;
    if (orderVal !== '') body.order = parseInt(orderVal, 10);
    const activeEl = document.getElementById('catIsActive');
    if (activeEl) body.isActive = activeEl.value === 'true';
    return body;
}

function showAddCategoryModal() {
    showModal('Add Category', 'Adds a new item to the public website navbar', categoryFormFields(), async () => {
        const body = readCategoryForm();
        if (!body.name || !body.slug || !body.url) { showToast('Error', 'Name, slug, and URL are required', 'error'); return; }
        const result = await apiCall('/categories', { method: 'POST', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create category', 'error'); return; }
        showToast('Success', 'Category created', 'success');
        closeModal();
        await loadCategories();
    });
}

function showEditCategoryModal(id) {
    const c = (window._categories || []).find(x => x._id === id);
    if (!c) return;
    showModal('Edit Category', `Update "${c.name}"`, categoryFormFields(c), async () => {
        const body = readCategoryForm();
        if (!body.name || !body.slug || !body.url) { showToast('Error', 'Name, slug, and URL are required', 'error'); return; }
        const result = await apiCall(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update category', 'error'); return; }
        showToast('Success', 'Category updated', 'success');
        closeModal();
        await loadCategories();
    });
}

async function toggleCategoryActive(id, isActive) {
    const result = await apiCall(`/categories/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update category', 'error'); return; }
    showToast('Success', isActive ? 'Category activated' : 'Category deactivated', 'success');
    await loadCategories();
}

async function deleteCategory(id) {
    const c = (window._categories || []).find(x => x._id === id);
    if (!confirm(`Are you sure you want to delete "${c?.name || 'this category'}"? This can't be undone and it will disappear from the public navbar immediately.`)) return;
    const result = await apiCall(`/categories/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete category', 'error'); return; }
    showToast('Success', 'Category deleted', 'success');
    await loadCategories();
}
