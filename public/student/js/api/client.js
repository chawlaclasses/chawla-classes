// public/student/js/api/client.js
"use strict";

class APIClient {
    constructor() {
        this.baseURL = '/api';
        this.timeout = 30000;
        this.retryAttempts = 3;
        this.retryDelay = 1000;
        this.pendingRequests = new Map();
        this.interceptors = {
            request: [],
            response: [],
            error: []
        };
    }

    // ─── Request Interceptor ──────────────────────────────────────────────
    addRequestInterceptor(callback) {
        this.interceptors.request.push(callback);
    }

    addResponseInterceptor(callback) {
        this.interceptors.response.push(callback);
    }

    addErrorInterceptor(callback) {
        this.interceptors.error.push(callback);
    }

    // ─── Main Request Method ──────────────────────────────────────────────
    async request(endpoint, options = {}) {
        const url = this.buildURL(endpoint);
        const config = this.buildConfig(options);
        
        // Apply request interceptors
        let processedConfig = config;
        for (const interceptor of this.interceptors.request) {
            processedConfig = interceptor(processedConfig) || processedConfig;
        }

        // Deduplicate requests
        const requestKey = this.getRequestKey(url, processedConfig);
        if (this.pendingRequests.has(requestKey)) {
            return this.pendingRequests.get(requestKey);
        }

        const promise = this.executeWithRetry(url, processedConfig);
        this.pendingRequests.set(requestKey, promise);

        try {
            const response = await promise;
            this.pendingRequests.delete(requestKey);
            
            // Apply response interceptors
            let processedResponse = response;
            for (const interceptor of this.interceptors.response) {
                processedResponse = interceptor(processedResponse) || processedResponse;
            }
            
            return this.processResponse(processedResponse);
        } catch (error) {
            this.pendingRequests.delete(requestKey);
            
            // Apply error interceptors
            let processedError = error;
            for (const interceptor of this.interceptors.error) {
                processedError = interceptor(processedError) || processedError;
            }
            
            throw this.handleError(processedError);
        }
    }

    // ─── Build URL ─────────────────────────────────────────────────────────
    buildURL(endpoint) {
        if (endpoint.startsWith('http')) return endpoint;
        return `${this.baseURL}${endpoint}`;
    }

    // ─── Build Config ──────────────────────────────────────────────────────
    buildConfig(options) {
        // FIX: student login (public/student/login.html) stores the JWT
        // under 'studentToken', not 'token' — this was reading a key that's
        // never set, so every request sent "Authorization: Bearer null".
        const token = localStorage.getItem('studentToken');
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Add cache control for GET requests
        if (!options.method || options.method === 'GET') {
            headers['Cache-Control'] = 'max-age=300';
        }

        return {
            ...options,
            headers,
            timeout: this.timeout
        };
    }

    // ─── Get Request Key ──────────────────────────────────────────────────
    getRequestKey(url, config) {
        const method = config.method || 'GET';
        const body = config.body ? JSON.stringify(config.body) : '';
        return `${method}:${url}:${body}`;
    }

    // ─── Execute with Retry ──────────────────────────────────────────────
    async executeWithRetry(url, config, attempt = 1) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            
            const response = await fetch(url, {
                ...config,
                signal: controller.signal,
                body: config.body ? JSON.stringify(config.body) : undefined
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new APIError(response.status, errorData.message || response.statusText, errorData);
            }
            
            return response;
        } catch (error) {
            if (attempt < this.retryAttempts && this.shouldRetry(error)) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                return this.executeWithRetry(url, config, attempt + 1);
            }
            throw error;
        }
    }

    // ─── Should Retry ─────────────────────────────────────────────────────
    shouldRetry(error) {
        return error.name === 'TypeError' || 
               error.name === 'AbortError' ||
               (error.status >= 500 && error.status < 600);
    }

    // ─── Process Response ─────────────────────────────────────────────────
    processResponse(response) {
        return response.json();
    }

    // ─── Handle Error ─────────────────────────────────────────────────────
    handleError(error) {
        if (error.status === 401) {
            // Token expired - handle refresh
            this.handleUnauthorized();
        }
        
        return {
            success: false,
            message: error.message || 'An error occurred',
            status: error.status,
            data: error.data
        };
    }

    // ─── Handle Unauthorized ─────────────────────────────────────────────
    handleUnauthorized() {
        // Clear session and redirect to login
        localStorage.removeItem('studentToken');
        localStorage.removeItem('studentName');
        localStorage.removeItem('userClass');
        window.location.href = '/student/login.html';
    }

    // ─── HTTP Methods ─────────────────────────────────────────────────────
    async get(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'GET' });
    }

    async post(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'POST',
            body: data
        });
    }

    async put(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PUT',
            body: data
        });
    }

    async patch(endpoint, data, options = {}) {
        return this.request(endpoint, {
            ...options,
            method: 'PATCH',
            body: data
        });
    }

    async delete(endpoint, options = {}) {
        return this.request(endpoint, { ...options, method: 'DELETE' });
    }

    // ─── File Upload ──────────────────────────────────────────────────────
    async upload(endpoint, file, onProgress) {
        const formData = new FormData();
        formData.append('file', file);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (e) => {
                if (onProgress && e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    reject(new APIError(xhr.status, 'Upload failed'));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Upload failed'));
            });
            
            const token = localStorage.getItem('studentToken');
            xhr.open('POST', this.buildURL(endpoint));
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            xhr.send(formData);
        });
    }

    // ─── Download File ────────────────────────────────────────────────────
    async download(endpoint, filename) {
        const response = await fetch(this.buildURL(endpoint), {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('studentToken')}`
            }
        });

        if (!response.ok) {
            throw new Error('Download failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }
}

class APIError extends Error {
    constructor(status, message, data = null) {
        super(message);
        this.status = status;
        this.data = data;
        this.name = 'APIError';
    }
}

// Create singleton instance
const apiClient = new APIClient();

export default apiClient;