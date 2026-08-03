// public/student/js/services/websocket.js
class WebSocketService {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.listeners = new Map();
        this.isConnected = false;
    }

    connect() {
        const token = localStorage.getItem('token');
        if (!token) {
            console.warn('No token found, WebSocket connection aborted');
            return;
        }

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.emit('connection', { status: 'connected' });
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.emit(data.event || 'message', data.data || data);
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('WebSocket disconnected');
                this.isConnected = false;
                this.emit('disconnection', { status: 'disconnected' });
                this.handleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.emit('error', error);
            };
        } catch (error) {
            console.error('WebSocket connection error:', error);
            this.handleReconnect();
        }
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Reconnecting attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
        } else {
            console.error('Max reconnection attempts reached');
            this.emit('reconnect_failed', { 
                attempts: this.reconnectAttempts 
            });
        }
    }

    send(event, data = {}) {
        if (!this.isConnected || !this.ws) {
            console.warn('WebSocket not connected, message queued');
            // Queue message for later
            this.queueMessage(event, data);
            return;
        }

        try {
            this.ws.send(JSON.stringify({
                event,
                data,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.error('WebSocket send error:', error);
        }
    }

    queueMessage(event, data) {
        if (!this.messageQueue) {
            this.messageQueue = [];
        }
        this.messageQueue.push({ event, data, timestamp: Date.now() });
    }

    flushQueue() {
        if (!this.messageQueue || this.messageQueue.length === 0) return;
        
        const messages = [...this.messageQueue];
        this.messageQueue = [];
        
        messages.forEach(msg => {
            this.send(msg.event, msg.data);
        });
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index !== -1) {
            callbacks.splice(index, 1);
        }
    }

    emit(event, data) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        callbacks.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error('WebSocket listener error:', error);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    // Specific event handlers
    onNotification(callback) {
        return this.on('notification', callback);
    }

    onTestUpdate(callback) {
        return this.on('test_update', callback);
    }

    onResultUpdate(callback) {
        return this.on('result_update', callback);
    }

    onAttendanceUpdate(callback) {
        return this.on('attendance_update', callback);
    }

    onHomeworkUpdate(callback) {
        return this.on('homework_update', callback);
    }

    // Send specific events
    sendTestProgress(testId, progress) {
        this.send('test_progress', { testId, progress });
    }

    sendAnswerSubmitted(testId, questionId, answer) {
        this.send('answer_submitted', { testId, questionId, answer });
    }

    sendNotificationRead(notificationId) {
        this.send('notification_read', { notificationId });
    }
}

export const wsService = new WebSocketService();