// public/student/js/components/Dashboard/Stats.js
export class Stats {
    constructor(selector, stats) {
        this.selector = selector;
        this.stats = stats;
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const stats = this.stats || {};
        const items = [
            { icon: 'fa-book', label: 'Total Tests', value: stats.totalTests || 0, color: 'gold' },
            { icon: 'fa-check-circle', label: 'Completed', value: stats.completedTests || 0, color: 'green' },
            { icon: 'fa-clock', label: 'Pending', value: stats.pendingTests || 0, color: 'orange' },
            { icon: 'fa-chart-line', label: 'Avg Score', value: `${stats.avgScore || 0}%`, color: 'blue' },
            { icon: 'fa-trophy', label: 'Best Score', value: `${stats.bestScore || 0}%`, color: 'gold' },
            { icon: 'fa-star', label: 'Class Rank', value: `#${stats.classRank || 'N/A'}`, color: 'purple' },
            { icon: 'fa-users', label: 'Overall Rank', value: `#${stats.overallRank || 'N/A'}`, color: 'blue' },
            { icon: 'fa-calendar-check', label: 'Attendance', value: `${stats.attendance || 0}%`, color: 'green' },
            { icon: 'fa-fire', label: 'Study Streak', value: `${stats.streak || 0}d`, color: 'orange' },
            { icon: 'fa-level-up-alt', label: 'Level', value: stats.level || 1, color: 'gold' },
            { icon: 'fa-coins', label: 'Coins', value: stats.coins || 0, color: 'gold' },
            { icon: 'fa-award', label: 'Achievements', value: stats.achievements || 0, color: 'purple' }
        ];

        this.element.innerHTML = items.map(item => `
            <div class="stat-card animate-in">
                <div class="stat-icon ${item.color}">
                    <i class="fas ${item.icon}"></i>
                </div>
                <div class="stat-number">${item.value}</div>
                <div class="stat-label">${item.label}</div>
                ${item.change ? `<div class="stat-change ${item.change > 0 ? 'up' : 'down'}">${item.change > 0 ? '+' : ''}${item.change}%</div>` : ''}
            </div>
        `).join('');
    }
}