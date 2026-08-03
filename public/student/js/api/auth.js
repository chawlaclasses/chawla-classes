// public/student/js/api/auth.js
import apiClient from './client.js';

class AuthAPI {
    async login(username, password) {
        const response = await apiClient.post('/auth/login', { username, password });
        if (response.success) {
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            return response.data;
        }
        throw new Error(response.message);
    }

    async logout() {
        try {
            await apiClient.post('/auth/logout');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }

    async refreshToken() {
        const response = await apiClient.post('/auth/refresh');
        if (response.success) {
            localStorage.setItem('token', response.data.token);
            return response.data.token;
        }
        throw new Error('Token refresh failed');
    }

    async verifyToken() {
        const response = await apiClient.get('/auth/verify');
        return response.success;
    }

    getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('user'));
        } catch {
            return null;
        }
    }

    getToken() {
        return localStorage.getItem('token');
    }

    isAuthenticated() {
        return !!this.getToken() && !!this.getCurrentUser();
    }

    async changePassword(oldPassword, newPassword) {
        const response = await apiClient.post('/auth/change-password', {
            oldPassword,
            newPassword
        });
        return response.data;
    }

    async setup2FA() {
        const response = await apiClient.post('/auth/2fa/setup');
        return response.data;
    }

    async verify2FA(code) {
        const response = await apiClient.post('/auth/2fa/verify', { code });
        return response.data;
    }

    async forgotPassword(email) {
        const response = await apiClient.post('/auth/forgot-password', { email });
        return response.data;
    }

    async resetPassword(token, password) {
        const response = await apiClient.post('/auth/reset-password', { token, password });
        return response.data;
    }
}

export const authAPI = new AuthAPI();