// public/student/js/api/practice.js
import apiClient from './client.js';

class PracticeAPI {
    async startPractice(params) {
        const response = await apiClient.post('/practice/start', params);
        return response.data;
    }

    async getQuestion(sessionId) {
        const response = await apiClient.get(`/practice/question/${sessionId}`);
        return response.data;
    }

    async submitAnswer(sessionId, questionId, answer, timeTaken) {
        const response = await apiClient.post(`/practice/answer/${sessionId}`, {
            questionId,
            answer,
            timeTaken
        });
        return response.data;
    }

    async completeSession(sessionId) {
        const response = await apiClient.post(`/practice/complete/${sessionId}`);
        return response.data;
    }

    async getSessionStats(sessionId) {
        const response = await apiClient.get(`/practice/stats/${sessionId}`);
        return response.data;
    }

    async getHistory(limit = 10) {
        const response = await apiClient.get(`/practice/history?limit=${limit}`);
        return response.data;
    }

    async getWrongQuestions(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/practice/wrong-questions?${query}`);
        return response.data;
    }

    async markImproved(questionId) {
        const response = await apiClient.put(`/practice/wrong-questions/${questionId}/improved`);
        return response.data;
    }

    async getRecommendations() {
        const response = await apiClient.get('/practice/recommendations');
        return response.data;
    }

    async getBookmarkedQuestions() {
        const response = await apiClient.get('/practice/bookmarked');
        return response.data;
    }
}

export const practiceAPI = new PracticeAPI();