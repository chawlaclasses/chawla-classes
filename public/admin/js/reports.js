// public/admin/js/reports.js
// New module: Reports section (Student Report — first of several report
// types planned). Follows the same conventions as attendance.js/students.js:
// classic global-scope script, contentArea.innerHTML rendering, apiCall()
// for JSON, raw fetch() for binary PDF/CSV downloads (apiCall always does
// response.json(), which would break on binary content).

let _reportsStudentList = [];
let _reportsSelectedStudentId = null;

async function loadReports() {
    showLoading();
    try {
        const res = await apiCall('/students-list');
        _reportsStudentList = (res?.data || []).filter(s => s.isActive !== false)
            .sort((a, b) => a.name.localeCompare(b.name));
        renderReportsShell();
    } catch (error) {
        showError('Failed to load Reports', error.message);
    }
}

// FIX (dark theme regression): this section used to wrap its content in a
// hardcoded `background:#fff` box with no explicit text color, left over
// from before the admin panel's dark theme redesign. Every other section
// (attendance.js, students.js, etc.) just places its filter row directly
// on `.content-area`'s own (dark) background — no extra card — and relies
// on the shared `.form-group input/select` + `var(--text)`/`var(--muted)`
// rules for readable colors. Following that same pattern here instead of
// the leftover light-theme markup, which rendered as near-invisible light
// text on a white box sitting inside the otherwise-dark dashboard.
function renderReportsShell() {
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📄 Reports</h2>
        </div>
        <div style="margin-bottom:16px;">
            <h3 style="margin-bottom:12px;color:var(--white);font-size:15px;">Student Report</h3>
            <div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;">
                <div class="form-group" style="max-width:320px;margin:0;flex:1;">
                    <label>Student</label>
                    <input type="text" id="reportStudentSearch" placeholder="Search by name or roll no..." oninput="filterReportStudentOptions()" list="reportStudentDatalist" autocomplete="off">
                    <datalist id="reportStudentDatalist">
                        ${_reportsStudentList.map(s => `<option value="${escapeHtml(s.name)}${s.rollNumber ? ' (' + escapeHtml(s.rollNumber) + ')' : ''}" data-id="${s._id}"></option>`).join('')}
                    </datalist>
                </div>
                <div class="form-group" style="max-width:320px;margin:0;">
                    <label>&nbsp;</label>
                    <select id="reportStudentSelect" onchange="onReportStudentSelected(this.value)">
                        <option value="">Select a student</option>
                        ${_reportsStudentList.map(s => `<option value="${s._id}">${escapeHtml(s.name)}${s.rollNumber ? ' — ' + escapeHtml(s.rollNumber) : ''} (${escapeHtml(s.class)})</option>`).join('')}
                    </select>
                </div>
            </div>
        </div>
        <div id="reportResultContainer"></div>
    `;
}

// The text search box is a convenience filter over the <select> (typing
// narrows what's easy to find in a long list); the <select> itself remains
// the actual source of truth for which student is picked.
function filterReportStudentOptions() {
    const searchInput = document.getElementById('reportStudentSearch');
    const query = searchInput.value.trim().toLowerCase();
    const select = document.getElementById('reportStudentSelect');
    Array.from(select.options).forEach(opt => {
        if (!opt.value) return; // keep the placeholder
        opt.hidden = query.length > 0 && !opt.textContent.toLowerCase().includes(query);
    });

    // FIX: picking a suggestion from the <datalist> only fills this text
    // input's value — it doesn't touch the <select> or fire its onchange,
    // so the report never loaded. If what's typed exactly matches one of
    // the datalist entries (which is exactly what happens the instant a
    // suggestion is picked), treat it as a real selection.
    const matched = _reportsStudentList.find(s => {
        const label = `${s.name}${s.rollNumber ? ' (' + s.rollNumber + ')' : ''}`;
        return label.toLowerCase() === query;
    });
    if (matched) {
        select.value = matched._id;
        onReportStudentSelected(matched._id);
    }
}

async function onReportStudentSelected(studentId) {
    _reportsSelectedStudentId = studentId || null;
    const container = document.getElementById('reportResultContainer');
    if (!studentId) { container.innerHTML = ''; return; }

    container.innerHTML = `<div class="loading" style="padding:24px 0;">Loading report…</div>`;
    const res = await apiCall(`/reports/student/${studentId}`);
    if (!res || !res.success) {
        container.innerHTML = `<div class="empty-state"><span class="icon">⚠️</span><p>Could not load report for this student.</p></div>`;
        return;
    }
    renderReportResult(res.data);
}

function statBlock(val, lbl) {
    return `
        <div style="text-align:center;padding:12px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:8px;">
            <div style="font-size:18px;font-weight:800;color:var(--gold);">${escapeHtml(String(val))}</div>
            <div style="font-size:10.5px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(lbl)}</div>
        </div>
    `;
}

function renderReportResult(d) {
    const container = document.getElementById('reportResultContainer');
    container.innerHTML = `
        <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px;padding:18px 20px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
                <div>
                    <h3 style="margin-bottom:4px;color:var(--white);">${escapeHtml(d.student.name)}</h3>
                    <div style="font-size:12.5px;color:var(--muted);">Roll No: ${escapeHtml(d.student.rollNumber) || '—'} · Class: ${escapeHtml(d.student.className)}</div>
                </div>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-gold" onclick="downloadStudentReport('pdf')"><i class="fas fa-file-pdf"></i> PDF</button>
                    <button class="btn" onclick="downloadStudentReport('csv')"><i class="fas fa-file-excel"></i> Excel (CSV)</button>
                </div>
            </div>

            <h4 style="font-size:12.5px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;">Attendance</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:18px;">
                ${statBlock(d.attendance.percentage + '%', 'Attendance')}
                ${statBlock(d.attendance.present, 'Present')}
                ${statBlock(d.attendance.absent, 'Absent')}
            </div>

            <h4 style="font-size:12.5px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;">Test Results</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:18px;">
                ${statBlock(d.results.testsAttempted, 'Tests')}
                ${statBlock(d.results.averagePercentage + '%', 'Average')}
                ${statBlock(d.results.bestPercentage + '%', 'Best')}
                ${statBlock(d.results.passRate + '%', 'Pass Rate')}
            </div>

            <h4 style="font-size:12.5px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;">Fees</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:18px;">
                ${statBlock('₹' + d.fees.totalBilled, 'Billed')}
                ${statBlock('₹' + d.fees.totalPaid, 'Paid')}
                ${statBlock('₹' + d.fees.totalPending, 'Pending')}
                ${statBlock(d.fees.overdueCount, 'Overdue')}
            </div>

            <h4 style="font-size:12.5px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;">Homework</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;">
                ${statBlock(d.homework.assigned, 'Assigned')}
                ${statBlock(d.homework.submitted, 'Submitted')}
                ${statBlock(d.homework.graded, 'Graded')}
                ${statBlock(d.homework.averageScore ?? 'N/A', 'Avg Score')}
            </div>
        </div>
    `;
}

async function downloadStudentReport(format) {
    if (!_reportsSelectedStudentId) return;
    try {
        const response = await fetch(`${API_BASE}/reports/student/${_reportsSelectedStudentId}?format=${format}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = format === 'pdf' ? `student-report-${_reportsSelectedStudentId}.pdf` : `student-report-${_reportsSelectedStudentId}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        window.URL.revokeObjectURL(url);
    } catch (error) {
        showToast('Error', 'Could not download report.', 'error');
    }
}