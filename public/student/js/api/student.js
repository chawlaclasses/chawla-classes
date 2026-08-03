// public/student/js/api/student.js
import apiClient from './client.js';

class StudentAPI {
    async getProfile() {
        const response = await apiClient.get('/student/profile');
        return response.data;
    }

    async updateProfile(data) {
        const response = await apiClient.put('/student/profile', data);
        if (response.success) {
            localStorage.setItem('user', JSON.stringify(response.data));
            return response.data;
        }
        throw new Error(response.message);
    }

    async uploadPhoto(file, onProgress) {
        const response = await apiClient.upload('/student/photo', file, onProgress);
        if (response.success) {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            user.photo = response.data.photoUrl;
            localStorage.setItem('user', JSON.stringify(user));
            return response.data;
        }
        throw new Error(response.message);
    }

    async getDashboard() {
        const response = await apiClient.get('/student/dashboard');
        return response.data;
    }

    async getStats() {
        const response = await apiClient.get('/student/stats');
        return response.data;
    }

    async getProfileCompletion() {
        const response = await apiClient.get('/student/profile-completion');
        return response.data;
    }

    async getAchievements() {
        const response = await apiClient.get('/student/achievements');
        return response.data;
    }

    async getGamification() {
        const response = await apiClient.get('/student/gamification');
        return response.data;
    }

    async getWeakChapters() {
        const response = await apiClient.get('/student/weak-chapters');
        return response.data;
    }

    async getStrongChapters() {
        const response = await apiClient.get('/student/strong-chapters');
        return response.data;
    }

    async getRecentActivity() {
        const response = await apiClient.get('/student/recent-activity');
        return response.data;
    }

    async getAttendance() {
        const response = await apiClient.get('/student/attendance');
        return response.data;
    }

    async getDownloads() {
        const response = await apiClient.get('/student/downloads');
        return response.data;
    }
}

export const studentAPI = new StudentAPI();