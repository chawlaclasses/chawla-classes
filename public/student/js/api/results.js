// public/student/js/api/results.js
import apiClient from './client.js';

class ResultsAPI {
    async getResults(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/results?${query}`);
        return response.data;
    }

    async getResultDetail(resultId) {
        const response = await apiClient.get(`/results/${resultId}`);
        return response.data;
    }

    async getResultAnalysis(resultId) {
        const response = await apiClient.get(`/results/${resultId}/analysis`);
        return response.data;
    }

    async downloadResult(resultId, format = 'pdf') {
        await apiClient.download(`/results/${resultId}/download?format=${format}`, `result-${resultId}.${format}`);
    }

    async shareResult(resultId) {
        const response = await apiClient.post(`/results/${resultId}/share`);
        return response.data;
    }

    async getPerformanceTrends(period = 'month') {
        const response = await apiClient.get(`/results/trends?period=${period}`);
        return response.data;
    }

    async getSubjectAnalysis() {
        const response = await apiClient.get('/results/subject-analysis');
        return response.data;
    }

    async getChapterAnalysis(subject) {
        const response = await apiClient.get(`/results/chapter-analysis?subject=${subject}`);
        return response.data;
    }

    async getDifficultyAnalysis() {
        const response = await apiClient.get('/results/difficulty-analysis');
        return response.data;
    }

    async getComparison(resultId) {
        const response = await apiClient.get(`/results/${resultId}/comparison`);
        return response.data;
    }
}

export const resultsAPI = new ResultsAPI();