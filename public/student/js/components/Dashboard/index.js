// public/student/js/components/Dashboard/index.js
import { studentAPI } from '../../api/student.js';
import { testsAPI } from '../../api/tests.js';
import { aiAPI } from '../../api/ai.js';
import { notificationsAPI } from '../../api/notifications.js';
import { authService } from '../../services/auth.js';
import { themeService } from '../../services/theme.js';
import { languageService } from '../../services/language.js';
import { wsService } from '../../services/websocket.js';
import { offlineService } from '../../services/offline.js';

import { Welcome } from './Welcome.js';
import { Stats } from './Stats.js';
import { Charts } from './Charts.js';
import { QuickActions } from './QuickActions.js';
import { UpcomingTests } from './UpcomingTests.js';
import { Leaderboard } from './Leaderboard.js';
import { Calendar } from './Calendar.js';
import { Activity } from './Activity.js';
import { DailyTarget } from './DailyTarget.js';
import { AISuggestions } from './AISuggestions.js';
import { ProfileCompletion } from './ProfileCompletion.js';

// FIX (security, audit 2026-07): escapeHTML() added for the error-state
// message, which can include text derived from a caught exception.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class Dashboard {
    constructor() {
        this.state = {
            student: null,
            stats: null,
            tests: [],
            leaderboard: [],
            notifications: [],
            aiSuggestions: [],
            dailyTarget: null,
            resumeTest: null,
            activities: [],
            loading: true,
            error: null
        };

        this.components = {};
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupWebSocket();
        await this.loadDashboard();
        this.setupAutoRefresh();
        this.render();
    }

    setupEventListeners() {
        // Theme change
        window.addEventListener('theme-changed', () => this.updateThemeUI());
        
        // Language change
        window.addEventListener('language-changed', () => this.updateLanguageUI());
        
        // New notification
        window.addEventListener('new-notification', (e) => this.handleNewNotification(e.detail));
        
        // Session expired
        window.addEventListener('session-expired', () => this.handleSessionExpired());
        
        // Unauthorized
        window.addEventListener('unauthorized', () => this.handleUnauthorized());
        
        // Search
        document.getElementById('searchInput')?.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                this.handleSearch(e.target.value);
            }
        });
    }

    setupWebSocket() {
        wsService.on('notification', (data) => {
            this.handleNewNotification(data);
        });

        wsService.on('test_update', (data) => {
            this.handleTestUpdate(data);
        });

        wsService.on('result_update', (data) => {
            this.handleResultUpdate(data);
        });
    }

    async loadDashboard() {
        try {
            this.state.loading = true;
            this.showSkeleton();

            // FIX (connectivity audit, 2026-08): this used to call
            // studentAPI.getProfile(), .getStats(), and .getRecentActivity()
            // separately -- none of which have a backend route (only
            // /student/dashboard does, and it already returns all three:
            // `student`, `stats`, and `recentActivity` in one payload — see
            // routes/studentRoutes.js). Since this whole block is a
            // Promise.all, those 3 guaranteed-404s meant EVERY dashboard
            // load rejected and fell into the catch below, showing the
            // error state instead of the real dashboard, every time, for
            // every student. Calling getDashboard() once and destructuring
            // from it fixes that at the source instead of patching the
            // symptom.
            const [dashboard, tests, leaderboard, notifications, ai, target, resume] =
                await Promise.all([
                    studentAPI.getDashboard(),
                    testsAPI.getUpcomingTests(),
                    this.getLeaderboard(),
                    notificationsAPI.getNotifications({ limit: 10 }),
                    aiAPI.getSuggestions(),
                    aiAPI.getDailyGoal(),
                    testsAPI.resumeTest()
                ]);

            this.state.student = dashboard.student;
            this.state.stats = dashboard.stats;
            this.state.activities = dashboard.recentActivity;
            this.state.tests = tests;
            this.state.leaderboard = leaderboard;
            this.state.notifications = notifications;
            this.state.aiSuggestions = ai;
            this.state.dailyTarget = target;
            this.state.resumeTest = resume;
            this.state.loading = false;

        } catch (error) {
            this.state.error = error.message;
            this.state.loading = false;
            this.showErrorState();
        }
    }

    render() {
        if (this.state.loading) {
            this.showSkeleton();
            return;
        }

        if (this.state.error) {
            this.showErrorState();
            return;
        }

        // Initialize components
        this.components = {
            welcome: new Welcome('#welcomeSection', this.state.student),
            stats: new Stats('#statsGrid', this.state.stats),
            charts: new Charts('#chartsGrid', this.state.stats),
            quickActions: new QuickActions('#quickActions', this.state.resumeTest),
            upcomingTests: new UpcomingTests('#upcomingTests', this.state.tests),
            leaderboard: new Leaderboard('#leaderboard', this.state.leaderboard),
            calendar: new Calendar('#calendarWidget'),
            activity: new Activity('#recentActivity', this.state.activities),
            dailyTarget: new DailyTarget('#dailyTarget', this.state.dailyTarget),
            aiSuggestions: new AISuggestions('#aiSuggestions', this.state.aiSuggestions),
            profileCompletion: new ProfileCompletion('#profileCompletion', this.state.student)
        };

        // Render all components
        Object.values(this.components).forEach(component => {
            if (component.render) component.render();
        });

        this.updateBadges();
        this.updateUI();
    }

    showSkeleton() {
        // Show skeleton loading state
        const container = document.getElementById('dashboard-page');
        if (!container) return;
        
        container.innerHTML = `
            <div class="skeleton-welcome" style="height:120px;border-radius:16px;margin-bottom:24px;"></div>
            <div class="skeleton-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:24px;">
                ${Array(8).fill(0).map(() => `
                    <div style="background:var(--navy);border-radius:16px;padding:20px;border:1px solid var(--glass-border);">
                        <div class="skeleton" style="width:44px;height:44px;border-radius:8px;margin-bottom:12px;"></div>
                        <div class="skeleton-text"></div>
                        <div class="skeleton-text short"></div>
                    </div>
                `).join('')}
            </div>
            <div class="skeleton-charts" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
                ${Array(4).fill(0).map(() => `
                    <div style="background:var(--navy);border-radius:16px;padding:20px;border:1px solid var(--glass-border);height:250px;">
                        <div class="skeleton" style="height:30px;width:50%;margin-bottom:12px;"></div>
                        <div class="skeleton" style="height:180px;border-radius:8px;"></div>
                    </div>
                `).join('')}
            </div>
            <div class="skeleton-widgets" style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
                ${Array(2).fill(0).map(() => `
                    <div style="background:var(--navy);border-radius:16px;padding:24px;border:1px solid var(--glass-border);">
                        <div class="skeleton" style="height:24px;width:40%;margin-bottom:16px;"></div>
                        ${Array(3).fill(0).map(() => `
                            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--glass-border);">
                                <div>
                                    <div class="skeleton-text" style="width:120px;"></div>
                                    <div class="skeleton-text short" style="width:80px;"></div>
                                </div>
                                <div class="skeleton" style="width:60px;height:24px;border-radius:20px;"></div>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    showErrorState() {
        const container = document.getElementById('dashboard-page');
        if (!container) return;
        
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center;">
                <i class="fas fa-exclamation-triangle" style="font-size:48px;color:var(--gold);margin-bottom:16px;"></i>
                <h3 style="color:var(--white);margin-bottom:8px;">Oops! Something went wrong</h3>
                <p style="color:var(--gray-400);max-width:400px;margin-bottom:24px;">${escapeHTML(this.state.error) || 'Failed to load dashboard. Please try again.'}</p>
                <button onclick="location.reload()" class="btn btn-primary">
                    <i class="fas fa-sync"></i> Retry
                </button>
            </div>
        `;
    }

    updateBadges() {
        const bookmarkBadge = document.getElementById('bookmarkBadge');
        const wrongBadge = document.getElementById('wrongBadge');
        const notificationDot = document.getElementById('notificationDot');
        
        if (bookmarkBadge) {
            bookmarkBadge.textContent = this.state.stats?.bookmarks || 0;
        }
        
        if (wrongBadge) {
            wrongBadge.textContent = this.state.stats?.wrongQuestions || 0;
        }
        
        if (notificationDot) {
            const unread = this.state.notifications?.filter(n => !n.read).length || 0;
            notificationDot.style.display = unread > 0 ? 'block' : 'none';
            notificationDot.classList.toggle('active', unread > 0);
        }
    }

    updateUI() {
        // Update theme
        const isDark = themeService.isDarkMode();
        document.body.classList.toggle('dark-theme', isDark);
        
        // Update language
        languageService.applyTranslations();
    }

    updateThemeUI() {
        this.updateUI();
    }

    updateLanguageUI() {
        this.updateUI();
        // Re-render text-based components
        if (this.components.welcome) this.components.welcome.render();
        if (this.components.stats) this.components.stats.render();
    }

    setupAutoRefresh() {
        // Refresh dashboard every 5 minutes
        setInterval(() => {
            this.loadDashboard();
        }, 300000);
    }

    handleNewNotification(notification) {
        this.state.notifications.unshift(notification);
        this.updateBadges();
        if (this.components.notifications) {
            this.components.notifications.render(this.state.notifications);
        }
        window.showToast(notification.title, notification.message, 'info');
    }

    handleTestUpdate(data) {
        // Update test status
        const testIndex = this.state.tests.findIndex(t => t.id === data.testId);
        if (testIndex !== -1) {
            this.state.tests[testIndex] = { ...this.state.tests[testIndex], ...data };
            if (this.components.upcomingTests) {
                this.components.upcomingTests.render(this.state.tests);
            }
        }
    }

    handleResultUpdate(data) {
        // Update stats
        if (this.state.stats) {
            this.state.stats.completedTests = (this.state.stats.completedTests || 0) + 1;
            if (this.components.stats) {
                this.components.stats.render(this.state.stats);
            }
        }
        window.showToast('Results Updated', `New result available for ${data.testName}`, 'success');
    }

    handleSearch(query) {
        if (!query || query.length < 2) return;
        // Navigate to search results
        window.location.href = `/student/search.html?q=${encodeURIComponent(query)}`;
    }

    handleSessionExpired() {
        window.showToast('Session Expired', 'Please login again to continue.', 'error');
        setTimeout(() => {
            window.location.href = '/student/login.html';
        }, 3000);
    }

    handleUnauthorized() {
        window.location.href = '/student/login.html';
    }

    async getLeaderboard() {
        try {
            const response = await fetch('/api/leaderboard/class');
            const data = await response.json();
            return data.data || [];
        } catch {
            return [];
        }
    }

    destroy() {
        // Cleanup
        Object.values(this.components).forEach(component => {
            if (component.destroy) component.destroy();
        });
        this.components = {};
    }
}