// public/student/js/components/Dashboard/Activity.js
// FIX (security, audit 2026-07): escapeHTML() added — same helper already
// used in js/results.js and js/test.js — to prevent stored XSS via
// activity-feed text interpolated into innerHTML.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class Activity {
    constructor(selector, activities) {
        this.selector = selector;
        this.activities = activities || [];
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        if (!this.activities || this.activities.length === 0) {
            this.element.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clock"></i>
                    <h4>No Recent Activity</h4>
                    <p>Start practicing to see your activity here</p>
                </div>
            `;
            return;
        }

        this.element.innerHTML = this.activities.map(item => `
            <div class="activity-item">
                <div class="icon"><i class="fas ${item.icon || 'fa-check-circle'}"></i></div>
                <div class="content">
                    <div class="text">${escapeHTML(item.text)}</div>
                    <div class="time">${item.time || 'Just now'}</div>
                </div>
            </div>
        `).join('');
    }

    update(activities) {
        this.activities = activities;
        this.render();
    }
}