// public/student/js/components/Dashboard/Calendar.js
export class Calendar {
    constructor(selector) {
        this.selector = selector;
        this.element = null;
        this.currentMonth = new Date().getMonth();
        this.currentYear = new Date().getFullYear();
        this.events = [];
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
        const firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
        const today = new Date().getDate();

        // Get events for this month
        this.events = this.getEvents();

        let html = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-weight:600;color:var(--white);">
                    ${new Date(this.currentYear, this.currentMonth).toLocaleString('default', { month: 'long' })} ${this.currentYear}
                </span>
                <div style="display:flex;gap:8px;">
                    <button onclick="window.dashboard?.components?.calendar?.prevMonth()" style="background:none;border:none;color:var(--gray-400);cursor:pointer;padding:4px 8px;">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button onclick="window.dashboard?.components?.calendar?.nextMonth()" style="background:none;border:none;color:var(--gray-400);cursor:pointer;padding:4px 8px;">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            <div class="calendar-grid">
        `;

        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayLabels.forEach(label => {
            html += `<div class="day-label">${label}</div>`;
        });

        // Empty days
        for (let i = 0; i < firstDay; i++) {
            html += `<div class="day other-month"></div>`;
        }

        // Days
        for (let day = 1; day <= daysInMonth; day++) {
            const isToday = day === today && this.currentMonth === new Date().getMonth();
            const hasEvent = this.events.some(e => e.day === day);
            html += `
                <div class="day ${isToday ? 'today' : ''} ${hasEvent ? 'has-event' : ''}" onclick="window.dashboard?.components?.calendar?.onDayClick(${day})">
                    ${day}
                </div>
            `;
        }

        html += `</div>`;
        this.element.innerHTML = html;
    }

    getEvents() {
        // Mock events - replace with API call
        return [
            { day: 4, type: 'test', title: 'Math Test' },
            { day: 6, type: 'test', title: 'Physics Test' },
            { day: 8, type: 'test', title: 'Chemistry Test' },
            { day: 12, type: 'holiday', title: 'Holiday' },
            { day: 15, type: 'assignment', title: 'Assignment Due' },
            { day: 20, type: 'test', title: 'Biology Test' },
            { day: 25, type: 'test', title: 'English Test' }
        ];
    }

    prevMonth() {
        this.currentMonth--;
        if (this.currentMonth < 0) {
            this.currentMonth = 11;
            this.currentYear--;
        }
        this.render();
    }

    nextMonth() {
        this.currentMonth++;
        if (this.currentMonth > 11) {
            this.currentMonth = 0;
            this.currentYear++;
        }
        this.render();
    }

    onDayClick(day) {
        const event = this.events.find(e => e.day === day);
        if (event) {
            window.showToast(`📅 ${event.title}`, `Event on ${day} ${new Date(this.currentYear, this.currentMonth).toLocaleString('default', { month: 'long' })}`, 'info');
        }
    }
}