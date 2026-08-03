// public/student/js/components/Dashboard/Welcome.js
// FIX (security, audit 2026-07): escapeHTML() added — student name/class/
// section/rollNo/batch/admissionNo are dynamic profile fields interpolated
// into innerHTML on the student's own dashboard.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class Welcome {
    constructor(selector, student) {
        this.selector = selector;
        this.student = student;
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const greeting = this.getGreeting();
        const student = this.student;

        this.element.innerHTML = `
            <div class="greeting">
                <h2>${greeting}, <span class="highlight">${escapeHTML(student?.name || 'Student')}</span> 👋</h2>
                <p>Class ${escapeHTML(student?.class || 'N/A')} • Section ${escapeHTML(student?.section || 'N/A')} • Roll # ${escapeHTML(student?.rollNo || 'N/A')} • Batch ${escapeHTML(student?.batch || 'N/A')}</p>
                <p style="margin-top:4px;font-size:13px;">
                    <span>📅 ${this.formatDate(new Date())}</span>
                    <span style="margin-left:16px;">🎯 ${student?.profileComplete || 0}% Profile Complete</span>
                </p>
            </div>
            <div class="student-badge">
                <div class="badge-item"><i class="fas fa-id-card"></i> ADM: ${escapeHTML(student?.admissionNo || 'N/A')}</div>
                <div class="badge-item"><i class="fas fa-calendar-alt"></i> Session ${escapeHTML(student?.batch || 'N/A')}</div>
                <div class="badge-item"><i class="fas fa-trophy"></i> Level ${student?.level || 1}</div>
                <div class="badge-item"><i class="fas fa-fire"></i> ${student?.streak || 0} Day Streak</div>
            </div>
        `;
    }

    getGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 17) return 'Good Afternoon';
        if (hour < 20) return 'Good Evening';
        return 'Good Night';
    }

    formatDate(date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
}