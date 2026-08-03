// public/student/js/services/storage.js
export class StorageService {
    static set(key, value) {
        try {
            const serialized = JSON.stringify(value);
            localStorage.setItem(key, serialized);
        } catch (error) {
            console.error('Storage set error:', error);
        }
    }

    static get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            if (item) {
                return JSON.parse(item);
            }
            return defaultValue;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    }

    static remove(key) {
        localStorage.removeItem(key);
    }

    static clear() {
        localStorage.clear();
    }

    static has(key) {
        return localStorage.getItem(key) !== null;
    }

    // Session storage (cleared on tab close)
    static setSession(key, value) {
        try {
            const serialized = JSON.stringify(value);
            sessionStorage.setItem(key, serialized);
        } catch (error) {
            console.error('Session storage set error:', error);
        }
    }

    static getSession(key, defaultValue = null) {
        try {
            const item = sessionStorage.getItem(key);
            if (item) {
                return JSON.parse(item);
            }
            return defaultValue;
        } catch (error) {
            console.error('Session storage get error:', error);
            return defaultValue;
        }
    }

    // Cache management
    static setCache(key, value, ttl = 300000) {
        const cacheItem = {
            value,
            expires: Date.now() + ttl
        };
        this.set(`cache_${key}`, cacheItem);
    }

    static getCache(key) {
        const item = this.get(`cache_${key}`);
        if (item && item.expires > Date.now()) {
            return item.value;
        }
        return null;
    }

    static clearCache() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('cache_')) {
                localStorage.removeItem(key);
            }
        });
    }

    // IndexedDB for large data
    static async openDB(dbName, storeName) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' });
                }
            };
        });
    }

    static async setDB(dbName, storeName, data) {
        try {
            const db = await this.openDB(dbName, storeName);
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
        } catch (error) {
            console.error('IndexedDB set error:', error);
        }
    }

    static async getDB(dbName, storeName, id) {
        try {
            const db = await this.openDB(dbName, storeName);
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(id);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            });
        } catch (error) {
            console.error('IndexedDB get error:', error);
            return null;
        }
    }
}