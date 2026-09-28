// public/student/js/api/bookmarks.js
import apiClient from './client.js';

class BookmarksAPI {
    async toggleBookmark(questionId, category = 'default') {
        const response = await apiClient.post(`/bookmarks/toggle/${questionId}`, { category });
        return response.data;
    }

    async getBookmarks(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/bookmarks?${query}`);
        return response.data;
    }

    async getBookmarkedQuestions(filters = {}) {
        const query = new URLSearchParams(filters).toString();
        const response = await apiClient.get(`/bookmarks/questions?${query}`);
        return response.data;
    }

    async updateCategory(questionId, category) {
        const response = await apiClient.put(`/bookmarks/${questionId}/category`, { category });
        return response.data;
    }

    async addNote(questionId, note) {
        const response = await apiClient.put(`/bookmarks/${questionId}/note`, { note });
        return response.data;
    }

    async reviewBookmark(questionId) {
        const response = await apiClient.post(`/bookmarks/${questionId}/review`);
        return response.data;
    }

    async getCategories() {
        const response = await apiClient.get('/bookmarks/categories');
        return response.data;
    }

    async exportBookmarks(format = 'json') {
        const response = await apiClient.get(`/bookmarks/export?format=${format}`);
        return response.data;
    }
}

export const bookmarksAPI = new BookmarksAPI();