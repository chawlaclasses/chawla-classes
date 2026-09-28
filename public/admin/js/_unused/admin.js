// Admin Dashboard JavaScript
const API_BASE = '/api/admin';

// State
let state = {
  currentSection: 'dashboard',
  selectedId: null,
  data: {
    classes: [],
    subjects: [],
    series: [],
    tests: [],
    questions: []
  },
  filters: {
    classId: '',
    subjectId: '',
    seriesId: ''
  }
};

// ============================================================
// DOM Elements
// ============================================================
const elements = {
  contentArea: document.getElementById('contentArea'),
  pageTitle: document.getElementById('pageTitle'),
  adminName: document.getElementById('adminName'),
  adminAvatar: document.getElementById('adminAvatar')
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {

    const ok = await checkAuth();

    if (!ok) return;

    loadDashboard();

});

// ============================================================
// Authentication
// ============================================================
function checkAuth() {
  const token = localStorage.getItem('adminToken');
  const name = localStorage.getItem('adminName');

  if (!token) {
    window.location.href = '/admin/login.html';
    return;
  }

  if (name) {
    elements.adminName.textContent = name;
    elements.adminAvatar.textContent = name.charAt(0).toUpperCase();
  }
}

function logout() {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminName');
  window.location.href = '/admin/login.html';
}

// ============================================================
// API Calls
// ============================================================
async function apiCall(endpoint, options = {}) {

    const token = localStorage.getItem("adminToken");

    if (!token) {
        window.location.replace("/admin/login.html");
        return;
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    try {

        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers
        });

        let data = {};

        try {
            data = await response.json();
        } catch (_) {}

        if (response.status === 401) {

            localStorage.removeItem("adminToken");
            localStorage.removeItem("adminName");

            window.location.replace("/admin/login.html");
            return;
        }

        if (!response.ok) {
            throw new Error(data.message || `HTTP ${response.status}`);
        }

        return data;

    } catch (err) {

        console.error("API ERROR", err);

        showToast(
            "Server Error",
            err.message || "Network Error",
            "error"
        );

        throw err;
    }

}

// ============================================================
// Navigation
// ============================================================
function switchSection(section) {
  state.currentSection = section;
  
  // Update sidebar
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.classList.remove('active');
  });
  document.querySelector(`.sidebar-nav .nav-link[data-section="${section}"]`)?.classList.add('active');

  // Update title
  const titles = {
    dashboard: '📊 Dashboard',
    classes: '🏫 Classes',
    subjects: '📚 Subjects',
    series: '📋 Series',
    tests: '📝 Tests',
    questions: '❓ Questions'
  };
  elements.pageTitle.textContent = titles[section] || 'Dashboard';

  // Load section data
  switch (section) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'classes':
      loadClasses();
      break;
    case 'subjects':
      loadSubjects();
      break;
    case 'series':
      loadSeries();
      break;
    case 'tests':
      loadTests();
      break;
    case 'questions':
      loadQuestions();
      break;
  }
}

// ============================================================
// Dashboard
// ============================================================
async function loadDashboard() {
  showLoading();

  try {
    const [classesRes, subjectsRes, testsRes] = await Promise.all([
      apiCall('/classes?limit=100'),
      apiCall('/subjects?limit=100'),
      apiCall('/tests?limit=100')
    ]);

    const classes = classesRes.data || [];
    const subjects = subjectsRes.data || [];
    const tests = testsRes.data || [];

    const publishedTests = tests.filter(t => t.isPublished);
    const activeClasses = classes.filter(c => c.isActive);

    elements.contentArea.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div class="stat-box" style="background: rgba(20,30,60,0.03); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 20px; text-align: center;">
          <div style="font-size: 32px; font-weight: 800; color: var(--gold);">${classes.length}</div>
          <div style="font-size: 14px; color: var(--muted);">Total Classes</div>
          <div style="font-size: 12px; color: var(--success);">${activeClasses.length} Active</div>
        </div>
        <div class="stat-box" style="background: rgba(20,30,60,0.03); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 20px; text-align: center;">
          <div style="font-size: 32px; font-weight: 800; color: var(--purple);">${subjects.length}</div>
          <div style="font-size: 14px; color: var(--muted);">Total Subjects</div>
        </div>
        <div class="stat-box" style="background: rgba(20,30,60,0.03); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 20px; text-align: center;">
          <div style="font-size: 32px; font-weight: 800; color: var(--success);">${tests.length}</div>
          <div style="font-size: 14px; color: var(--muted);">Total Tests</div>
          <div style="font-size: 12px; color: var(--success);">${publishedTests.length} Published</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div style="background: rgba(20,30,60,0.02); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 20px;">
          <h3 style="color: var(--white); margin-bottom: 12px;">Recent Classes</h3>
          ${classes.slice(0, 5).map(c => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--card-border);">
              <span style="color: var(--text);">${c.displayName || c.name}</span>
              <span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span>
            </div>
          `).join('') || '<div style="color: var(--muted);">No classes found</div>'}
        </div>
        <div style="background: rgba(20,30,60,0.02); border: 1px solid var(--card-border); border-radius: var(--radius-sm); padding: 20px;">
          <h3 style="color: var(--white); margin-bottom: 12px;">Recent Tests</h3>
          ${tests.slice(0, 5).map(t => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--card-border);">
              <span style="color: var(--text);">${t.title}</span>
              <span class="status-badge ${t.isPublished ? 'published' : 'draft'}">${t.isPublished ? 'Published' : 'Draft'}</span>
            </div>
          `).join('') || '<div style="color: var(--muted);">No tests found</div>'}
        </div>
      </div>
    `;

  } catch (error) {
    console.error('Error loading dashboard:', error);
    showError('Failed to load dashboard', error.message);
  }
}

// ============================================================
// Classes Management
// ============================================================
async function loadClasses() {
  showLoading();

  try {
    const response = await apiCall('/classes?limit=100');
    state.data.classes = response.data || [];

    renderClasses();
  } catch (error) {
    console.error('Error loading classes:', error);
    showError('Failed to load classes', error.message);
  }
}

function renderClasses() {
  const classes = state.data.classes;

  elements.contentArea.innerHTML = `
    <div class="section-header">
      <h2>🏫 Classes <span class="subtitle">(${classes.length})</span></h2>
      <button class="btn btn-primary" onclick="showCreateClassModal()">
        <i class="fas fa-plus"></i> Add Class
      </button>
    </div>

    <div class="search-bar">
      <input type="text" placeholder="Search classes..." id="classSearch" oninput="filterClasses()">
      <select id="classStatusFilter" onchange="filterClasses()">
        <option value="">All Status</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </select>
    </div>

    ${classes.length === 0 ? `
      <div class="empty-state">
        <span class="empty-icon">🏫</span>
        <strong>No Classes Found</strong>
        <span>Click "Add Class" to create your first class.</span>
      </div>
    ` : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Display Name</th>
              <th>Subjects</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${classes.map(c => `
              <tr>
                <td><strong>${c.name}</strong></td>
                <td>${c.displayName}</td>
                <td>${c.subjects?.length || 0}</td>
                <td><span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div class="actions">
                    <button class="btn btn-primary btn-sm" onclick="editClass('${c._id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteClass('${c._id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;
}

function filterClasses() {
  const search = document.getElementById('classSearch')?.value?.toLowerCase() || '';
  const status = document.getElementById('classStatusFilter')?.value;

  let filtered = state.data.classes;

  if (search) {
    filtered = filtered.filter(c => 
      c.name.toLowerCase().includes(search) || 
      c.displayName.toLowerCase().includes(search)
    );
  }

  if (status !== '') {
    filtered = filtered.filter(c => c.isActive === (status === 'true'));
  }

  // Re-render with filtered data
  const originalData = state.data.classes;
  state.data.classes = filtered;
  renderClasses();
  state.data.classes = originalData;
}

function showCreateClassModal() {
  showModal('Create Class', `
    <div class="form-group">
      <label>Class Name *</label>
      <input type="text" id="className" placeholder="e.g., Class 10" required>
    </div>
    <div class="form-group">
      <label>Display Name *</label>
      <input type="text" id="classDisplayName" placeholder="e.g., Class X" required>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="classDescription" placeholder="Optional description"></textarea>
    </div>
  `, async () => {
    const name = document.getElementById('className').value.trim();
    const displayName = document.getElementById('classDisplayName').value.trim();
    const description = document.getElementById('classDescription').value.trim();

    if (!name || !displayName) {
      showToast('Error', 'Class name and display name are required', 'error');
      return;
    }

    try {
      await apiCall('/classes', {
        method: 'POST',
        body: JSON.stringify({ name, displayName, description })
      });

      showToast('Success', 'Class created successfully', 'success');
      closeModal();
      loadClasses();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function editClass(id) {
  const cls = state.data.classes.find(c => c._id === id);
  if (!cls) return;

  showModal('Edit Class', `
    <div class="form-group">
      <label>Class Name *</label>
      <input type="text" id="editClassName" value="${cls.name}" required>
    </div>
    <div class="form-group">
      <label>Display Name *</label>
      <input type="text" id="editClassDisplayName" value="${cls.displayName}" required>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="editClassDescription">${cls.description || ''}</textarea>
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="editClassActive" ${cls.isActive ? 'checked' : ''}>
        Active
      </label>
    </div>
  `, async () => {
    const name = document.getElementById('editClassName').value.trim();
    const displayName = document.getElementById('editClassDisplayName').value.trim();
    const description = document.getElementById('editClassDescription').value.trim();
    const isActive = document.getElementById('editClassActive').checked;

    if (!name || !displayName) {
      showToast('Error', 'Class name and display name are required', 'error');
      return;
    }

    try {
      await apiCall(`/classes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, displayName, description, isActive })
      });

      showToast('Success', 'Class updated successfully', 'success');
      closeModal();
      loadClasses();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function deleteClass(id) {
  if (!confirm('Are you sure you want to delete this class? This cannot be undone.')) return;

  try {
    await apiCall(`/classes/${id}`, { method: 'DELETE' });
    showToast('Success', 'Class deleted successfully', 'success');
    loadClasses();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

// ============================================================
// Subjects Management
// ============================================================
async function loadSubjects() {
  showLoading();

  try {
    const [subjectsRes, classesRes] = await Promise.all([
      apiCall('/subjects?limit=100'),
      apiCall('/classes?limit=100')
    ]);

    state.data.subjects = subjectsRes.data || [];
    state.data.classes = classesRes.data || [];

    renderSubjects();
  } catch (error) {
    console.error('Error loading subjects:', error);
    showError('Failed to load subjects', error.message);
  }
}

function renderSubjects() {
  const subjects = state.data.subjects;
  const classes = state.data.classes;

  elements.contentArea.innerHTML = `
    <div class="section-header">
      <h2>📚 Subjects <span class="subtitle">(${subjects.length})</span></h2>
      <button class="btn btn-primary" onclick="showCreateSubjectModal()">
        <i class="fas fa-plus"></i> Add Subject
      </button>
    </div>

    <div class="search-bar">
      <input type="text" placeholder="Search subjects..." id="subjectSearch" oninput="filterSubjects()">
      <select id="subjectClassFilter" onchange="filterSubjects()">
        <option value="">All Classes</option>
        ${classes.map(c => `<option value="${c._id}">${c.displayName}</option>`).join('')}
      </select>
    </div>

    ${subjects.length === 0 ? `
      <div class="empty-state">
        <span class="empty-icon">📚</span>
        <strong>No Subjects Found</strong>
        <span>Click "Add Subject" to create your first subject.</span>
      </div>
    ` : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Class</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${subjects.map(s => {
              const cls = classes.find(c => c._id === s.classId);
              return `
                <tr>
                  <td><strong>${s.name}</strong></td>
                  <td>${s.code}</td>
                  <td>${cls?.displayName || 'N/A'}</td>
                  <td><span class="status-badge ${s.isActive ? 'active' : 'inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-primary btn-sm" onclick="editSubject('${s._id}')">Edit</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s._id}')">Delete</button>
                    </div>
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

function filterSubjects() {
  const search = document.getElementById('subjectSearch')?.value?.toLowerCase() || '';
  const classId = document.getElementById('subjectClassFilter')?.value;

  let filtered = state.data.subjects;

  if (search) {
    filtered = filtered.filter(s => 
      s.name.toLowerCase().includes(search) || 
      s.code.toLowerCase().includes(search)
    );
  }

  if (classId) {
    filtered = filtered.filter(s => s.classId === classId);
  }

  const originalData = state.data.subjects;
  state.data.subjects = filtered;
  renderSubjects();
  state.data.subjects = originalData;
}

function showCreateSubjectModal() {
  const classes = state.data.classes;

  showModal('Create Subject', `
    <div class="form-group">
      <label>Subject Name *</label>
      <input type="text" id="subjectName" placeholder="e.g., Mathematics" required>
    </div>
    <div class="form-group">
      <label>Subject Code *</label>
      <input type="text" id="subjectCode" placeholder="e.g., MATH101" required>
    </div>
    <div class="form-group">
      <label>Class *</label>
      <select id="subjectClass" required>
        <option value="">Select Class</option>
        ${classes.filter(c => c.isActive).map(c => 
          `<option value="${c._id}">${c.displayName}</option>`
        ).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="subjectDescription" placeholder="Optional description"></textarea>
    </div>
  `, async () => {
    const name = document.getElementById('subjectName').value.trim();
    const code = document.getElementById('subjectCode').value.trim();
    const classId = document.getElementById('subjectClass').value;
    const description = document.getElementById('subjectDescription').value.trim();

    if (!name || !code || !classId) {
      showToast('Error', 'Name, code, and class are required', 'error');
      return;
    }

    try {
      await apiCall('/subjects', {
        method: 'POST',
        body: JSON.stringify({ name, code, classId, description })
      });

      showToast('Success', 'Subject created successfully', 'success');
      closeModal();
      loadSubjects();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function editSubject(id) {
  const subject = state.data.subjects.find(s => s._id === id);
  if (!subject) return;
  const classes = state.data.classes;

  showModal('Edit Subject', `
    <div class="form-group">
      <label>Subject Name *</label>
      <input type="text" id="editSubjectName" value="${subject.name}" required>
    </div>
    <div class="form-group">
      <label>Subject Code *</label>
      <input type="text" id="editSubjectCode" value="${subject.code}" required>
    </div>
    <div class="form-group">
      <label>Class *</label>
      <select id="editSubjectClass" required>
        ${classes.filter(c => c.isActive).map(c => 
          `<option value="${c._id}" ${c._id === subject.classId ? 'selected' : ''}>${c.displayName}</option>`
        ).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="editSubjectDescription">${subject.description || ''}</textarea>
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="editSubjectActive" ${subject.isActive ? 'checked' : ''}>
        Active
      </label>
    </div>
  `, async () => {
    const name = document.getElementById('editSubjectName').value.trim();
    const code = document.getElementById('editSubjectCode').value.trim();
    const classId = document.getElementById('editSubjectClass').value;
    const description = document.getElementById('editSubjectDescription').value.trim();
    const isActive = document.getElementById('editSubjectActive').checked;

    if (!name || !code || !classId) {
      showToast('Error', 'Name, code, and class are required', 'error');
      return;
    }

    try {
      await apiCall(`/subjects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, code, classId, description, isActive })
      });

      showToast('Success', 'Subject updated successfully', 'success');
      closeModal();
      loadSubjects();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function deleteSubject(id) {
  if (!confirm('Are you sure you want to delete this subject? This cannot be undone.')) return;

  try {
    await apiCall(`/subjects/${id}`, { method: 'DELETE' });
    showToast('Success', 'Subject deleted successfully', 'success');
    loadSubjects();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

// ============================================================
// Series Management (Similar pattern - abbreviated for brevity)
// ============================================================
async function loadSeries() {
  showLoading();

  try {
    const [seriesRes, subjectsRes] = await Promise.all([
      apiCall('/series?limit=100'),
      apiCall('/subjects?limit=100')
    ]);

    state.data.series = seriesRes.data || [];
    state.data.subjects = subjectsRes.data || [];

    renderSeries();
  } catch (error) {
    console.error('Error loading series:', error);
    showError('Failed to load series', error.message);
  }
}

function renderSeries() {
  const series = state.data.series;
  const subjects = state.data.subjects;

  elements.contentArea.innerHTML = `
    <div class="section-header">
      <h2>📋 Series <span class="subtitle">(${series.length})</span></h2>
      <button class="btn btn-primary" onclick="showCreateSeriesModal()">
        <i class="fas fa-plus"></i> Add Series
      </button>
    </div>

    ${series.length === 0 ? `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <strong>No Series Found</strong>
        <span>Click "Add Series" to create your first test series.</span>
      </div>
    ` : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${series.map(s => {
              const subject = subjects.find(sub => sub._id === s.subjectId);
              return `
                <tr>
                  <td><strong>${s.name}</strong></td>
                  <td>${s.type}</td>
                  <td>${subject?.name || 'N/A'}</td>
                  <td><span class="status-badge ${s.isActive ? 'active' : 'inactive'}">${s.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-primary btn-sm" onclick="editSeries('${s._id}')">Edit</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteSeries('${s._id}')">Delete</button>
                    </div>
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

function showCreateSeriesModal() {
  const subjects = state.data.subjects;

  showModal('Create Series', `
    <div class="form-group">
      <label>Series Name *</label>
      <input type="text" id="seriesName" placeholder="e.g., Chapter Wise Tests" required>
    </div>
    <div class="form-group">
      <label>Type</label>
      <select id="seriesType">
        <option value="chapter-wise">Chapter Wise</option>
        <option value="weekly">Weekly</option>
        <option value="revision">Revision</option>
        <option value="mock">Mock</option>
        <option value="sample-paper">Sample Paper</option>
        <option value="other">Other</option>
      </select>
    </div>
    <div class="form-group">
      <label>Subject *</label>
      <select id="seriesSubject" required>
        <option value="">Select Subject</option>
        ${subjects.filter(s => s.isActive).map(s => 
          `<option value="${s._id}">${s.name}</option>`
        ).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="seriesDescription" placeholder="Optional description"></textarea>
    </div>
  `, async () => {
    const name = document.getElementById('seriesName').value.trim();
    const type = document.getElementById('seriesType').value;
    const subjectId = document.getElementById('seriesSubject').value;
    const description = document.getElementById('seriesDescription').value.trim();

    if (!name || !subjectId) {
      showToast('Error', 'Name and subject are required', 'error');
      return;
    }

    try {
      // Get classId from subject
      const subject = subjects.find(s => s._id === subjectId);
      if (!subject) {
        showToast('Error', 'Subject not found', 'error');
        return;
      }

      await apiCall('/series', {
        method: 'POST',
        body: JSON.stringify({ name, type, subjectId, classId: subject.classId, description })
      });

      showToast('Success', 'Series created successfully', 'success');
      closeModal();
      loadSeries();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function editSeries(id) {
  // Similar to editSubject - implement similarly
  showToast('Info', 'Edit series functionality coming soon', 'info');
}

async function deleteSeries(id) {
  if (!confirm('Are you sure you want to delete this series? This cannot be undone.')) return;

  try {
    await apiCall(`/series/${id}`, { method: 'DELETE' });
    showToast('Success', 'Series deleted successfully', 'success');
    loadSeries();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

// ============================================================
// Tests Management
// ============================================================
async function loadTests() {
  showLoading();

  try {
    const [testsRes, seriesRes] = await Promise.all([
      apiCall('/tests?limit=100'),
      apiCall('/series?limit=100')
    ]);

    state.data.tests = testsRes.data || [];
    state.data.series = seriesRes.data || [];

    renderTests();
  } catch (error) {
    console.error('Error loading tests:', error);
    showError('Failed to load tests', error.message);
  }
}

function renderTests() {
  const tests = state.data.tests;
  const series = state.data.series;

  elements.contentArea.innerHTML = `
    <div class="section-header">
      <h2>📝 Tests <span class="subtitle">(${tests.length})</span></h2>
      <button class="btn btn-primary" onclick="showCreateTestModal()">
        <i class="fas fa-plus"></i> Add Test
      </button>
    </div>

    ${tests.length === 0 ? `
      <div class="empty-state">
        <span class="empty-icon">📝</span>
        <strong>No Tests Found</strong>
        <span>Click "Add Test" to create your first test.</span>
      </div>
    ` : `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Series</th>
              <th>Questions</th>
              <th>Marks</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tests.map(t => {
              const ser = series.find(s => s._id === t.seriesId);
              return `
                <tr>
                  <td><strong>${t.title}</strong></td>
                  <td>${ser?.name || 'N/A'}</td>
                  <td>${t.totalQuestions || 0}</td>
                  <td>${t.totalMarks}</td>
                  <td>
                    <span class="status-badge ${t.isPublished ? 'published' : 'draft'}">
                      ${t.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-success btn-sm" onclick="togglePublish('${t._id}', ${!t.isPublished})">
                        ${t.isPublished ? 'Unpublish' : 'Publish'}
                      </button>
                      <button class="btn btn-primary btn-sm" onclick="editTest('${t._id}')">Edit</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteTest('${t._id}')">Delete</button>
                    </div>
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

function showCreateTestModal() {
  const series = state.data.series;

  showModal('Create Test', `
    <div class="form-group">
      <label>Test Title *</label>
      <input type="text" id="testTitle" placeholder="e.g., Chapter 1 Test" required>
    </div>
    <div class="form-group">
      <label>Series *</label>
      <select id="testSeries" required>
        <option value="">Select Series</option>
        ${series.filter(s => s.isActive).map(s => 
          `<option value="${s._id}">${s.name}</option>`
        ).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Total Marks *</label>
        <input type="number" id="testTotalMarks" value="100" required>
      </div>
      <div class="form-group">
        <label>Passing Marks *</label>
        <input type="number" id="testPassingMarks" value="40" required>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Duration (minutes) *</label>
        <input type="number" id="testDuration" value="60" required>
      </div>
      <div class="form-group">
        <label>Max Attempts</label>
        <input type="number" id="testMaxAttempts" value="1">
      </div>
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea id="testDescription" placeholder="Test description"></textarea>
    </div>
  `, async () => {
    const title = document.getElementById('testTitle').value.trim();
    const seriesId = document.getElementById('testSeries').value;
    const totalMarks = parseInt(document.getElementById('testTotalMarks').value);
    const passingMarks = parseInt(document.getElementById('testPassingMarks').value);
    const duration = parseInt(document.getElementById('testDuration').value);
    const maximumAttempts = parseInt(document.getElementById('testMaxAttempts').value) || 1;
    const description = document.getElementById('testDescription').value.trim();

    if (!title || !seriesId || !totalMarks || !passingMarks || !duration) {
      showToast('Error', 'All required fields must be filled', 'error');
      return;
    }

    try {
      const seriesData = series.find(s => s._id === seriesId);
      if (!seriesData) {
        showToast('Error', 'Series not found', 'error');
        return;
      }

      await apiCall('/tests', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          seriesId,
          subjectId: seriesData.subjectId,
          classId: seriesData.classId,
          totalMarks,
          passingMarks,
          duration,
          maximumAttempts,
          negativeMarking: { enabled: false, value: 0 }
        })
      });

      showToast('Success', 'Test created successfully', 'success');
      closeModal();
      loadTests();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function togglePublish(id, publish) {
  try {
    await apiCall(`/tests/${id}/${publish ? 'publish' : 'unpublish'}`, { method: 'POST' });
    showToast('Success', `Test ${publish ? 'published' : 'unpublished'} successfully`, 'success');
    loadTests();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

async function editTest(id) {
  showToast('Info', 'Edit test functionality coming soon', 'info');
}

async function deleteTest(id) {
  if (!confirm('Are you sure you want to delete this test? This cannot be undone.')) return;

  try {
    await apiCall(`/tests/${id}`, { method: 'DELETE' });
    showToast('Success', 'Test deleted successfully', 'success');
    loadTests();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

// ============================================================
// Questions Management
// ============================================================
async function loadQuestions() {
  showLoading();

  try {
    const testsRes = await apiCall('/tests?limit=100');
    state.data.tests = testsRes.data || [];

    renderQuestions();
  } catch (error) {
    console.error('Error loading questions:', error);
    showError('Failed to load questions', error.message);
  }
}

function renderQuestions() {
  const tests = state.data.tests;

  elements.contentArea.innerHTML = `
    <div class="section-header">
      <h2>❓ Questions <span class="subtitle">Manage test questions</span></h2>
    </div>

    <div class="search-bar">
      <select id="questionTestFilter" onchange="loadQuestionsForTest()">
        <option value="">Select Test</option>
        ${tests.filter(t => t.isPublished).map(t => 
          `<option value="${t._id}">${t.title}</option>`
        ).join('')}
      </select>
      <button class="btn btn-primary" onclick="showAddQuestionModal()">
        <i class="fas fa-plus"></i> Add Question
      </button>
    </div>

    <div id="questionList">
      <div class="empty-state">
        <span class="empty-icon">❓</span>
        <strong>Select a test to manage questions</strong>
        <span>Choose a test from the dropdown above to view and manage its questions.</span>
      </div>
    </div>
  `;
}

async function loadQuestionsForTest() {
  const testId = document.getElementById('questionTestFilter').value;
  if (!testId) {
    document.getElementById('questionList').innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">❓</span>
        <strong>Select a test to manage questions</strong>
        <span>Choose a test from the dropdown above to view and manage its questions.</span>
      </div>
    `;
    return;
  }

  try {
    const response = await apiCall(`/tests/${testId}/questions?limit=100`);
    const questions = response.data || [];

    document.getElementById('questionList').innerHTML = `
      ${questions.length === 0 ? `
        <div class="empty-state">
          <span class="empty-icon">📝</span>
          <strong>No Questions Found</strong>
          <span>Click "Add Question" to add questions to this test.</span>
        </div>
      ` : `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Question</th>
                <th>Type</th>
                <th>Marks</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${questions.map((q, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${q.questionText.substring(0, 60)}${q.questionText.length > 60 ? '...' : ''}</td>
                  <td>${q.type || 'MCQ'}</td>
                  <td>${q.marks}</td>
                  <td>
                    <div class="actions">
                      <button class="btn btn-primary btn-sm" onclick="editQuestion('${q._id}')">Edit</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q._id}')">Delete</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

function showAddQuestionModal() {
  const testId = document.getElementById('questionTestFilter').value;
  if (!testId) {
    showToast('Error', 'Please select a test first', 'error');
    return;
  }

  showModal('Add Question', `
    <div class="form-group">
      <label>Question Text *</label>
      <textarea id="questionText" placeholder="Enter the question" required></textarea>
    </div>
    <div class="form-group">
      <label>Options (one per line, first option is correct)</label>
      <textarea id="questionOptions" placeholder="Option A&#10;Option B&#10;Option C&#10;Option D"></textarea>
      <div class="helper-text">Enter each option on a new line. The first option will be marked as correct.</div>
    </div>
    <div class="form-group">
      <label>Marks *</label>
      <input type="number" id="questionMarks" value="1" required>
    </div>
    <div class="form-group">
      <label>Explanation (optional)</label>
      <textarea id="questionExplanation" placeholder="Explanation for the correct answer"></textarea>
    </div>
  `, async () => {
    const questionText = document.getElementById('questionText').value.trim();
    const optionsText = document.getElementById('questionOptions').value.trim();
    const marks = parseInt(document.getElementById('questionMarks').value);
    const explanation = document.getElementById('questionExplanation').value.trim();

    if (!questionText || !optionsText) {
      showToast('Error', 'Question text and options are required', 'error');
      return;
    }

    const options = optionsText.split('\n').filter(o => o.trim());
    if (options.length < 2) {
      showToast('Error', 'At least 2 options are required', 'error');
      return;
    }

    const optionsData = options.map((text, index) => ({
      text: text.trim(),
      isCorrect: index === 0
    }));

    try {
      await apiCall(`/tests/${testId}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          questionText,
          options: optionsData,
          correctAnswer: options[0].trim(),
          explanation,
          marks,
          type: 'mcq'
        })
      });

      showToast('Success', 'Question added successfully', 'success');
      closeModal();
      loadQuestionsForTest();
    } catch (error) {
      showToast('Error', error.message, 'error');
    }
  });
}

async function editQuestion(id) {
  showToast('Info', 'Edit question functionality coming soon', 'info');
}

async function deleteQuestion(id) {
  if (!confirm('Are you sure you want to delete this question?')) return;

  try {
    await apiCall(`/questions/${id}`, { method: 'DELETE' });
    showToast('Success', 'Question deleted successfully', 'success');
    loadQuestionsForTest();
  } catch (error) {
    showToast('Error', error.message, 'error');
  }
}

// ============================================================
// Modal Functions
// ============================================================
function showModal(title, bodyHtml, onSave) {
  // Remove existing modal if any
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <div class="modal-subtitle">Fill in the details below</div>
      <div id="modalBody">${bodyHtml}</div>
      <div class="btn-group">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" id="modalSaveBtn">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Handle save
  const saveBtn = overlay.querySelector('#modalSaveBtn');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      await onSave();
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  // Handle close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

function closeModal() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-message">${message}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// Utility Functions
// ============================================================
function showLoading() {
  elements.contentArea.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  `;
}

function showError(title, message) {
  elements.contentArea.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">⚠️</span>
      <strong>${title}</strong>
      <span>${message}</span>
      <button class="btn btn-primary" onclick="switchSection('${state.currentSection}')" style="margin-top:16px;">
        <i class="fas fa-refresh"></i> Retry
      </button>
    </div>
  `;
}

// ============================================================
// Make functions globally accessible
// ============================================================
window.switchSection = switchSection;
window.logout = logout;
window.loadClasses = loadClasses;
window.loadSubjects = loadSubjects;
window.loadSeries = loadSeries;
window.loadTests = loadTests;
window.loadQuestions = loadQuestions;
window.filterClasses = filterClasses;
window.filterSubjects = filterSubjects;
window.showCreateClassModal = showCreateClassModal;
window.showCreateSubjectModal = showCreateSubjectModal;
window.showCreateSeriesModal = showCreateSeriesModal;
window.showCreateTestModal = showCreateTestModal;
window.showAddQuestionModal = showAddQuestionModal;
window.editClass = editClass;
window.editSubject = editSubject;
window.editSeries = editSeries;
window.editTest = editTest;
window.editQuestion = editQuestion;
window.deleteClass = deleteClass;
window.deleteSubject = deleteSubject;
window.deleteSeries = deleteSeries;
window.deleteTest = deleteTest;
window.deleteQuestion = deleteQuestion;
window.togglePublish = togglePublish;
window.loadQuestionsForTest = loadQuestionsForTest;
window.showModal = showModal;
window.closeModal = closeModal;
window.showToast = showToast;