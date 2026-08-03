// public/admin/js/series.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// SERIES (unchanged)
// ============================================================
async function loadSeries() {
    showLoading();
    try {
        const [seriesRes, subjectsRes, classesRes] = await Promise.all([
            apiCall('/series'),
            apiCall('/subjects'),
            apiCall('/classes')
        ]);
        currentData = seriesRes?.data || [];
        window._subjects = subjectsRes?.data || [];
        window._classes = classesRes?.data || [];
        renderSeries();
    } catch (error) {
        showError('Failed to load series', error.message);
    }
}

function renderSeries() {
    const subjects = window._subjects || [];
    const classes = window._classes || [];
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📋 Series <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showAddSeriesModal()"><i class="fas fa-plus"></i> Add Series</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">📋</span><strong>No Series</strong><p>Click "Add Series" to create your first test series.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Name</th><th>Type</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(s => {
                            const sub = subjects.find(x => x._id === s.subjectId);
                            const cls = sub ? classes.find(c => c._id === sub.classId) : null;
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(s.name)}</strong></td>
                                    <td>${escapeHtml(s.type || 'other')}</td>
                                    <td>${escapeHtml(sub?.name || 'N/A')}${cls ? `<div style="color:var(--muted);font-size:11px;">${escapeHtml(cls.displayName || cls.name)}</div>` : ''}</td>
                                    <td><span class="status-badge ${s.isActive ? 'status-active' : 'status-inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                                    <td>
                                        <button class="btn btn-success btn-sm" onclick="editSeries('${s._id}')"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteSeries('${s._id}')"><i class="fas fa-trash"></i></button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

function showAddSeriesModal() {
    showModal('Add Series', 'Create a new test series', `
        <div class="form-group"><label>Series Name *</label><input type="text" id="seriesName" placeholder="e.g., Chapter Wise Tests"></div>
        <div class="form-group"><label>Subject *</label>
            <select id="seriesSubject"><option value="">Select Subject</option>
                ${getSubjectOptionsHTML('')}
            </select>
        </div>
        <div class="form-group"><label>Type</label>
            <select id="seriesType">
                <option value="chapter-wise">Chapter Wise</option>
                <option value="weekly">Weekly</option>
                <option value="revision">Revision</option>
                <option value="mock">Mock</option>
                <option value="sample-paper">Sample Paper</option>
                <option value="other">Other</option>
            </select>
        </div>
        <div class="form-group"><label>Description</label><textarea id="seriesDescription" placeholder="Optional description"></textarea></div>
    `, async () => {
        const name = document.getElementById('seriesName').value.trim();
        const subjectId = document.getElementById('seriesSubject').value;
        const type = document.getElementById('seriesType').value;
        const description = document.getElementById('seriesDescription').value.trim();
        if (!name || !subjectId) { showToast('Error', 'Name and subject are required', 'error'); return; }
        const subject = (window._subjects || []).find(s => s._id === subjectId);
        const result = await apiCall('/series', { method: 'POST', body: JSON.stringify({ name, type, subjectId, classId: subject.classId, description }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create series', 'error'); return; }
        showToast('Success', 'Series created', 'success');
        closeModal();
        loadSeries();
    });
}

async function editSeries(id) {
    const item = currentData.find(s => s._id === id);
    if (!item) return;
    showModal('Edit Series', 'Update series details', `
        <div class="form-group"><label>Series Name *</label><input type="text" id="editSeriesName" value="${escapeHtml(item.name)}"></div>
        <div class="form-group"><label>Subject *</label>
            <select id="editSeriesSubject">${getSubjectOptionsHTML(item.subjectId)}</select>
        </div>
        <div class="form-group"><label>Type</label>
            <select id="editSeriesType">
                <option value="chapter-wise" ${item.type === 'chapter-wise' ? 'selected' : ''}>Chapter Wise</option>
                <option value="weekly" ${item.type === 'weekly' ? 'selected' : ''}>Weekly</option>
                <option value="revision" ${item.type === 'revision' ? 'selected' : ''}>Revision</option>
                <option value="mock" ${item.type === 'mock' ? 'selected' : ''}>Mock</option>
                <option value="sample-paper" ${item.type === 'sample-paper' ? 'selected' : ''}>Sample Paper</option>
                <option value="other" ${item.type === 'other' ? 'selected' : ''}>Other</option>
            </select>
        </div>
        <div class="form-group"><label>Description</label><textarea id="editSeriesDescription">${escapeHtml(item.description || '')}</textarea></div>
        <div class="form-group"><label><input type="checkbox" id="editSeriesActive" ${item.isActive ? 'checked' : ''}> Active</label></div>
    `, async () => {
        const name = document.getElementById('editSeriesName').value.trim();
        const subjectId = document.getElementById('editSeriesSubject').value;
        const type = document.getElementById('editSeriesType').value;
        const description = document.getElementById('editSeriesDescription').value.trim();
        const isActive = document.getElementById('editSeriesActive').checked;
        if (!name || !subjectId) { showToast('Error', 'Name and subject are required', 'error'); return; }
        const subject = (window._subjects || []).find(s => s._id === subjectId);
        const result = await apiCall(`/series/${id}`, { method: 'PUT', body: JSON.stringify({ name, type, subjectId, classId: subject.classId, description, isActive }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to update series', 'error'); return; }
        showToast('Success', 'Series updated', 'success');
        closeModal();
        loadSeries();
    });
}

async function deleteSeries(id) {
    if (!confirm('Delete this series?')) return;
    const result = await apiCall(`/series/${id}`, { method: 'DELETE' });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to delete series', 'error');
        return;
    }
    showToast('Success', 'Series deleted', 'success');
    loadSeries();
}