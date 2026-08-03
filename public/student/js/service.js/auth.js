// public/student/js/services/auth.js
import { authAPI } from '../api/auth.js';
import { StorageService } from './storage.js';

class AuthService {
    constructor() {
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
        this.sessionTimer = null;
        this.lastActivity = Date.now();
        this.setupActivityListeners();
    }

    async login(username, password) {
        try {
            const user = await authAPI.login(username, password);
            this.startSessionMonitor();
            return { success: true, user };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async logout() {
        this.stopSessionMonitor();
        await authAPI.logout();
    }

    async refreshToken() {
        try {
            const token = await authAPI.refreshToken();
            return { success: true, token };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    isAuthenticated() {
        return authAPI.isAuthenticated();
    }

    getCurrentUser() {
        return authAPI.getCurrentUser();
    }

    getToken() {
        return authAPI.getToken();
    }

    setupActivityListeners() {
        const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
        events.forEach(event => {
            document.addEventListener(event, () => {
                this.lastActivity = Date.now();
                StorageService.set('last_activity', this.lastActivity);
            });
        });
    }

    startSessionMonitor() {
        this.stopSessionMonitor();
        this.sessionTimer = setInterval(() => {
            const inactiveTime = Date.now() - this.lastActivity;
            if (inactiveTime >= this.sessionTimeout) {
                this.handleSessionTimeout();
            }
            // Show warning at 2 minutes before timeout
            if (inactiveTime >= this.sessionTimeout - 120000) {
                this.showSessionWarning();
            }
        }, 10000);
    }

    stopSessionMonitor() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    handleSessionTimeout() {
        this.stopSessionMonitor();
        this.logout();
        window.dispatchEvent(new CustomEvent('session-expired'));
    }

    showSessionWarning() {
        const timeLeft = Math.ceil((this.sessionTimeout - (Date.now() - this.lastActivity)) / 1000);
        window.dispatchEvent(new CustomEvent('session-warning', {
            detail: { timeLeft }
        }));
    }

    async changePassword(oldPassword, newPassword) {
        try {
            await authAPI.changePassword(oldPassword, newPassword);
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

export const authService = new AuthService();