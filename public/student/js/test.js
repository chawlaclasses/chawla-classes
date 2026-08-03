// Test Taking JavaScript
// API Base
const API_BASE = '/api/student';

// State
const state = {
  attemptId: null,
  testId: null,
  questions: [],
  currentIndex: 0,
  answers: {},
  markedForReview: new Set(),
  timerInterval: null,
  timeLeft: 0,
  totalDuration: 0,
  isSubmitted: false,
  isLoading: false
};

// ============================================================
// DOM Elements
// ============================================================
const elements = {
  testTitle: document.getElementById('testTitle'),
  testDescription: document.getElementById('testDescription'),
  totalMarksDisplay: document.getElementById('totalMarksDisplay'),
  totalQuestionsDisplay: document.getElementById('totalQuestionsDisplay'),
  timer: document.getElementById('timer'),
  progressBar: document.getElementById('progressBar'),
  questionCounter: document.getElementById('questionCounter'),
  questionNav: document.getElementById('questionNav'),
  quiz: document.getElementById('quiz'),
  submitBtn: document.getElementById('submitBtn'),
  submitModal: document.getElementById('submitModal'),
  modalTotal: document.getElementById('modalTotal'),
  modalAnswered: document.getElementById('modalAnswered'),
  modalUnanswered: document.getElementById('modalUnanswered'),
  modalReview: document.getElementById('modalReview')
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const testId = urlParams.get('id');
  const attemptId = urlParams.get('attempt');

  if (testId) {
    state.testId = testId;
    startNewTest(testId);
  } else if (attemptId) {
    state.attemptId = attemptId;
    resumeTest(attemptId);
  } else {
    showError('No test specified', 'Please select a test from the dashboard.');
  }
});

// ============================================================
// API Calls
// ============================================================
async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem('studentToken');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  const defaultOptions = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...defaultOptions,
      ...options
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
// Test Functions
// ============================================================
async function startNewTest(testId) {
  if (state.isLoading) return;
  state.isLoading = true;
  showLoading();

  try {
    const response = await apiCall('/tests/start', {
      method: 'POST',
      body: JSON.stringify({ testId })
    });

    const { data } = response;
    state.attemptId = data.attempt._id;
    state.questions = data.questions;
    state.timeLeft = data.duration * 60;
    state.totalDuration = data.duration * 60;

    // Update UI
    elements.testTitle.textContent = 'Online Test';
    elements.totalMarksDisplay.textContent = data.totalMarks;
    elements.totalQuestionsDisplay.textContent = data.totalQuestions;

    renderTest();
    startTimer();

    // Auto-save answers periodically
    setInterval(autoSaveAnswers, 30000);

    // Save to session for recovery
    sessionStorage.setItem('currentAttempt', JSON.stringify({
      attemptId: state.attemptId,
      testId: state.testId,
      startTime: Date.now()
    }));

  } catch (error) {
    console.error('Error starting test:', error);
    showError('Error loading test', error.message);
  } finally {
    state.isLoading = false;
  }
}

async function resumeTest(attemptId) {
  if (state.isLoading) return;
  state.isLoading = true;
  showLoading();

  try {
    const response = await apiCall(`/attempts/${attemptId}/questions`);
    const { data } = response;

    state.attemptId = attemptId;
    state.questions = data.questions;
    state.timeLeft = data.remainingTime || 0;

    // Reconstruct answers from attempt
    data.questions.forEach(q => {
      if (q.selectedOption) {
        state.answers[q._id] = q.selectedOption;
      }
    });

    renderTest();
    startTimer();

  } catch (error) {
    console.error('Error resuming test:', error);
    showError('Error loading test', error.message);
  } finally {
    state.isLoading = false;
  }
}

// ============================================================
// Render Functions
// ============================================================
function renderTest() {
  renderQuestionNav();
  renderCurrentQuestion();
  updateProgress();
}

function renderQuestionNav() {
  const nav = elements.questionNav;
  nav.innerHTML = state.questions.map((q, index) => {
    let classes = 'question-dot';
    if (index === state.currentIndex) classes += ' active';
    if (state.answers[q._id]) classes += ' answered';
    if (state.markedForReview.has(q._id)) classes += ' review';

    return `<button class="${classes}" onclick="goToQuestion(${index})">${index + 1}</button>`;
  }).join('');
}

function renderCurrentQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) return;

  const total = state.questions.length;
  const current = state.currentIndex + 1;
  elements.questionCounter.textContent = `${current} / ${total}`;

  const optionsHtml = q.options.map(option => {
    const isChecked = state.answers[q._id] === option.text;
    return `
      <label class="option-label">
        <input type="radio" 
               name="q${q._id}" 
               value="${escapeHTML(option.text)}"
               ${isChecked ? 'checked' : ''}
               onchange="selectOption('${q._id}', '${escapeHTML(option.text)}')">
        <span class="option-text">${escapeHTML(option.text)}</span>
      </label>
    `;
  }).join('');

  const reviewBadge = state.markedForReview.has(q._id) ?
    '<div class="review-badge">🔖 Marked for Review</div>' :
    '';

  elements.quiz.innerHTML = `
    <div class="question-block mcq">
      <span class="question-type mcq-type">📝 MCQ</span>
      <span class="question-number">Question ${current} of ${total}</span>
      <div class="question-text">${escapeHTML(q.questionText)}</div>
      <div class="options">
        ${optionsHtml}
      </div>
      ${reviewBadge}
    </div>
  `;
}

function updateProgress() {
  const answered = Object.keys(state.answers).length;
  const total = state.questions.length;
  const progress = total > 0 ? (answered / total) * 100 : 0;
  elements.progressBar.style.width = `${progress}%`;
}

function showLoading() {
  elements.quiz.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading test questions...</p>
    </div>
  `;
}

function showError(title, message) {
  elements.quiz.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">⚠️</span>
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(message)}</span>
      <button class="btn btn-primary" onclick="window.location.href='dashboard.html'" style="margin-top:16px;">
        ← Back to Dashboard
      </button>
    </div>
  `;
}

// ============================================================
// Navigation Functions
// ============================================================
function goToQuestion(index) {
  if (index >= 0 && index < state.questions.length) {
    state.currentIndex = index;
    renderTest();
  }
}

function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex++;
    renderTest();
  }
}

function previousQuestion() {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    renderTest();
  }
}

// ============================================================
// Answer Functions
// ============================================================
function selectOption(questionId, optionText) {
  state.answers[questionId] = optionText;
  renderQuestionNav();
  updateProgress();
  autoSaveAnswers(); // Save immediately on selection
}

function toggleReview() {
  const q = state.questions[state.currentIndex];
  if (!q) return;

  if (state.markedForReview.has(q._id)) {
    state.markedForReview.delete(q._id);
  } else {
    state.markedForReview.add(q._id);
  }
  renderTest();
}

// ============================================================
// Timer Functions
// ============================================================
function startTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }

  state.timerInterval = setInterval(() => {
    state.timeLeft--;

    const minutes = Math.floor(state.timeLeft / 60);
    const seconds = state.timeLeft % 60;

    elements.timer.textContent =
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0');

    elements.timer.classList.remove('timer-warning', 'timer-danger');
    if (state.timeLeft < 60) {
      elements.timer.classList.add('timer-danger');
    } else if (state.timeLeft < 300) {
      elements.timer.classList.add('timer-warning');
    }

    if (state.timeLeft <= 0) {
      clearInterval(state.timerInterval);
      elements.timer.textContent = '00:00';
      showToast('⏰ Time Up!', 'Test will be auto-submitted.', 'warning');
      submitTest();
    }
  }, 1000);
}

// ============================================================
// Auto-Save Answers
// ============================================================
async function autoSaveAnswers() {
  if (state.isSubmitted || !state.attemptId || Object.keys(state.answers).length === 0) return;

  try {
    // Save all answered questions
    for (const [questionId, selectedOption] of Object.entries(state.answers)) {
      await apiCall('/tests/save-answer', {
        method: 'POST',
        body: JSON.stringify({
          attemptId: state.attemptId,
          questionId: questionId,
          selectedOption: selectedOption || '',
          timeSpent: 0
        })
      });
    }
  } catch (error) {
    console.error('Auto-save error:', error);
  }
}

// ============================================================
// Submit Functions
// ============================================================
function showSubmitModal() {
  const total = state.questions.length;
  const answered = Object.keys(state.answers).length;
  const unanswered = total - answered;
  const reviewCount = state.markedForReview.size;

  elements.modalTotal.textContent = total;
  elements.modalAnswered.textContent = answered;
  elements.modalUnanswered.textContent = unanswered;
  elements.modalReview.textContent = reviewCount;

  elements.submitModal.classList.add('active');
}

function closeModal() {
  elements.submitModal.classList.remove('active');
}

async function submitTest() {
  if (state.isSubmitted) return;

  closeModal();

  const submitBtn = elements.submitBtn;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Submitting...';

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }

  try {
    const response = await apiCall('/tests/submit', {
      method: 'POST',
      body: JSON.stringify({
        attemptId: state.attemptId
      })
    });

    state.isSubmitted = true;
    const { data } = response;

    showToast('✅ Test Submitted!', `Score: ${data.marksObtained}/${data.totalMarks}`, 'success');

    submitBtn.textContent = '✅ Submitted';
    submitBtn.disabled = true;

    // Redirect to results after 2 seconds
    setTimeout(() => {
      window.location.href = `/student/results.html?result=${data.resultId}`;
    }, 2000);

  } catch (error) {
    console.error('Submit error:', error);
    showToast('❌ Error', error.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = '📤 Submit Test';
    if (!state.isSubmitted) {
      startTimer();
    }
  }
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

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) {
    // Create toast container if it doesn't exist
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
}

// ============================================================
// Keyboard Shortcuts
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    showSubmitModal();
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    previousQuestion();
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    nextQuestion();
  }
});

// ============================================================
// Before Unload Handler
// ============================================================
window.addEventListener('beforeunload', (e) => {
  if (!state.isSubmitted && Object.keys(state.answers).length > 0) {
    e.preventDefault();
    e.returnValue = 'You have unsaved answers. Are you sure you want to leave?';
  }
});

// ============================================================
// Make functions globally accessible
// ============================================================
window.goToQuestion = goToQuestion;
window.nextQuestion = nextQuestion;
window.previousQuestion = previousQuestion;
window.selectOption = selectOption;
window.toggleReview = toggleReview;
window.showSubmitModal = showSubmitModal;
window.closeModal = closeModal;
window.submitTest = submitTest;