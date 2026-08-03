// public/student/js/components/Dashboard/UpcomingTests.js
// FIX (security, audit 2026-07): escapeHTML() added — test name/subject are
// admin-authored content but are still dynamic data flowing into innerHTML.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class UpcomingTests {
    constructor(selector, tests) {
        this.selector = selector;
        this.tests = tests || [];
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        if (!this.tests || this.tests.length === 0) {
            this.element.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-calendar-check"></i>
                    <h4>No Upcoming Tests</h4>
                    <p>Enjoy your break!</p>
                </div>
            `;
            return;
        }

        this.element.innerHTML = this.tests.map(test => `
            <div class="test-item" onclick="window.viewTest('${test.id}')">
                <div class="info">
                    <div class="name">${escapeHTML(test.name)}</div>
                    <div class="meta">
                        <span>${escapeHTML(test.subject)}</span>
                        <span>${test.date}</span>
                        <span>${test.time}</span>
                        <span class="countdown">⏱ ${this.getCountdown(test.date)}</span>
                    </div>
                </div>
                <span class="status ${test.status || 'upcoming'}">${this.capitalize(test.status || 'upcoming')}</span>
            </div>
        `).join('');
    }

    getCountdown(date) {
        const diff = new Date(date) - new Date();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    update(tests) {
        this.tests = tests;
        this.render();
    }
}