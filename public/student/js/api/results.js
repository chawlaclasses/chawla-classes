// public/student/js/api/results.js
//
// NOT CURRENTLY IMPORTED ANYWHERE (public/student/results.html has its own
// inline fetch logic instead -- this module is unused dead code as of this
// audit). Fixed the endpoint paths that DO have a real backend
// implementation, and flagged the ones that don't, so if this file is
// wired up later it fails loudly/obviously instead of silently 404ing.
import apiClient from './client.js';

class ResultsAPI {
    // These 3 exist in routes/studentRoutes.js, mounted at /api/student.
    async getResults(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/student/results?${query}`);
        return response.data;
    }

    async getResultDetail(resultId) {
        const response = await apiClient.get(`/student/results/${resultId}`);
        return response.data;
    }

    async getResultAnalysis(resultId) {
        const response = await apiClient.get(`/student/results/${resultId}/analysis`);
        return response.data;
    }

    // NO BACKEND ROUTE EXISTS for any of the methods below (checked
    // routes/studentRoutes.js -- only /results, /results/:id, and
    // /results/:id/analysis are implemented). Calling these will 404 until
    // a matching backend endpoint is built.
    async downloadResult(resultId, format = 'pdf') {
        await apiClient.download(`/student/results/${resultId}/download?format=${format}`, `result-${resultId}.${format}`);
    }

    async shareResult(resultId) {
        const response = await apiClient.post(`/student/results/${resultId}/share`);
        return response.data;
    }

    async getPerformanceTrends(period = 'month') {
        const response = await apiClient.get(`/student/results/trends?period=${period}`);
        return response.data;
    }

    async getSubjectAnalysis() {
        const response = await apiClient.get('/student/results/subject-analysis');
        return response.data;
    }

    async getChapterAnalysis(subject) {
        const response = await apiClient.get(`/student/results/chapter-analysis?subject=${subject}`);
        return response.data;
    }

    async getDifficultyAnalysis() {
        const response = await apiClient.get('/student/results/difficulty-analysis');
        return response.data;
    }

    async getComparison(resultId) {
        const response = await apiClient.get(`/student/results/${resultId}/comparison`);
        return response.data;
    }
}

export const resultsAPI = new ResultsAPI();