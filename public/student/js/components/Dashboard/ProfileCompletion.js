// public/student/js/components/Dashboard/ProfileCompletion.js
export class ProfileCompletion {
    constructor(selector, student) {
        this.selector = selector;
        this.student = student;
        this.element = null;
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const student = this.student || {};
        const percent = student.profileComplete || 0;
        const fields = student.fieldsMissing || [];

        this.element.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div>
                    <h4 style="font-size:15px;">Profile Completion</h4>
                    <p style="font-size:13px;color:var(--gray-400);">Complete your profile for better recommendations</p>
                </div>
                <span style="font-weight:700;color:var(--gold);">${percent}%</span>
            </div>
            <div class="completion-bar">
                <div class="fill" style="width:${percent}%;"></div>
            </div>
            <div class="completion-info">
                <span>${percent}% Complete</span>
                <span>${fields.length} fields remaining</span>
            </div>
            <div class="fields-missing">
                ${fields.map(field => `
                    <span class="tag" onclick="window.editProfileField('${field}')">
                        <i class="fas fa-edit"></i> ${field}
                    </span>
                `).join('')}
            </div>
        `;
    }

    update(student) {
        this.student = student;
        this.render();
    }
}