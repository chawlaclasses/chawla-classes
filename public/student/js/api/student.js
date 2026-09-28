// public/student/js/api/student.js
//
// Of everything in this file, only getDashboard() below has a real
// backend route (routes/studentRoutes.js's GET /student/dashboard) --
// checked and confirmed no /student/profile, /photo, /stats,
// /profile-completion, /achievements, /gamification, /weak-chapters,
// /strong-chapters, /recent-activity, /attendance, or /downloads route
// exists anywhere. getDashboard() already returns student info, stats,
// and recentActivity in one payload, which is what
// Dashboard/index.js's loadDashboard() now actually uses (see the fix
// note there) instead of the broken getProfile()/getStats()/
// getRecentActivity() calls it used to make. Every other method below
// will 404 until a matching backend endpoint is built.
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

    // NO BACKEND ROUTE EXISTS below this point -- see the file-header
    // comment for the full list checked. Dashboard/index.js used to call
    // getStats() and getRecentActivity() directly and broke the whole
    // dashboard on every load as a result (Promise.all rejects on any
    // one failure); it now gets that same data from getDashboard()
    // above instead, which already includes both.
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