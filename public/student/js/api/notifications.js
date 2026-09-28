// public/student/js/api/notifications.js
import apiClient from './client.js';

class NotificationsAPI {
    async getNotifications(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/notifications?${query}`);
        return response.data;
    }

    async getUnreadCount() {
        const response = await apiClient.get('/notifications/unread-count');
        return response.data;
    }

    async markRead(notificationId) {
        const response = await apiClient.post(`/notifications/${notificationId}/read`);
        return response.data;
    }

    async markAllRead() {
        const response = await apiClient.post('/notifications/mark-all-read');
        return response.data;
    }

    async deleteNotification(notificationId) {
        const response = await apiClient.delete(`/notifications/${notificationId}`);
        return response.data;
    }

    async getStats() {
        const response = await apiClient.get('/notifications/stats');
        return response.data;
    }

    // WebSocket connection
    connectWebSocket() {
        const token = localStorage.getItem('token');
        const ws = new WebSocket(`ws://${window.location.host}/ws?token=${token}`);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            // Reconnect after 5 seconds
            setTimeout(() => this.connectWebSocket(), 5000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        return ws;
    }
}

export const notificationsAPI = new NotificationsAPI();