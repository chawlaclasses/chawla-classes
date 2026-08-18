// public/student/js/api/tests.js
//
// FIX (2026-07): this whole file used to call endpoints that don't exist on
// the backend (/tests?filters, /tests/upcoming, /tests/:id, /tests/:id/start,
// /tests/:id/submit, /tests/resume, /tests/:id/progress, /tests/:id/autosave,
// /tests/history, /tests/:id/analysis) — none of these match anything in
// routes/studentRoutes.js, and every call was missing the required
// '/student' prefix apiClient needs (baseURL is '/api', routes are mounted
// at '/api/student'). Rewritten to call the routes that actually exist.
import apiClient from './client.js';

class TestsAPI {
    // List tests within a series (with per-student attempt status —
    // attemptsMade, canAttempt, hasActiveAttempt, activeAttemptId, etc.)
    async getSeriesTests(seriesId) {
        const response = await apiClient.get(`/student/series/${seriesId}/tests`);
        return response.data;
    }

    // Subjects for the student's class, and series within a subject —
    // needed to get to getSeriesTests() above.
    async getSubjects() {
        const response = await apiClient.get('/student/subjects');
        return response.data;
    }

    async getSubjectSeries(subjectId) {
        const response = await apiClient.get(`/student/subjects/${subjectId}/series`);
        return response.data;
    }

    // Tests coming up for the student's class, straight from the dashboard
    // payload (there's no separate /tests/upcoming endpoint).
    async getUpcomingTests() {
        const response = await apiClient.get('/student/dashboard');
        return response.data?.upcomingTests || [];
    }

    // "Resume where you left off" -- there's no backend endpoint that
    // proactively reports an in-progress attempt (resume logic only
    // exists INSIDE POST /student/tests/start, triggered when a student
    // clicks to start/continue a specific test they already picked --
    // see routes/studentRoutes.js's `isResumed` flag). Returns null
    // (never throws) until a real "do I have an attempt in progress"
    // endpoint exists, so Dashboard/index.js's QuickActions widget just
    // shows no resume card instead of crashing the whole dashboard load.
    async resumeTest() {
        return null;
    }

    async getTestDetail(testId) {
        const response = await apiClient.get(`/student/tests/${testId}/details`);
        return response.data;
    }

    // Starts a fresh attempt, or resumes one already in progress for this
    // test (the backend itself detects and returns the existing attempt).
    async startTest(testId) {
        const response = await apiClient.post('/student/tests/start', { testId });
        return response.data;
    }

    // Save/update a single answer — called after each option selection and
    // on the periodic autosave timer in test.html.
    async saveAnswer(attemptId, questionId, selectedOption, timeSpent) {
        const response = await apiClient.post('/student/tests/save-answer', {
            attemptId,
            questionId,
            selectedOption,
            timeSpent
        });
        return response.data;
    }

    // Submits the attempt (answers must already be saved via saveAnswer —
    // this endpoint takes attemptId only, not the answers themselves).
    async submitTest(attemptId) {
        const response = await apiClient.post('/student/tests/submit', { attemptId });
        return response.data;
    }

    // Resume an in-progress attempt: fetch its questions + remaining time.
    async getAttemptQuestions(attemptId) {
        const response = await apiClient.get(`/student/attempts/${attemptId}/questions`);
        return response.data;
    }

    async getTestRank(testId) {
        const response = await apiClient.get(`/student/tests/${testId}/rank`);
        return response.data;
    }

    async getTestLeaderboard(testId) {
        const response = await apiClient.get(`/student/tests/${testId}/leaderboard`);
        return response.data;
    }

    // Past attempts / results — there's no /tests/history route, results
    // (with each test's outcome) live under /student/results.
    async getTestHistory() {
        const response = await apiClient.get('/student/results');
        return response.data;
    }

    // Per-attempt analysis is keyed by resultId, not testId.
    async getTestAnalysis(resultId) {
        const response = await apiClient.get(`/student/results/${resultId}/analysis`);
        return response.data;
    }
}

export const testsAPI = new TestsAPI();