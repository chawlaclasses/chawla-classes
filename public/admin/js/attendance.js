// public/admin/js/attendance.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// ATTENDANCE
// ============================================================
let _attendanceRoster = [];

async function loadAttendance() {
    showLoading();
    try {
        const classesRes = await apiCall('/classes?limit=100');
        window._attendanceClasses = (classesRes?.data || []).filter(c => c.isActive !== false);
        const savedClassId = window._attendanceClassId || (window._attendanceClasses[0]?._id || '');
        const savedDate = window._attendanceDate || new Date().toISOString().slice(0, 10);
        window._attendanceClassId = savedClassId;
        window._attendanceDate = savedDate;
        renderAttendanceShell();
        if (savedClassId) await fetchAttendanceRoster();
    } catch (error) {
        showError('Failed to load attendance', error.message);
    }
}

function renderAttendanceShell() {
    const classes = window._attendanceClasses || [];
    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>📅 Attendance</h2>
        </div>
        <div style="display:flex;gap:14px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap;">
            <div class="form-group" style="max-width:240px;margin:0;">
                <label>Class</label>
                <select id="attClassSelect" onchange="onAttendanceClassOrDateChange()">
                    <option value="">Select a class</option>
                    ${classes.map(c => `<option value="${c._id}" ${c._id === window._attendanceClassId ? 'selected' : ''}>${escapeHtml(c.displayName || c.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="max-width:200px;margin:0;">
                <label>Date</label>
                <input type="date" id="attDateInput" value="${window._attendanceDate}" onchange="onAttendanceClassOrDateChange()">
            </div>
            <button class="btn btn-gold" onclick="saveAttendance()"><i class="fas fa-save"></i> Save Attendance</button>
            <button class="btn" onclick="markAllAttendance('Present')"><i class="fas fa-check"></i> Mark All Present</button>
        </div>
        <div id="attendanceRosterContainer"></div>
    `;
    renderAttendanceRoster();
}

async function onAttendanceClassOrDateChange() {
    window._attendanceClassId = document.getElementById('attClassSelect').value;
    window._attendanceDate = document.getElementById('attDateInput').value;
    if (!window._attendanceClassId) { _attendanceRoster = []; renderAttendanceRoster(); return; }
    await fetchAttendanceRoster();
}

async function fetchAttendanceRoster() {
    const classId = window._attendanceClassId;
    // Convert yyyy-mm-dd (from <input type=date>) to the M/D/YYYY format
    // the backend/rest of the app stores dates in.
    const [y, m, d] = window._attendanceDate.split('-');
    const backendDate = `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`;
    const res = await apiCall(`/attendance?classId=${classId}&date=${encodeURIComponent(backendDate)}`);
    _attendanceRoster = res?.data?.students || [];
    renderAttendanceRoster();
}

function renderAttendanceRoster() {
    const container = document.getElementById('attendanceRosterContainer');
    if (!container) return;
    if (!window._attendanceClassId) {
        container.innerHTML = `<div class="empty-state"><span class="icon">📅</span><strong>Select a class</strong><p>Pick a class above to mark attendance.</p></div>`;
        return;
    }
    if (_attendanceRoster.length === 0) {
        container.innerHTML = `<div class="empty-state"><span class="icon">📅</span><strong>No Active Students</strong><p>This class has no active students to mark.</p></div>`;
        return;
    }
    container.innerHTML = `
        <div class="table-container">
            <table>
                <thead><tr><th>Roll No.</th><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                <tbody>
                    ${_attendanceRoster.map((s, i) => `
                        <tr>
                            <td>${escapeHtml(s.rollNumber || '-')}</td>
                            <td>${escapeHtml(s.name)}</td>
                            <td style="color:var(--muted);font-size:12px;">${escapeHtml(s.email)}</td>
                            <td>
                                <button class="btn btn-sm ${s.status === 'Present' ? 'btn-success' : ''}" onclick="setAttendanceStatus(${i}, 'Present')">Present</button>
                                <button class="btn btn-sm ${s.status === 'Absent' ? 'btn-danger' : ''}" onclick="setAttendanceStatus(${i}, 'Absent')">Absent</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function setAttendanceStatus(index, status) {
    if (!_attendanceRoster[index]) return;
    _attendanceRoster[index].status = status;
    renderAttendanceRoster();
}

function markAllAttendance(status) {
    _attendanceRoster = _attendanceRoster.map(s => ({ ...s, status }));
    renderAttendanceRoster();
}

async function saveAttendance() {
    const records = _attendanceRoster.filter(s => s.status).map(s => ({ studentId: s.studentId, status: s.status }));
    if (records.length === 0) { showToast('Error', 'Mark at least one student before saving', 'error'); return; }
    const [y, m, d] = window._attendanceDate.split('-');
    const backendDate = `${parseInt(m, 10)}/${parseInt(d, 10)}/${y}`;
    const result = await apiCall('/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({ classId: window._attendanceClassId, date: backendDate, records })
    });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to save attendance', 'error'); return; }
    showToast('Success', result.message, 'success');
}

// Staff Management now lives in public/admin/js/staff.js (loadStaff,
// renderStaff, showAddStaffModal, editStaff, toggleStaffActive,
// STAFF_ROLE_LABELS) — moved there 2026-07 to add per-teacher
// assignedClasses support. This used to be a second, older copy of the
// same functions right here, which — because attendance.js loads before
// staff.js — was silently winning and overriding the newer version, so
// the "Assigned Classes" picker never appeared. Keeping only one copy
// now, in staff.js.