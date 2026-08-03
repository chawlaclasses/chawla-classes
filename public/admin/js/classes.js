// public/admin/js/classes.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// CLASSES (unchanged)
// ============================================================
async function loadClasses() {
    showLoading();
    try {
        const response = await apiCall('/classes');
        currentData = response?.data || [];
        window._classes = currentData;
        renderClasses();
    } catch (error) {
        showError('Failed to load classes', error.message);
    }
}

function renderClasses() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>🏫 Classes <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showAddClassModal()"><i class="fas fa-plus"></i> Add Class</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">🏫</span><strong>No Classes</strong><p>Click "Add Class" to create your first class.</p></div>
        ` : `
            <div style="color:var(--muted);font-size:12px;margin-bottom:8px;"><i class="fas fa-grip-vertical"></i> Drag a class by the handle to reorder it.</div>
            <div class="table-container">
                <table>
                    <thead><tr><th style="width:36px;"></th><th>Name</th><th>Display Name</th><th>Subjects</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(c => `
                            <tr class="class-row" data-class-id="${c._id}"
                                draggable="true"
                                ondragstart="handleClassDragStart(event, '${c._id}')"
                                ondragover="handleClassDragOver(event, '${c._id}')"
                                ondragleave="handleClassDragLeave(event)"
                                ondrop="handleClassDrop(event, '${c._id}')"
                                ondragend="handleClassDragEnd(event)">
                                <td class="drag-handle-cell" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></td>
                                <td><strong>${escapeHtml(c.name)}</strong></td>
                                <td>${escapeHtml(c.displayName)}</td>
                                <td>${c.subjects?.length || 0}</td>
                                <td><span class="status-badge ${c.isActive ? 'status-active' : 'status-inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
                                <td>
                                    <button class="btn btn-success btn-sm" onclick="editClass('${c._id}')"><i class="fas fa-edit"></i></button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteClass('${c._id}')"><i class="fas fa-trash"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

// Drag-and-drop reordering for the Classes table. Deliberately does NOT
// re-render on every dragover (that fires continuously while the mouse
// moves and would flicker/thrash the DOM mid-drag, breaking the native
// drag operation) — it only highlights the row currently under the
// cursor, and the actual reorder happens once, on drop.
let _classDragId = null;

function handleClassDragStart(e, id) {
    _classDragId = id;
    e.dataTransfer.effectAllowed = 'move';
}

function handleClassDragOver(e, overId) {
    e.preventDefault(); // required for the drop event to fire at all
    e.dataTransfer.dropEffect = 'move';
    if (overId === _classDragId) return;
    document.querySelectorAll('.class-row').forEach(r => r.classList.remove('drag-over'));
    const row = document.querySelector(`.class-row[data-class-id="${overId}"]`);
    if (row) row.classList.add('drag-over');
}

function handleClassDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

async function handleClassDrop(e, overId) {
    e.preventDefault();
    document.querySelectorAll('.class-row').forEach(r => r.classList.remove('drag-over'));
    if (!_classDragId || _classDragId === overId) return;

    const fromIndex = currentData.findIndex(c => c._id === _classDragId);
    const toIndex = currentData.findIndex(c => c._id === overId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = currentData.splice(fromIndex, 1);
    currentData.splice(toIndex, 0, moved);
    renderClasses();

    const result = await apiCall('/classes/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: currentData.map(c => c._id) })
    });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to save new order', 'error');
        loadClasses(); // revert to the last saved order
    }
}

function handleClassDragEnd(e) {
    _classDragId = null;
    document.querySelectorAll('.class-row').forEach(r => r.classList.remove('drag-over'));
}

function showAddClassModal() {
    editingId = null;
    showModal('Add Class', 'Create a new class', `
        <div class="form-group"><label>Class Name *</label><input type="text" id="className" placeholder="e.g., Class 10"></div>
        <div class="form-group"><label>Display Name *</label><input type="text" id="classDisplayName" placeholder="e.g., Class X"></div>
        <div class="form-group"><label>Description</label><textarea id="classDescription" placeholder="Optional description"></textarea></div>
    `, async () => {
        const name = document.getElementById('className').value.trim();
        const displayName = document.getElementById('classDisplayName').value.trim();
        const description = document.getElementById('classDescription').value.trim();
        if (!name || !displayName) { showToast('Error', 'Name and display name are required', 'error'); return; }
        const result = await apiCall('/classes', { method: 'POST', body: JSON.stringify({ name, displayName, description }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create class', 'error'); return; }
        showToast('Success', 'Class created', 'success');
        closeModal();
        loadClasses();
    });
}

async function editClass(id) {
    const item = currentData.find(c => c._id === id);
    if (!item) return;
    editingId = id;
    showModal('Edit Class', 'Update class details', `
        <div class="form-group"><label>Class Name *</label><input type="text" id="editClassName" value="${escapeHtml(item.name)}"></div>
        <div class="form-group"><label>Display Name *</label><input type="text" id="editClassDisplayName" value="${escapeHtml(item.displayName)}"></div>
        <div class="form-group"><label>Description</label><textarea id="editClassDescription">${escapeHtml(item.description || '')}</textarea></div>
        <div class="form-group"><label><input type="checkbox" id="editClassActive" ${item.isActive ? 'checked' : ''}> Active</label></div>
    `, async () => {
        const name = document.getElementById('editClassName').value.trim();
        const displayName = document.getElementById('editClassDisplayName').value.trim();
        const description = document.getElementById('editClassDescription').value.trim();
        const isActive = document.getElementById('editClassActive').checked;
        if (!name || !displayName) { showToast('Error', 'Name and display name are required', 'error'); return; }
        const result = await apiCall(`/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name, displayName, description, isActive }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update class', 'error'); return; }
        showToast('Success', 'Class updated', 'success');
        closeModal();
        loadClasses();
    });
}

async function deleteClass(id) {
    if (!confirm('Delete this class?')) return;
    const result = await apiCall(`/classes/${id}`, { method: 'DELETE' });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to delete class', 'error');
        return;
    }
    showToast('Success', 'Class deleted', 'success');
    loadClasses();
}