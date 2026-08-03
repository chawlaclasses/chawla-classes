// public/student/js/components/Dashboard/Charts.js
export class Charts {
    constructor(selector, stats) {
        this.selector = selector;
        this.stats = stats;
        this.element = null;
        this.charts = {};
    }

    render() {
        this.element = document.querySelector(this.selector);
        if (!this.element) return;

        this.element.innerHTML = `
            <div class="chart-container">
                <h4>Weekly Performance</h4>
                <canvas id="weeklyChart"></canvas>
            </div>
            <div class="chart-container">
                <h4>Subject Wise Marks</h4>
                <canvas id="subjectChart"></canvas>
            </div>
            <div class="chart-container">
                <h4>Monthly Progress</h4>
                <canvas id="monthlyChart"></canvas>
            </div>
            <div class="chart-container">
                <h4>Accuracy Trend</h4>
                <canvas id="accuracyChart"></canvas>
            </div>
        `;

        // Initialize charts after DOM update
        setTimeout(() => {
            this.initCharts();
        }, 100);
    }

    initCharts() {
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#94a3b8',
                        font: { size: 11 }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        };

        // Weekly Chart
        const weeklyCtx = document.getElementById('weeklyChart')?.getContext('2d');
        if (weeklyCtx && window.Chart) {
            this.charts.weekly = new Chart(weeklyCtx, {
                type: 'line',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [{
                        label: 'Score (%)',
                        data: [65, 72, 58, 84, 79, 91, 88],
                        borderColor: '#c9a84c',
                        backgroundColor: 'rgba(201,168,76,0.1)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#c9a84c'
                    }]
                },
                options: chartOptions
            });
        }

        // Subject Chart
        const subjectCtx = document.getElementById('subjectChart')?.getContext('2d');
        if (subjectCtx && window.Chart) {
            this.charts.subject = new Chart(subjectCtx, {
                type: 'bar',
                data: {
                    labels: ['Math', 'Physics', 'Chemistry', 'Biology', 'English'],
                    datasets: [{
                        label: 'Marks (%)',
                        data: [85, 72, 68, 79, 90],
                        backgroundColor: ['#c9a84c', '#3b82f6', '#a855f7', '#22c55e', '#fb923c'],
                        borderRadius: 4
                    }]
                },
                options: {
                    ...chartOptions,
                    plugins: {
                        ...chartOptions.plugins,
                        legend: { display: false }
                    }
                }
            });
        }

        // Monthly Chart
        const monthlyCtx = document.getElementById('monthlyChart')?.getContext('2d');
        if (monthlyCtx && window.Chart) {
            this.charts.monthly = new Chart(monthlyCtx, {
                type: 'line',
                data: {
                    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
                    datasets: [{
                        label: 'Progress (%)',
                        data: [68, 74, 82, 79],
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59,130,246,0.1)',
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#3b82f6'
                    }]
                },
                options: chartOptions
            });
        }

        // Accuracy Chart
        const accuracyCtx = document.getElementById('accuracyChart')?.getContext('2d');
        if (accuracyCtx && window.Chart) {
            this.charts.accuracy = new Chart(accuracyCtx, {
                type: 'bar',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    datasets: [{
                        label: 'Accuracy (%)',
                        data: [62, 68, 73, 78, 82, 78],
                        backgroundColor: 'rgba(201,168,76,0.7)',
                        borderRadius: 4
                    }]
                },
                options: {
                    ...chartOptions,
                    plugins: {
                        ...chartOptions.plugins,
                        legend: { display: false }
                    }
                }
            });
        }
    }

    update(data) {
        this.stats = data;
        Object.keys(this.charts).forEach(key => {
            if (this.charts[key]) {
                this.charts[key].destroy();
            }
        });
        this.render();
    }

    destroy() {
        Object.keys(this.charts).forEach(key => {
            if (this.charts[key]) {
                this.charts[key].destroy();
            }
        });
        this.charts = {};
    }
}