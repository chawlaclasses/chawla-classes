// public/student/js/api/ai.js
import apiClient from './client.js';

class AIAPI {
    async getSuggestions() {
        const response = await apiClient.get('/student/ai/suggestions');
        return response.data;
    }

    async getStudyPlanner(days = 7) {
        const response = await apiClient.get(`/student/ai/planner?days=${days}`);
        return response.data;
    }

    async getRevisionPlan() {
        const response = await apiClient.get('/student/ai/revision');
        return response.data;
    }

    async getWeakAreas() {
        const response = await apiClient.get('/student/ai/weak-areas');
        return response.data;
    }

    async getStrongAreas() {
        const response = await apiClient.get('/student/ai/strong-areas');
        return response.data;
    }

    async getPracticeRecommendations() {
        const response = await apiClient.get('/student/ai/practice-recommendations');
        return response.data;
    }

    async getDailyGoal() {
        const response = await apiClient.get('/student/ai/daily-goal');
        return response.data;
    }

    async getLearningPath() {
        const response = await apiClient.get('/student/ai/learning-path');
        return response.data;
    }

    async getChapterAnalysis(subject) {
        const response = await apiClient.get(`/student/ai/chapter-analysis/${subject}`);
        return response.data;
    }
}

export const aiAPI = new AIAPI();