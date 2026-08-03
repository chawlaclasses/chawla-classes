// public/student/js/components/Dashboard/DailyTarget.js
// FIX (security, audit 2026-07): escapeHTML() added for the 'goal' text.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class DailyTarget {
    constructor(selector, target) {
        this.selector = selector;
        this.target = target || { goal: 'Practice 50 Questions', completed: 0, total: 50 };
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const { goal, completed = 0, total = 50 } = this.target;
        const percent = Math.min(Math.round((completed / total) * 100), 100);

        this.element.innerHTML = `
            <div class="daily-target">
                <div class="target-header">
                    <span class="goal">🎯 ${escapeHTML(goal)}</span>
                    <span class="progress-text">${completed}/${total}</span>
                </div>
                <div class="progress-bar">
                    <div class="fill" style="width:${percent}%;"></div>
                </div>
                <div style="margin-top:8px;font-size:13px;color:var(--gray-400);">
                    ${percent}% Complete • ${total - completed} remaining
                </div>
            </div>
        `;
    }

    update(target) {
        this.target = target;
        this.render();
    }
}