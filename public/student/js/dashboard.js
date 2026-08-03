// Student Dashboard JavaScript

// FIX (security, audit 2026-07): escapeHTML() added — subject/series/test
// names & descriptions and toast messages are dynamic content interpolated
// into innerHTML. Same helper pattern already used in js/results.js and
// js/test.js.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// API Base URL
const API_BASE = '/api/student';

// State
let state = {
    view: 'dashboard', // dashboard | subjects | series | tests
    subjectId: null,
    seriesId: null,
    testId: null,
    breadcrumb: ['Dashboard']
};

// DOM Elements
const contentArea = document.getElementById('contentArea');
const loadingIndicator = document.getElementById('loadingIndicator');
const subjectsGrid = document.getElementById('subjectsGrid');
const breadcrumb = document.getElementById('breadcrumb');
const welcomeName = document.getElementById('welcomeName');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userClass = document.getElementById('userClass');

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadDashboard();
});

// ==================== Authentication ====================

async function checkAuth() {
    const token = localStorage.getItem('studentToken');

    if (!token) {
        window.location.replace('/student/login.html');
        return false;
    }

    try {
        const res = await fetch('/api/auth/verify', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const result = await res.json();

        if (!res.ok || !result.success) {
            throw new Error("Invalid token");
        }

        localStorage.setItem('studentName', result.data.name);

        if (userName) userName.textContent = result.data.name;
        if (welcomeName) welcomeName.textContent = result.data.name;
        if (userAvatar) userAvatar.textContent = result.data.name.charAt(0).toUpperCase();

        return true;

    } catch (err) {

        localStorage.removeItem('studentToken');
        localStorage.removeItem('studentName');
        localStorage.removeItem('userClass');

        window.location.replace('/student/login.html');
        return false;
    }
}

function logout() {
    localStorage.removeItem('studentToken');
    localStorage.removeItem('studentName');
    localStorage.removeItem('userClass');
    window.location.href = '/student/login.html';
}

// ==================== API Calls ====================

async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('studentToken');
    if (!token) {
        window.location.href = '/student/login.html';
        return;
    }

    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...defaultOptions,
        ...options
    });

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem('studentToken');
            window.location.href = '/student/login.html';
        }
        throw new Error(data.message || 'Something went wrong');
    }

    return data;
}

// ==================== Dashboard Loading ====================

async function loadDashboard() {
    try {
        showLoading();
        
        const response = await apiCall('/dashboard');
        const { data } = response;
        
        // Update user info
        if (data.student) {
            welcomeName.textContent = data.student.name;
            userName.textContent = data.student.name;
            userAvatar.textContent = data.student.name.charAt(0).toUpperCase();
            if (data.student.class) {
                userClass.textContent = data.student.class;
            }
        }
        
        // Render subjects
        renderSubjects(data.subjects);
        
        hideLoading();
    } catch (error) {
        hideLoading();
        showToast('Error', error.message, 'error');
        console.error('Dashboard load error:', error);
    }
}

// ==================== Rendering Functions ====================

function renderSubjects(subjects) {
    subjectsGrid.style.display = 'grid';
    loadingIndicator.style.display = 'none';
    
    if (!subjects || subjects.length === 0) {
        subjectsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="empty-state-icon">📚</div>
                <h3>No Subjects Available</h3>
                <p>Your class doesn't have any subjects assigned yet.</p>
            </div>
        `;
        return;
    }

    subjectsGrid.innerHTML = subjects.map(subject => `
        <div class="card subject-card" onclick="loadSeries('${subject._id}')">
            <div class="card-icon">📘</div>
            <div class="card-title">${escapeHTML(subject.name)}</div>
            <div class="card-description">${escapeHTML(subject.description) || 'Click to view available test series'}</div>
            <div class="card-actions">
                <button class="btn-view" onclick="event.stopPropagation(); loadSeries('${subject._id}')">View Series</button>
            </div>
        </div>
    `).join('');
}

function renderSeries(series, subjectName) {
    subjectsGrid.style.display = 'grid';
    loadingIndicator.style.display = 'none';
    
    if (!series || series.length === 0) {
        subjectsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="empty-state-icon">📋</div>
                <h3>No Test Series Available</h3>
                <p>No test series available for ${escapeHTML(subjectName)} yet.</p>
                <button class="btn-back" onclick="loadDashboard()" style="margin-top: 1rem;">← Back to Subjects</button>
            </div>
        `;
        return;
    }

    subjectsGrid.innerHTML = series.map(serie => `
        <div class="card series-card" onclick="loadTests('${serie._id}')">
            <div class="card-icon">📝</div>
            <div class="series-type">${formatSeriesType(serie.type)}</div>
            <div class="card-title">${escapeHTML(serie.name)}</div>
            <div class="card-description">${escapeHTML(serie.description) || 'Click to view available tests'}</div>
            <div class="card-actions">
                <button class="btn-view" onclick="event.stopPropagation(); loadTests('${serie._id}')">View Tests</button>
            </div>
        </div>
    `).join('');
}

function renderTests(tests, seriesName) {
    subjectsGrid.style.display = 'grid';
    loadingIndicator.style.display = 'none';
    
    if (!tests || tests.length === 0) {
        subjectsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1;">
                <div class="empty-state-icon">📝</div>
                <h3>No Tests Available</h3>
                <p>No tests available in ${escapeHTML(seriesName)} yet.</p>
                <button class="btn-back" onclick="loadSeries('${state.subjectId}')" style="margin-top: 1rem;">← Back to Series</button>
            </div>
        `;
        return;
    }

    subjectsGrid.innerHTML = tests.map(test => {
        const status = getTestStatus(test);
        const statusBadge = getStatusBadge(status);
        const actionButton = getActionButton(test, status);
        
        return `
            <div class="card test-card">
                <div class="card-icon">📄</div>
                <div class="card-title">${escapeHTML(test.title)}</div>
                <div class="card-description">${escapeHTML(test.description) || 'No description available'}</div>
                <div class="test-meta">
                    <span>⏱️ ${test.duration} min</span>
                    <span>📊 ${test.totalMarks} marks</span>
                    <span>🔄 ${test.attemptsMade || 0}/${test.maximumAttempts} attempts</span>
                </div>
                <div style="margin: 0.5rem 0;">
                    ${statusBadge}
                </div>
                <div class="card-actions">
                    ${actionButton}
                </div>
            </div>
        `;
    }).join('');
}

// ==================== Navigation Functions ====================

async function loadSeries(subjectId) {
    try {
        state.subjectId = subjectId;
        state.view = 'series';
        updateBreadcrumb(['Dashboard', 'Subjects']);
        
        showLoading();
        
        const response = await apiCall(`/subjects/${subjectId}/series`);
        const { data } = response;
        
        // Get subject name
        const subjectCard = document.querySelector(`[onclick="loadSeries('${subjectId}')"]`);
        const subjectName = subjectCard ? subjectCard.querySelector('.card-title').textContent : 'Subject';
        
        renderSeries(data, subjectName);
        hideLoading();
    } catch (error) {
        hideLoading();
        showToast('Error', error.message, 'error');
        console.error('Series load error:', error);
    }
}

async function loadTests(seriesId) {
    try {
        state.seriesId = seriesId;
        state.view = 'tests';
        updateBreadcrumb(['Dashboard', 'Subjects', 'Series']);
        
        showLoading();
        
        const response = await apiCall(`/series/${seriesId}/tests`);
        const { data } = response;
        
        // Get series name
        const seriesCard = document.querySelector(`[onclick="loadTests('${seriesId}')"]`);
        const seriesName = seriesCard ? seriesCard.querySelector('.card-title').textContent : 'Series';
        
        renderTests(data, seriesName);
        hideLoading();
    } catch (error) {
        hideLoading();
        showToast('Error', error.message, 'error');
        console.error('Tests load error:', error);
    }
}

function loadTestDetails(testId) {
    window.location.href = `/student/test.html?id=${testId}`;
}

function resumeTest(attemptId) {
    window.location.href = `/student/test.html?attempt=${attemptId}`;
}

// ==================== Helper Functions ====================

function updateBreadcrumb(items) {
    breadcrumb.innerHTML = items.map((item, index) => {
        const isLast = index === items.length - 1;
        return `
            <span class="breadcrumb-item ${isLast ? 'active' : ''}" 
                  onclick="${isLast ? '' : `navigateTo('${item.toLowerCase()}')`}">
                ${item}
            </span>
            ${!isLast ? '<span class="breadcrumb-separator">›</span>' : ''}
        `;
    }).join('');
}

function navigateTo(view) {
    if (view === 'dashboard') {
        loadDashboard();
        state.view = 'dashboard';
        updateBreadcrumb(['Dashboard']);
    } else if (view === 'subjects' && state.subjectId) {
        loadSeries(state.subjectId);
    } else if (view === 'series' && state.seriesId) {
        loadTests(state.seriesId);
    }
}

function showLoading() {
    loadingIndicator.style.display = 'block';
    subjectsGrid.style.display = 'none';
}

function hideLoading() {
    loadingIndicator.style.display = 'none';
    subjectsGrid.style.display = 'grid';
}

function formatSeriesType(type) {
    const types = {
        'chapter-wise': '📖 Chapter Wise',
        'weekly': '📅 Weekly Test',
        'revision': '🔄 Revision',
        'mock': '🎯 Mock Test',
        'sample-paper': '📋 Sample Paper',
        'other': '📝 Other'
    };
    return types[type] || type;
}

function getTestStatus(test) {
    if (test.hasActiveAttempt) return 'in-progress';
    if (!test.canAttempt) {
        if (test.attemptsMade >= test.maximumAttempts) return 'completed';
        if (test.isScheduled) {
            const now = new Date();
            const start = new Date(test.startDate);
            const end = new Date(test.endDate);
            if (now < start) return 'upcoming';
            if (now > end) return 'expired';
        }
        return 'unavailable';
    }
    return 'available';
}

function getStatusBadge(status) {
    const badges = {
        'available': '<span class="test-status status-available">✅ Available</span>',
        'in-progress': '<span class="test-status status-in-progress">⏳ In Progress</span>',
        'completed': '<span class="test-status status-expired">✅ Completed</span>',
        'upcoming': '<span class="test-status status-upcoming">📅 Upcoming</span>',
        'expired': '<span class="test-status status-expired">⏰ Expired</span>',
        'unavailable': '<span class="test-status status-expired">🚫 Unavailable</span>'
    };
    return badges[status] || badges.unavailable;
}

function getActionButton(test, status) {
    if (status === 'in-progress' && test.activeAttemptId) {
        return `<button class="btn-resume" onclick="resumeTest('${test.activeAttemptId}')">▶ Resume Test</button>`;
    }
    
    if (status === 'available') {
        return `<button class="btn-start" onclick="loadTestDetails('${test._id}')">▶ Start Test</button>`;
    }
    
    if (status === 'completed') {
        return `<button class="btn-view" onclick="viewResult('${test._id}')">📊 View Result</button>`;
    }
    
    return `<button class="btn-start" disabled>${status === 'upcoming' ? '📅 Coming Soon' : '🚫 Not Available'}</button>`;
}

function viewResult(testId) {
    window.location.href = `/student/results.html?test=${testId}`;
}

// ==================== Toast Notifications ====================

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-title">${escapeHTML(title)}</div>
        <div class="toast-message">${escapeHTML(message)}</div>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ==================== Error Handling ====================

// Global error handler
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    showToast('Error', 'An unexpected error occurred. Please try again.', 'error');
});

// ==================== Keyboard Shortcuts ====================

document.addEventListener('keydown', (event) => {
    // Escape key to go back
    if (event.key === 'Escape') {
        const breadcrumbItems = breadcrumb.querySelectorAll('.breadcrumb-item');
        if (breadcrumbItems.length > 1) {
            const prevItem = breadcrumbItems[breadcrumbItems.length - 2];
            if (prevItem && !prevItem.classList.contains('active')) {
                prevItem.click();
            }
        }
    }
});