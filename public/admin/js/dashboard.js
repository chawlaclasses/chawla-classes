// public/admin/js/dashboard.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).
//
// COLOR UPDATE: chart colors switched from dark-theme palette to the
// light-theme palette used in admin-dashboard.html (blue accent instead
// of gold, dark-on-light axis/grid colors instead of light-on-dark).

// ============================================================
// LOAD DASHBOARD
// ============================================================
async function loadDashboard() {
    showLoading();

    try {
        const [res, analyticsRes] = await Promise.all([
            apiCall('/dashboard-overview'),
            apiCall('/dashboard-analytics')
        ]);
        if (!res || !res.success) {
            showError('Failed to load dashboard', res?.message || 'Unknown error');
            return;
        }
        const d = res.data;
        const a = analyticsRes && analyticsRes.success ? analyticsRes.data : null;

        const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

        contentArea.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card acc-blue">
                    <span class="stat-icon">👨‍🎓</span>
                    <div class="stat-value">${d.totalStudents}</div>
                    <div class="stat-label">Total Students</div>
                </div>
                <div class="stat-card acc-green">
                    <span class="stat-icon">✅</span>
                    <div class="stat-value">${d.activeStudents}</div>
                    <div class="stat-label">Active Students</div>
                </div>
                <div class="stat-card acc-purple">
                    <span class="stat-icon">📅</span>
                    <div class="stat-value">${d.todayAttendance.percentage !== null ? d.todayAttendance.percentage + '%' : 'No data'}</div>
                    <div class="stat-label">Today's Attendance ${d.todayAttendance.total ? `(${d.todayAttendance.present}/${d.todayAttendance.total})` : ''}</div>
                </div>
                <div class="stat-card acc-orange">
                    <span class="stat-icon">💰</span>
                    <div class="stat-value">${money(d.todayRevenue)}</div>
                    <div class="stat-label">Today's Revenue</div>
                </div>
                <div class="stat-card acc-orange">
                    <span class="stat-icon">⏳</span>
                    <div class="stat-value">${money(d.pendingFees.total)}</div>
                    <div class="stat-label">Pending Fees (${d.pendingFees.count})</div>
                </div>
                <div class="stat-card acc-green">
                    <span class="stat-icon">🖥️</span>
                    <div class="stat-value" style="color:#16a34a;">${d.serverStatus.status === 'online' ? 'Online' : d.serverStatus.status}</div>
                    <div class="stat-label">${Math.floor(d.serverStatus.uptimeSeconds / 60)}m uptime • ${d.serverStatus.memoryUsedMB}MB</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px;">

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <strong style="color:var(--white);">📝 Upcoming Tests</strong>
                    </div>
                    ${d.upcomingTests.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No published tests yet.</div>' :
                        d.upcomingTests.map(t => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);">
                                <div style="color:var(--white);font-size:13px;">${escapeHtml(t.title)}</div>
                                <div style="color:var(--muted);font-size:12px;">${escapeHtml(t.subject)} • ${escapeHtml(t.date)}</div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <strong style="color:var(--white);">🎓 Recent Admissions</strong>
                    </div>
                    ${d.recentAdmissions.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No students yet.</div>' :
                        d.recentAdmissions.map(a => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);">
                                <div style="color:var(--white);font-size:13px;">${escapeHtml(a.name)}</div>
                                <div style="color:var(--muted);font-size:12px;">${escapeHtml(a.class)} • ${escapeHtml(a.email)}</div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <strong style="color:var(--white);">📞 New Enquiries (${d.newEnquiries.count})</strong>
                        <button class="btn btn-gold" style="padding:4px 10px;font-size:12px;" onclick="showAddEnquiryModal()">+ Add</button>
                    </div>
                    ${d.newEnquiries.recent.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No enquiries logged yet.</div>' :
                        d.newEnquiries.recent.map(e => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);">
                                <div style="color:var(--white);font-size:13px;">${escapeHtml(e.name)} <span style="color:var(--muted);">— ${escapeHtml(e.phone)}</span></div>
                                <div style="color:var(--muted);font-size:12px;">${escapeHtml(e.interestedClass || 'General')} • ${escapeHtml(e.status)}</div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <strong style="color:var(--white);">🏆 Latest Results</strong>
                    </div>
                    ${d.latestResults.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No test attempts yet.</div>' :
                        d.latestResults.map(r => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                                <div>
                                    <div style="color:var(--white);font-size:13px;">${escapeHtml(r.studentName)}</div>
                                    <div style="color:var(--muted);font-size:12px;">${escapeHtml(r.testTitle)}</div>
                                </div>
                                <div style="color:${r.isPassed ? '#16a34a' : '#dc2626'};font-weight:600;font-size:13px;">${r.percentage}%</div>
                            </div>
                        `).join('')}
                </div>
            </div>

            ${a ? `
            <div style="margin-top:24px;margin-bottom:10px;">
                <strong style="color:var(--gold);font-size:15px;">📈 Analytics</strong>
            </div>
            <div class="stats-grid">
                <div class="stat-card acc-blue">
                    <span class="stat-icon">🆕</span>
                    <div class="stat-value">${a.admissionsThisMonth}</div>
                    <div class="stat-label">Admissions This Month</div>
                </div>
                <div class="stat-card acc-green">
                    <span class="stat-icon">🟢</span>
                    <div class="stat-value">${a.dailyActiveStudents}</div>
                    <div class="stat-label">Daily Active Students</div>
                </div>
                <div class="stat-card acc-purple">
                    <span class="stat-icon">🎯</span>
                    <div class="stat-value">${a.testCompletionRate !== null ? a.testCompletionRate + '%' : 'N/A'}</div>
                    <div class="stat-label">Test Completion Rate</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-top:16px;">

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;grid-column:span 2;min-width:0;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:10px;">💰 Fee Collection (Last 7 Days)</strong>
                    <div style="height:220px;"><canvas id="feeGraphCanvas"></canvas></div>
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:10px;">🌟 Top Performers</strong>
                    ${a.topPerformers.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No test attempts yet.</div>' :
                        a.topPerformers.map((p, i) => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                                <div style="color:var(--white);font-size:13px;">#${i + 1} ${escapeHtml(p.name)}</div>
                                <div style="color:#16a34a;font-weight:600;font-size:13px;">${p.averageScore}% <span style="color:var(--muted);font-weight:400;">(${p.testsAttempted})</span></div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:10px;">⚠️ Weak Performing Classes</strong>
                    ${a.weakClasses.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No test attempts yet.</div>' :
                        a.weakClasses.map(c => `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);display:flex;justify-content:space-between;">
                                <div style="color:var(--white);font-size:13px;">${escapeHtml(c.className)}</div>
                                <div style="color:#dc2626;font-weight:600;font-size:13px;">${c.averageScore}% <span style="color:var(--muted);font-weight:400;">(${c.testsAttempted})</span></div>
                            </div>
                        `).join('')}
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;grid-column:span 2;min-width:0;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:10px;">🕒 Recent Activity</strong>
                    ${a.activityTimeline.length === 0 ? '<div style="color:var(--muted);font-size:13px;">No recent activity.</div>' :
                        a.activityTimeline.map(t => {
                            const icons = { admission: '🆕', test: '📝', payment: '💰', enquiry: '📞' };
                            return `
                            <div style="padding:8px 0;border-bottom:1px solid var(--card-border);display:flex;gap:10px;">
                                <span>${icons[t.type] || '•'}</span>
                                <div style="flex:1;">
                                    <div style="color:var(--white);font-size:13px;">${escapeHtml(t.text)}</div>
                                    <div style="color:var(--muted);font-size:11px;">${new Date(t.date).toLocaleString()}</div>
                                </div>
                            </div>`;
                        }).join('')}
                </div>
            </div>
            ` : ''}

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:16px;">
                ${[
                    { icon: '🏫', label: 'Classes', section: 'classes' },
                    { icon: '📚', label: 'Subjects', section: 'subjects' },
                    { icon: '📋', label: 'Series', section: 'series' },
                    { icon: '📝', label: 'Tests', section: 'tests' },
                    { icon: '❓', label: 'Questions', section: 'questions' }
                ].map(item => `
                    <div onclick="switchSection('${item.section}')" style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:14px;text-align:center;cursor:pointer;transition:var(--transition);box-shadow:var(--shadow);">
                        <div style="font-size:22px;">${item.icon}</div>
                        <div style="color:var(--white);font-weight:600;margin-top:4px;font-size:13px;">${item.label}</div>
                    </div>
                `).join('')}
            </div>
        `;

        if (a && document.getElementById('feeGraphCanvas')) {
            if (window._feeChart) window._feeChart.destroy();
            const ctx = document.getElementById('feeGraphCanvas').getContext('2d');
            window._feeChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: a.feeCollectionGraph.map(p => new Date(p.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })),
                    datasets: [{
                        label: 'Fees Collected (₹)',
                        data: a.feeCollectionGraph.map(p => p.amount),
                        backgroundColor: 'rgba(79,110,247,0.55)',
                        borderColor: '#4F6EF7',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } },
                        y: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true }
                    }
                }
            });
        }
    } catch (error) {
        showError('Failed to load dashboard', error.message);
    }
}

// ============================================================
// ANALYTICS — 6 chart dashboards: Admission Growth, Fee Collection,
// Test Participation, Question Difficulty Distribution, Subject
// Performance, Student Engagement.
// ============================================================
const CHART_AXIS_COLOR = '#8A93AC';
const CHART_GRID_COLOR = 'rgba(20,30,60,0.08)';

async function loadAnalytics() {
    showLoading();
    try {
        const res = await apiCall('/analytics-dashboards');
        if (!res || !res.success) { showError('Failed to load analytics', res?.message || ''); return; }
        const a = res.data;

        contentArea.innerHTML = `
            <div class="toolbar"><h2>📊 Analytics</h2></div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;">

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:12px;">📈 Admission Growth <span style="color:var(--muted);font-weight:400;font-size:12px;">— last 12 months</span></strong>
                    <div style="height:240px;"><canvas id="admissionGrowthCanvas"></canvas></div>
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:4px;">💰 Fee Collection <span style="color:var(--muted);font-weight:400;font-size:12px;">— last 6 months</span></strong>
                    <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Total collected: ₹${a.feeCollection.totalCollected.toLocaleString('en-IN')} · Total pending: ₹${a.feeCollection.totalPending.toLocaleString('en-IN')}</div>
                    <div style="height:220px;"><canvas id="feeCollectionCanvas"></canvas></div>
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:12px;">📝 Test Participation <span style="color:var(--muted);font-weight:400;font-size:12px;">— published tests, most attempted first</span></strong>
                    ${a.testParticipation.length === 0
                        ? '<div style="color:var(--muted);font-size:13px;">No published tests with attempts yet.</div>'
                        : `<div style="height:260px;"><canvas id="testParticipationCanvas"></canvas></div>`
                    }
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:12px;">❓ Question Difficulty Distribution <span style="color:var(--muted);font-weight:400;font-size:12px;">— question bank</span></strong>
                    ${a.questionDifficulty.every(d => d.count === 0)
                        ? '<div style="color:var(--muted);font-size:13px;">No questions in the bank yet.</div>'
                        : `<div style="height:240px;display:flex;justify-content:center;"><canvas id="questionDifficultyCanvas"></canvas></div>`
                    }
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:12px;">📚 Subject Performance <span style="color:var(--muted);font-weight:400;font-size:12px;">— average score by subject</span></strong>
                    ${a.subjectPerformance.length === 0
                        ? '<div style="color:var(--muted);font-size:13px;">No test results yet.</div>'
                        : `<div style="height:240px;"><canvas id="subjectPerformanceCanvas"></canvas></div>`
                    }
                </div>

                <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:18px;box-shadow:var(--shadow);">
                    <strong style="color:var(--white);display:block;margin-bottom:4px;">🔥 Student Engagement <span style="color:var(--muted);font-weight:400;font-size:12px;">— daily attendance rate, last 14 days</span></strong>
                    <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Based on marked attendance — days with no attendance taken show a gap, not zero.</div>
                    <div style="height:220px;"><canvas id="studentEngagementCanvas"></canvas></div>
                </div>

            </div>
        `;

        // 1. Admission Growth — line chart
        if (window._admissionChart) window._admissionChart.destroy();
        window._admissionChart = new Chart(document.getElementById('admissionGrowthCanvas').getContext('2d'), {
            type: 'line',
            data: {
                labels: a.admissionGrowth.map(p => p.month),
                datasets: [{
                    label: 'New Admissions',
                    data: a.admissionGrowth.map(p => p.count),
                    borderColor: '#4F6EF7',
                    backgroundColor: 'rgba(79,110,247,0.12)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#4F6EF7'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } },
                    y: { ticks: { color: CHART_AXIS_COLOR, stepSize: 1 }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true }
                }
            }
        });

        // 2. Fee Collection — grouped bar (collected vs pending)
        if (window._feeCollectionChart) window._feeCollectionChart.destroy();
        window._feeCollectionChart = new Chart(document.getElementById('feeCollectionCanvas').getContext('2d'), {
            type: 'bar',
            data: {
                labels: a.feeCollection.monthly.map(p => p.month),
                datasets: [
                    { label: 'Collected (₹)', data: a.feeCollection.monthly.map(p => p.collected), backgroundColor: 'rgba(34,197,94,0.55)', borderColor: '#16a34a', borderWidth: 1, borderRadius: 4 },
                    { label: 'Pending (₹)', data: a.feeCollection.monthly.map(p => p.pending), backgroundColor: 'rgba(239,68,68,0.5)', borderColor: '#dc2626', borderWidth: 1, borderRadius: 4 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: CHART_AXIS_COLOR } } },
                scales: {
                    x: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } },
                    y: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true }
                }
            }
        });

        // 3. Test Participation — horizontal bar
        if (a.testParticipation.length > 0) {
            if (window._testParticipationChart) window._testParticipationChart.destroy();
            window._testParticipationChart = new Chart(document.getElementById('testParticipationCanvas').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: a.testParticipation.map(t => t.testTitle),
                    datasets: [{
                        label: 'Participation %',
                        data: a.testParticipation.map(t => t.participationRate),
                        backgroundColor: 'rgba(139,92,246,0.55)',
                        borderColor: '#8b5cf6',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { afterLabel: (ctx) => `${a.testParticipation[ctx.dataIndex].attempted} of ${a.testParticipation[ctx.dataIndex].eligible} eligible students` } }
                    },
                    scales: {
                        x: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true, max: 100 },
                        y: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } }
                    }
                }
            });
        }

        // 4. Question Difficulty — doughnut
        if (!a.questionDifficulty.every(d => d.count === 0)) {
            if (window._difficultyChart) window._difficultyChart.destroy();
            window._difficultyChart = new Chart(document.getElementById('questionDifficultyCanvas').getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: a.questionDifficulty.map(d => d.difficulty.charAt(0).toUpperCase() + d.difficulty.slice(1)),
                    datasets: [{
                        data: a.questionDifficulty.map(d => d.count),
                        backgroundColor: ['rgba(34,197,94,0.7)', 'rgba(245,166,35,0.7)', 'rgba(239,68,68,0.7)'],
                        borderColor: ['#16a34a', '#F5A623', '#dc2626'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { color: CHART_AXIS_COLOR } } }
                }
            });
        }

        // 5. Subject Performance — bar
        if (a.subjectPerformance.length > 0) {
            if (window._subjectPerfChart) window._subjectPerfChart.destroy();
            window._subjectPerfChart = new Chart(document.getElementById('subjectPerformanceCanvas').getContext('2d'), {
                type: 'bar',
                data: {
                    labels: a.subjectPerformance.map(s => s.subjectName),
                    datasets: [{
                        label: 'Average Score %',
                        data: a.subjectPerformance.map(s => s.averageScore),
                        backgroundColor: 'rgba(79,110,247,0.55)',
                        borderColor: '#4F6EF7',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } },
                        y: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true, max: 100 }
                    }
                }
            });
        }

        // 6. Student Engagement — line, with gaps for days with no attendance marked
        if (window._engagementChart) window._engagementChart.destroy();
        window._engagementChart = new Chart(document.getElementById('studentEngagementCanvas').getContext('2d'), {
            type: 'line',
            data: {
                labels: a.studentEngagement.map(p => p.date),
                datasets: [{
                    label: 'Attendance Rate %',
                    data: a.studentEngagement.map(p => p.attendanceRate),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139,92,246,0.12)',
                    fill: true,
                    tension: 0.3,
                    spanGaps: true,
                    pointBackgroundColor: '#8b5cf6'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: CHART_AXIS_COLOR }, grid: { display: false } },
                    y: { ticks: { color: CHART_AXIS_COLOR }, grid: { color: CHART_GRID_COLOR }, beginAtZero: true, max: 100 }
                }
            }
        });

    } catch (error) {
        showError('Failed to load analytics', error.message);
    }
}

function showAddEnquiryModal() {
    editingId = null;
    showModal('Log New Enquiry', 'Record a walk-in, call, or online enquiry', `
        <div class="form-group"><label>Name *</label><input type="text" id="enquiryName" placeholder="e.g., Priya Sharma"></div>
        <div class="form-group"><label>Phone *</label><input type="text" id="enquiryPhone" placeholder="e.g., 9876543210"></div>
        <div class="form-group"><label>Email</label><input type="text" id="enquiryEmail" placeholder="Optional"></div>
        <div class="form-group"><label>Interested Class</label><input type="text" id="enquiryClass" placeholder="e.g., Class X"></div>
        <div class="form-group"><label>Notes</label><textarea id="enquiryNotes" placeholder="Optional"></textarea></div>
    `, async () => {
        const name = document.getElementById('enquiryName').value.trim();
        const phone = document.getElementById('enquiryPhone').value.trim();
        const email = document.getElementById('enquiryEmail').value.trim();
        const interestedClass = document.getElementById('enquiryClass').value.trim();
        const notes = document.getElementById('enquiryNotes').value.trim();
        if (!name || !phone) { showToast('Error', 'Name and phone are required', 'error'); return; }
        const result = await apiCall('/enquiries', { method: 'POST', body: JSON.stringify({ name, phone, email, interestedClass, notes }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to log enquiry', 'error'); return; }
        showToast('Success', 'Enquiry logged', 'success');
        closeModal();
        refreshEnquiryBadge();
        if (currentSection === 'enquiries') loadEnquiries(); else loadDashboard();
    });
}