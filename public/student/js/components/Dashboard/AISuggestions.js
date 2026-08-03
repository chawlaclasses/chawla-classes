// public/student/js/components/Dashboard/AISuggestions.js
// FIX (security, audit 2026-07): escapeHTML() added to prevent stored XSS —
// AI-generated title/desc are model output, not fully trusted input, and
// were being interpolated straight into innerHTML.
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export class AISuggestions {
    constructor(selector, suggestions) {
        this.selector = selector;
        this.suggestions = suggestions || [];
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        if (!this.suggestions || this.suggestions.length === 0) {
            this.element.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-robot"></i>
                    <h4>No AI Suggestions</h4>
                    <p>Complete more tests to get personalized suggestions</p>
                </div>
            `;
            return;
        }

        this.element.innerHTML = this.suggestions.map(s => `
            <div class="ai-card" onclick="window.handleAISuggestion('${s.type || 'general'}')">
                <div class="title">
                    <i class="fas ${s.icon || 'fa-lightbulb'}"></i>
                    ${escapeHTML(s.title)}
                </div>
                <div class="desc">${escapeHTML(s.desc)}</div>
            </div>
        `).join('');
    }

    update(suggestions) {
        this.suggestions = suggestions;
        this.render();
    }
}