// Results JavaScript
const API_BASE = '/api/student';

// State
let state = {
  resultId: null,
  testId: null,
  result: null,
  analysis: null,
  currentFilter: 'all'
};

// ============================================================
// DOM Elements
// ============================================================
const elements = {
  resultSummary: document.getElementById('resultSummary'),
  analysisContainer: document.getElementById('analysisContainer'),
  filterBtns: document.querySelectorAll('.filter-btn')
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const resultId = urlParams.get('result');
  const testId = urlParams.get('test');

  if (resultId) {
    state.resultId = resultId;
    loadResult(resultId);
    loadAnalysis(resultId);
  } else if (testId) {
    state.testId = testId;
    loadTestResult(testId);
  } else {
    showError('No result specified', 'Please select a result from your dashboard.');
  }

  // Setup filter buttons
  elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderAnalysis();
    });
  });
});

// ============================================================
// API Calls
// ============================================================
async function apiCall(endpoint) {
  const token = localStorage.getItem('studentToken');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('studentToken');
        window.location.href = 'login.html';
      }
      throw new Error(data.message || 'Something went wrong');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ============================================================
// Load Functions
// ============================================================
async function loadResult(resultId) {
  try {
    const response = await apiCall(`/results/${resultId}`);
    state.result = response.data;

    if (response.data) {
      renderResultSummary(response.data);
    }
  } catch (error) {
    console.error('Error loading result:', error);
    showError('Error loading result', error.message);
  }
}

async function loadAnalysis(resultId) {
  try {
    const response = await apiCall(`/results/${resultId}/analysis`);
    state.analysis = response.data;
    renderAnalysis();
  } catch (error) {
    console.error('Error loading analysis:', error);
    showError('Error loading analysis', error.message);
  }
}

async function loadTestResult(testId) {
  try {
    const response = await apiCall(`/tests/${testId}/rank`);
    // If we have rank, we can get the result from there
    if (response.data) {
      state.result = response.data;
      renderResultSummary(response.data);
    }
  } catch (error) {
    console.error('Error loading test result:', error);
    showError('Error loading result', error.message);
  }
}

// ============================================================
// Render Functions
// ============================================================
function renderResultSummary(result) {
  const isPassed = result.isPassed;
  const percentage = result.percentage || 0;

  elements.resultSummary.innerHTML = `
    <div class="result-header">
      <div>
        <h2>📊 Test Results</h2>
        <div class="subtitle">${result.testId?.title || 'Test'}</div>
      </div>
      <div class="result-status ${isPassed ? 'passed' : 'failed'}">
        ${isPassed ? '✅ Passed' : '❌ Failed'}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <span class="stat-value gold">${result.marksObtained || 0}</span>
        <span class="stat-label">Marks Obtained</span>
      </div>
      <div class="stat-box">
        <span class="stat-value">${result.totalMarks || 0}</span>
        <span class="stat-label">Total Marks</span>
      </div>
      <div class="stat-box">
        <span class="stat-value ${percentage >= 40 ? 'success' : 'danger'}">${percentage}%</span>
        <span class="stat-label">Percentage</span>
      </div>
      <div class="stat-box">
        <span class="stat-value purple">${result.rank || '-'}</span>
        <span class="stat-label">Rank</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <span class="stat-value success">${result.correctAnswers || 0}</span>
        <span class="stat-label">Correct</span>
      </div>
      <div class="stat-box">
        <span class="stat-value danger">${result.incorrectAnswers || 0}</span>
        <span class="stat-label">Incorrect</span>
      </div>
      <div class="stat-box">
        <span class="stat-value muted">${result.unansweredQuestions || 0}</span>
        <span class="stat-label">Unanswered</span>
      </div>
      <div class="stat-box">
        <span class="stat-value">${formatTime(result.timeTaken || 0)}</span>
        <span class="stat-label">Time Taken</span>
      </div>
    </div>

    ${result.totalStudents ? `
      <div class="rank-badge">
        <span class="rank-label">🏆 Rank</span>
        <span class="rank-number">#${result.rank || '-'}</span>
        <span class="rank-label">out of ${result.totalStudents} students</span>
      </div>
    ` : ''}
  `;
}

function renderAnalysis() {
  if (!state.analysis) {
    elements.analysisContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📊</span>
        <strong>No analysis available</strong>
        <span>Detailed question analysis is not available for this result.</span>
      </div>
    `;
    return;
  }

  const questions = state.analysis.questions || [];
  
  // Filter questions
  let filteredQuestions = questions;
  if (state.currentFilter === 'correct') {
    filteredQuestions = questions.filter(q => q.isCorrect);
  } else if (state.currentFilter === 'wrong') {
    filteredQuestions = questions.filter(q => q.selectedOption && !q.isCorrect);
  } else if (state.currentFilter === 'unanswered') {
    filteredQuestions = questions.filter(q => !q.selectedOption);
  }

  if (filteredQuestions.length === 0) {
    elements.analysisContainer.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <strong>No questions to display</strong>
        <span>No questions match the selected filter.</span>
      </div>
    `;
    return;
  }

  elements.analysisContainer.innerHTML = `
    <div class="analysis-section">
      <h3>📋 Question-wise Analysis</h3>
      ${filteredQuestions.map((q, index) => {
        const status = q.isCorrect ? 'correct' : (q.selectedOption ? 'wrong' : 'unanswered');
        const statusLabels = {
          correct: '✅ Correct',
          wrong: '❌ Wrong',
          unanswered: '⏭️ Unanswered'
        };
        const statusClasses = {
          correct: 'correct',
          wrong: 'wrong',
          unanswered: 'unanswered'
        };

        return `
          <div class="analysis-item">
            <div class="q-header">
              <span class="q-text">Q${index + 1}: ${escapeHTML(q.questionText || 'Question')}</span>
              <span class="q-status ${statusClasses[status]}">${statusLabels[status]}</span>
            </div>
            <div class="q-details">
              ${q.selectedOption ? `<span>Your answer: <span class="${q.isCorrect ? 'correct-answer' : 'wrong-answer'}">${escapeHTML(q.selectedOption)}</span></span>` : '<span>No answer selected</span>'}
              ${q.correctAnswer ? `<span>Correct answer: <span class="correct-answer">${escapeHTML(q.correctAnswer)}</span></span>` : ''}
              ${q.marksObtained !== undefined ? `<span>Marks: ${q.marksObtained}</span>` : ''}
              ${q.timeSpent ? `<span>⏱️ ${q.timeSpent}s</span>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function showError(title, message) {
  const container = document.querySelector('.wrap');
  container.innerHTML = `
    <div class="empty-state" style="grid-column: 1/-1; padding: 60px 20px;">
      <span class="empty-icon">⚠️</span>
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(message)}</span>
      <button class="btn btn-primary" onclick="window.location.href='dashboard.html'" style="margin-top: 16px;">
        ← Back to Dashboard
      </button>
    </div>
  `;
}

// ============================================================
// Utility Functions
// ============================================================
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(seconds) {
  if (!seconds) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

// ============================================================
// Make functions globally accessible
// ============================================================
window.showToast = function(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    const newContainer = document.createElement('div');
    newContainer.id = 'toastContainer';
    newContainer.className = 'toast-container';
    document.body.appendChild(newContainer);
  }

  const toastContainer = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-title">${title}</div>
    <div class="toast-message">${message}</div>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
};