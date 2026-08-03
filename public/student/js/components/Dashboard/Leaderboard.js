// public/student/js/components/Dashboard/Leaderboard.js
// FIX (security, audit 2026-07): escapeHTML() added — student names are
// user-controlled data and were being interpolated straight into innerHTML,
// meaning a name like <img src=x onerror=...> would execute in every other
// student's dashboard viewing the leaderboard. Same helper pattern already
// used in js/results.js and js/test.js.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class Leaderboard {
    constructor(selector, data) {
        this.selector = selector;
        this.data = data || [];
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        if (!this.data || this.data.length === 0) {
            this.element.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-trophy"></i>
                    <h4>No Rankings Yet</h4>
                    <p>Complete more tests to appear on the leaderboard</p>
                </div>
            `;
            return;
        }

        this.element.innerHTML = this.data.map(item => `
            <div class="leaderboard-item">
                <span class="rank ${item.rank <= 3 ? 'top' + item.rank : ''}">#${item.rank}</span>
                <div class="avatar">${escapeHTML(this.getInitials(item.name))}</div>
                <div class="info">
                    <div class="name">${escapeHTML(item.name)} ${item.isCurrentUser ? '⭐' : ''}</div>
                    <div class="score">Score: ${item.score || item.points}%</div>
                </div>
                <span class="points">${item.points || item.score}</span>
            </div>
        `).join('');
    }

    getInitials(name) {
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    update(data) {
        this.data = data;
        this.render();
    }
}