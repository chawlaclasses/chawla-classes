// public/admin/js/tests.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// TESTS (unchanged)
// ============================================================
async function loadTests() {
    showLoading();
    try {
        const [testsRes, seriesRes] = await Promise.all([
            apiCall('/tests'),
            apiCall('/series')
        ]);
        currentData = testsRes?.data || [];
        window._series = seriesRes?.data || [];
        renderTests();
    } catch (error) {
        showError('Failed to load tests', error.message);
    }
}

function renderTests() {
    const series = window._series || [];
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📝 Tests <span class="count">(${currentData.length})</span></h2>
            <button class="btn btn-gold" onclick="showAddTestModal()"><i class="fas fa-plus"></i> Add Test</button>
        </div>
        ${currentData.length === 0 ? `
            <div class="empty-state"><span class="icon">📝</span><strong>No Tests</strong><p>Click "Add Test" to create your first test.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Title</th><th>Series</th><th>Questions</th><th>Marks</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${currentData.map(t => {
                            const ser = series.find(s => s._id === t.seriesId);
                            return `
                                <tr>
                                    <td><strong>${escapeHtml(t.title)}</strong></td>
                                    <td>${escapeHtml(ser?.name || 'N/A')}</td>
                                    <td>${t.totalQuestions || 0}</td>
                                    <td>${t.totalMarks}</td>
                                    <td><span class="status-badge ${t.isPublished ? 'status-published' : 'status-draft'}">${t.isPublished ? 'Published' : 'Draft'}</span></td>
                                    <td>
                                        <button class="btn btn-gold btn-sm" onclick="openTestBuilder('${t._id}')"><i class="fas fa-layer-group"></i> Build</button>
                                        <button class="btn btn-success btn-sm" onclick="togglePublish('${t._id}')"><i class="fas fa-${t.isPublished ? 'eye-slash' : 'eye'}"></i></button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteTest('${t._id}')"><i class="fas fa-trash"></i></button>
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

function showAddTestModal() {
    const series = window._series || [];
    showModal('Add Test', 'Create a new test', `
        <div class="form-group"><label>Test Title *</label><input type="text" id="testTitle" placeholder="e.g., Chapter 1 Test"></div>
        <div class="form-group"><label>Series *</label>
            <select id="testSeries"><option value="">Select Series</option>
                ${series.filter(s => s.isActive).map(s => `<option value="${s._id}">${escapeHtml(s.name)}</option>`).join('')}
            </select>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Total Marks *</label><input type="number" id="testTotalMarks" value="100"></div>
            <div class="form-group"><label>Passing Marks *</label><input type="number" id="testPassingMarks" value="40"></div>
        </div>
        <div class="form-group"><label>Duration (minutes) *</label><input type="number" id="testDuration" value="60"></div>
        <div class="form-group"><label>Description</label><textarea id="testDescription" placeholder="Test description"></textarea></div>
    `, async () => {
        const title = document.getElementById('testTitle').value.trim();
        const seriesId = document.getElementById('testSeries').value;
        const totalMarks = parseInt(document.getElementById('testTotalMarks').value);
        const passingMarks = parseInt(document.getElementById('testPassingMarks').value);
        const duration = parseInt(document.getElementById('testDuration').value);
        const description = document.getElementById('testDescription').value.trim();
        if (!title || !seriesId || !totalMarks || !passingMarks || !duration) {
            showToast('Error', 'All fields are required', 'error'); return;
        }
        const ser = series.find(s => s._id === seriesId);
        const result = await apiCall('/tests', { method: 'POST', body: JSON.stringify({
            title, description, seriesId, subjectId: ser.subjectId, classId: ser.classId,
            totalMarks, passingMarks, duration, maximumAttempts: 1
        })});
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create test', 'error'); return; }
        showToast('Success', 'Test created', 'success');
        closeModal();
        loadTests();
    });
}

async function togglePublish(id) {
    const test = currentData.find(t => t._id === id);
    if (!test) return;
    const action = test.isPublished ? 'unpublish' : 'publish';
    const result = await apiCall(`/tests/${id}/${action}`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || `Failed to ${action} test`, 'error'); return; }
    showToast('Success', `Test ${action}ed`, 'success');
    loadTests();
}

async function deleteTest(id) {
    if (!confirm('Delete this test?')) return;
    const result = await apiCall(`/tests/${id}`, { method: 'DELETE' });
    if (!result || !result.success) {
        showToast('Error', result?.message || 'Failed to delete test', 'error');
        return;
    }
    showToast('Success', 'Test deleted', 'success');
    loadTests();
}

// ============================================================
// ============================================================
// SMART TEST BUILDER
