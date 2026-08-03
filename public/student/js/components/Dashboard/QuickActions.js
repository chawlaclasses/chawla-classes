// public/student/js/components/Dashboard/QuickActions.js
export class QuickActions {
    constructor(selector, resumeTest) {
        this.selector = selector;
        this.resumeTest = resumeTest;
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const resume = this.resumeTest || {};
        
        this.element.innerHTML = `
            <button class="action-btn" onclick="window.resumeTest()">
                <div class="progress-ring" id="resumeRing">${resume.hasTest ? resume.progress + '%' : 'Start'}</div>
                <span class="label">Resume Test</span>
            </button>
            <button class="action-btn" onclick="window.startPractice()">
                <i class="fas fa-pencil-alt"></i>
                <span class="label">Practice</span>
            </button>
            <button class="action-btn" onclick="window.downloadNotes()">
                <i class="fas fa-download"></i>
                <span class="label">Download Notes</span>
            </button>
            <button class="action-btn" onclick="window.startRevision()">
                <i class="fas fa-sync-alt"></i>
                <span class="label">Revision</span>
            </button>
            <button class="action-btn" onclick="window.viewBookmarks()">
                <i class="fas fa-star"></i>
                <span class="label">Bookmarks</span>
            </button>
            <button class="action-btn" onclick="window.viewWrongQuestions()">
                <i class="fas fa-times-circle"></i>
                <span class="label">Wrong Questions</span>
            </button>
            <button class="action-btn" onclick="window.startMockTest()">
                <i class="fas fa-trophy"></i>
                <span class="label">Mock Test</span>
            </button>
        `;

        // Update resume ring style
        const ring = document.getElementById('resumeRing');
        if (ring && resume.hasTest) {
            ring.style.borderTopColor = 'var(--gold)';
        } else if (ring) {
            ring.style.borderTopColor = 'var(--gray-500)';
        }
    }

    update(resumeTest) {
        this.resumeTest = resumeTest;
        this.render();
    }
}