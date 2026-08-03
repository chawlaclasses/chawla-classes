// public/student/js/services/offline.js
import { StorageService } from './storage.js';

class OfflineService {
    constructor() {
        this.isOffline = !navigator.onLine;
        this.pendingActions = [];
        this.syncInProgress = false;
        this.setupListeners();
        this.loadPendingActions();
    }

    setupListeners() {
        window.addEventListener('online', () => {
            this.isOffline = false;
            this.showToast('Back Online', 'Connection restored!', 'success');
            this.syncPendingActions();
        });

        window.addEventListener('offline', () => {
            this.isOffline = true;
            this.showToast('Offline', 'You are offline. Changes will be synced when online.', 'error');
            document.getElementById('offlineBanner')?.classList.add('active');
        });

        // Initial check
        if (this.isOffline) {
            document.getElementById('offlineBanner')?.classList.add('active');
        }
    }

    isOfflineMode() {
        return this.isOffline;
    }

    async queueAction(action) {
        const queuedAction = {
            id: Date.now().toString(),
            ...action,
            timestamp: Date.now()
        };

        this.pendingActions.push(queuedAction);
        await this.savePendingActions();
        return queuedAction;
    }

    async savePendingActions() {
        StorageService.set('pending_actions', this.pendingActions);
    }

    loadPendingActions() {
        this.pendingActions = StorageService.get('pending_actions') || [];
    }

    async syncPendingActions() {
        if (this.syncInProgress || this.pendingActions.length === 0) return;
        
        this.syncInProgress = true;
        const actions = [...this.pendingActions];
        const failedActions = [];

        try {
            for (const action of actions) {
                try {
                    await this.executeAction(action);
                } catch (error) {
                    console.error('Action sync failed:', action, error);
                    failedActions.push(action);
                }
            }

            // Update pending actions
            this.pendingActions = failedActions;
            await this.savePendingActions();

            if (this.pendingActions.length === 0) {
                this.showToast('Sync Complete', 'All offline actions synced successfully!', 'success');
            } else {
                this.showToast('Sync Partial', `${this.pendingActions.length} actions failed to sync`, 'warning');
            }
        } catch (error) {
            console.error('Sync error:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    async executeAction(action) {
        const { type, endpoint, data, method = 'POST' } = action;

        // Map action types to API calls
        switch (type) {
            case 'submit_test':
                // Submit test
                break;
            case 'submit_homework':
                // Submit homework
                break;
            case 'bookmark':
                // Add bookmark
                break;
            case 'practice_answer':
                // Submit practice answer
                break;
            default:
                console.warn('Unknown action type:', type);
        }
    }

    // Register service worker for background sync
    async registerSync() {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            try {
                const registration = await navigator.serviceWorker.ready;
                await registration.sync.register('sync-data');
                console.log('Background sync registered');
            } catch (error) {
                console.error('Sync registration failed:', error);
            }
        }
    }

    // Cache management
    async cacheData(url, data) {
        if ('caches' in window) {
            try {
                const cache = await caches.open('chawla-cache-v1');
                const response = new Response(JSON.stringify(data), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'max-age=3600'
                    }
                });
                await cache.put(url, response);
            } catch (error) {
                console.error('Cache error:', error);
            }
        }
    }

    async getCachedData(url) {
        if ('caches' in window) {
            try {
                const cache = await caches.open('chawla-cache-v1');
                const response = await cache.match(url);
                if (response) {
                    return await response.json();
                }
            } catch (error) {
                console.error('Cache get error:', error);
            }
        }
        return null;
    }

    showToast(title, message, type) {
        // Use global toast function
        if (window.showToast) {
            window.showToast(title, message, type);
        }
    }
}

export const offlineService = new OfflineService();