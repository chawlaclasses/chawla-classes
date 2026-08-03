// public/admin/js/fees.js
// Extracted from the former dashboard.html inline <script> block during
// admin panel modularization. Order-preserving split — loaded via
// <script src> tags in the exact original top-to-bottom order, so
// execution semantics are unchanged (still classic global-scope scripts,
// not ES modules — inline onclick="..." handlers throughout dashboard.html
// need these functions in global scope; see the CSP note in app.js for why
// that conversion is a separate follow-up).

// ============================================================
// FEES
// ============================================================
async function loadFees() {
    showLoading();
    try {
        const feesRes = await apiCall('/fees');
        currentData = feesRes?.data || [];
        renderFees();
    } catch (error) {
        showError('Failed to load fees', error.message);
    }
}

function feeStatusBadge(f) {
    if (f.status === 'Paid') return `<span class="status-badge status-published">Paid</span>`;
    if (f.isOverdue) return `<span class="status-badge status-open">Overdue (${f.daysOverdue}d)</span>`;
    return `<span class="status-badge status-draft">Pending</span>`;
}

const PAYMENT_STATUS_LABELS = { not_initiated: 'Not Initiated', processing: 'Processing', success: 'Success', failed: 'Failed' };

function renderFees() {
    const feeFilter = window._feeStatusFilter || '';
    const rows = feeFilter === 'overdue' ? currentData.filter(f => f.isOverdue)
        : feeFilter ? currentData.filter(f => f.status === feeFilter)
        : currentData;

    contentArea.innerHTML = `
        <div class="toolbar">
            <h2>💰 Fees <span class="count">(${currentData.length})</span></h2>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="remindAllOverdue()"><i class="fas fa-bell"></i> Remind All Overdue</button>
                <button class="btn btn-secondary" onclick="showFeePlanModal()"><i class="fas fa-layer-group"></i> Installment Plan</button>
                <button class="btn btn-gold" onclick="showAddFeeModal()"><i class="fas fa-plus"></i> Add Fee Record</button>
            </div>
        </div>
        <div class="toolbar">
            <select id="feeStatusFilterSelect" onchange="window._feeStatusFilter=this.value; renderFees();" style="max-width:200px;">
                <option value="" ${feeFilter === '' ? 'selected' : ''}>All Records</option>
                <option value="Pending" ${feeFilter === 'Pending' ? 'selected' : ''}>Pending</option>
                <option value="overdue" ${feeFilter === 'overdue' ? 'selected' : ''}>Overdue Only</option>
                <option value="Paid" ${feeFilter === 'Paid' ? 'selected' : ''}>Paid</option>
            </select>
        </div>
        ${rows.length === 0 ? `
            <div class="empty-state"><span class="icon">💰</span><strong>No Fee Records</strong><p>Click "Add Fee Record" to create a pending fee for a student.</p></div>
        ` : `
            <div class="table-container">
                <table>
                    <thead><tr><th>Student</th><th>Title</th><th>Net Payable</th><th>Due Date</th><th>Status</th><th>Payment</th><th>Actions</th></tr></thead>
                    <tbody>
                        ${rows.map(f => `
                            <tr>
                                <td>${escapeHtml(f.studentName || f.studentId)}${f.className ? `<br><span style="font-size:11px;color:var(--muted);">${escapeHtml(f.className)}</span>` : ''}</td>
                                <td>${escapeHtml(f.title || f.description || '-')}${f.totalInstallments > 1 ? `<br><span style="font-size:11px;color:var(--muted);">Installment ${f.installmentNumber}/${f.totalInstallments}</span>` : ''}</td>
                                <td title="Base ₹${f.amount} ${f.discountAmount ? `− discount ₹${f.discountAmount} ` : ''}${f.scholarshipAmount ? `− scholarship ₹${f.scholarshipAmount} ` : ''}${f.lateFineAmount ? `+ late fine ₹${f.lateFineAmount}` : ''}">
                                    ₹${Number(f.netPayable).toLocaleString('en-IN')}
                                    ${(f.discountAmount > 0 || f.scholarshipAmount > 0 || f.lateFineAmount > 0) ? '<i class="fas fa-info-circle" style="color:var(--muted);font-size:11px;"></i>' : ''}
                                </td>
                                <td>${new Date(f.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                <td>${feeStatusBadge(f)}</td>
                                <td>${f.status === 'Paid' ? escapeHtml((f.paymentMethod || 'cash').toUpperCase()) : `<span style="font-size:11px;color:var(--muted);">${PAYMENT_STATUS_LABELS[f.paymentStatus] || 'Not Initiated'}</span>`}</td>
                                <td style="white-space:nowrap;">
                                    ${f.status !== 'Paid' ? `
                                        <button class="btn btn-success btn-sm" onclick="markFeePaidModal('${f._id}')" title="Mark Paid"><i class="fas fa-check"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="feeDetailModal('${f._id}')" title="Discount / Late Fine / Edit"><i class="fas fa-edit"></i></button>
                                        <button class="btn btn-secondary btn-sm" onclick="remindOneFee('${f._id}')" title="Send Reminder"><i class="fas fa-bell"></i></button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteFee('${f._id}')" title="Delete"><i class="fas fa-trash"></i></button>
                                    ` : `
                                        <button class="btn btn-gold btn-sm" onclick="downloadFeeReceipt('${f._id}')" title="Download Receipt"><i class="fas fa-file-pdf"></i> Receipt</button>
                                    `}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `}
    `;
}

async function showAddFeeModal() {
    const studentsRes = await apiCall('/students-list');
    const students = studentsRes?.data || [];
    showModal('Add Fee Record', 'Create a pending fee for a student', `
        <div class="form-group"><label>Student *</label>
            <select id="feeStudentId">
                <option value="">Select a student</option>
                ${students.map(s => `<option value="${s._id}">${escapeHtml(s.name)} — ${escapeHtml(s.class)} (${escapeHtml(s.email)})</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Title</label><input type="text" id="feeTitle" placeholder="e.g., Term 2 Fee"></div>
        <div class="form-row">
            <div class="form-group"><label>Amount (₹) *</label><input type="number" id="feeAmount" placeholder="e.g., 5000"></div>
            <div class="form-group"><label>Due Date *</label><input type="date" id="feeDueDate"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Discount (₹)</label><input type="number" id="feeDiscount" value="0"></div>
            <div class="form-group"><label>Discount Reason</label><input type="text" id="feeDiscountReason" placeholder="optional"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Scholarship (₹)</label><input type="number" id="feeScholarship" value="0"></div>
            <div class="form-group"><label>Scholarship Reason</label><input type="text" id="feeScholarshipReason" placeholder="optional"></div>
        </div>
    `, async () => {
        const studentId = document.getElementById('feeStudentId').value.trim();
        const amount = document.getElementById('feeAmount').value.trim();
        const dueDate = document.getElementById('feeDueDate').value.trim();
        const title = document.getElementById('feeTitle').value.trim();
        const discountAmount = document.getElementById('feeDiscount').value;
        const discountReason = document.getElementById('feeDiscountReason').value.trim();
        const scholarshipAmount = document.getElementById('feeScholarship').value;
        const scholarshipReason = document.getElementById('feeScholarshipReason').value.trim();
        if (!studentId || !amount || !dueDate) { showToast('Error', 'Student, amount and due date are required', 'error'); return; }
        const result = await apiCall('/fees', { method: 'POST', body: JSON.stringify({ studentId, amount, dueDate, title, discountAmount, discountReason, scholarshipAmount, scholarshipReason }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create fee record', 'error'); return; }
        showToast('Success', 'Fee record created', 'success');
        closeModal();
        loadFees();
    });
}

async function showFeePlanModal() {
    const studentsRes = await apiCall('/students-list');
    const students = studentsRes?.data || [];
    showModal('Create Installment Plan', 'Split a total fee across multiple installments', `
        <div class="form-group"><label>Student *</label>
            <select id="planStudentId">
                <option value="">Select a student</option>
                ${students.map(s => `<option value="${s._id}">${escapeHtml(s.name)} — ${escapeHtml(s.class)}</option>`).join('')}
            </select>
        </div>
        <div class="form-group"><label>Title</label><input type="text" id="planTitle" placeholder="e.g., Annual Tuition Fee"></div>
        <div class="form-row">
            <div class="form-group"><label>Total Amount (₹) *</label><input type="number" id="planTotal" placeholder="e.g., 30000"></div>
            <div class="form-group"><label>Number of Installments *</label><input type="number" id="planCount" value="3" min="1" max="12"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>First Due Date *</label><input type="date" id="planFirstDue"></div>
            <div class="form-group"><label>Gap Between (days)</label><input type="number" id="planGap" value="30"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Discount (₹, total)</label><input type="number" id="planDiscount" value="0"></div>
            <div class="form-group"><label>Scholarship (₹, total)</label><input type="number" id="planScholarship" value="0"></div>
        </div>
        <p style="font-size:12px;color:var(--muted);">Discount/scholarship will be split evenly across installments.</p>
    `, async () => {
        const studentId = document.getElementById('planStudentId').value;
        const title = document.getElementById('planTitle').value.trim();
        const totalAmount = document.getElementById('planTotal').value;
        const installments = document.getElementById('planCount').value;
        const firstDueDate = document.getElementById('planFirstDue').value;
        const intervalDays = document.getElementById('planGap').value;
        const discountAmount = document.getElementById('planDiscount').value;
        const scholarshipAmount = document.getElementById('planScholarship').value;
        if (!studentId || !totalAmount || !installments || !firstDueDate) { showToast('Error', 'Student, total amount, installments and first due date are required', 'error'); return; }
        const result = await apiCall('/fees/plan', {
            method: 'POST',
            body: JSON.stringify({ studentId, title, totalAmount, installments, firstDueDate, intervalDays, discountAmount, scholarshipAmount })
        });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to create installment plan', 'error'); return; }
        showToast('Success', result.message, 'success');
        closeModal();
        loadFees();
    });
}

function feeDetailModal(id) {
    const fee = currentData.find(f => f._id === id);
    if (!fee) return;
    showModal('Fee Details', escapeHtml(fee.studentName || ''), `
        <div class="form-row">
            <div class="form-group"><label>Amount (₹)</label><input type="number" id="editFeeAmount" value="${fee.amount}"></div>
            <div class="form-group"><label>Due Date</label><input type="date" id="editFeeDueDate" value="${new Date(fee.dueDate).toISOString().slice(0,10)}"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>Discount (₹)</label><input type="number" id="editFeeDiscount" value="${fee.discountAmount || 0}"></div>
            <div class="form-group"><label>Scholarship (₹)</label><input type="number" id="editFeeScholarship" value="${fee.scholarshipAmount || 0}"></div>
        </div>
        <div class="form-group">
            <label>Late Fine (₹) ${fee.isOverdue ? `— suggested ₹${fee.suggestedLateFine} (${fee.daysOverdue} days overdue)` : ''}</label>
            <div style="display:flex;gap:8px;">
                <input type="number" id="editFeeLateFine" value="${fee.lateFineAmount || 0}" style="flex:1;">
                ${fee.isOverdue ? `<button class="btn btn-secondary btn-sm" type="button" onclick="document.getElementById('editFeeLateFine').value=${fee.suggestedLateFine}">Use Suggested</button>` : ''}
            </div>
        </div>
        <p style="font-size:13px;color:var(--gold);margin-top:8px;">Net Payable will recalculate automatically after saving.</p>
    `, async () => {
        const amount = document.getElementById('editFeeAmount').value;
        const dueDate = document.getElementById('editFeeDueDate').value;
        const discountAmount = document.getElementById('editFeeDiscount').value;
        const scholarshipAmount = document.getElementById('editFeeScholarship').value;
        const lateFineAmount = document.getElementById('editFeeLateFine').value;

        const editResult = await apiCall(`/fees/${id}`, { method: 'PUT', body: JSON.stringify({ amount, dueDate, discountAmount, scholarshipAmount }) });
        if (!editResult || !editResult.success) { showToast('Error', editResult?.message || 'Failed to update fee', 'error'); return; }
        await apiCall(`/fees/${id}/apply-late-fine`, { method: 'PUT', body: JSON.stringify({ lateFineAmount }) });

        showToast('Success', 'Fee record updated', 'success');
        closeModal();
        loadFees();
    });
}

async function markFeePaidModal(id) {
    showModal('Mark Fee as Paid', 'Record how this payment was made', `
        <div class="form-group"><label>Payment Method</label>
            <select id="payMethod">
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                <option value="upi">UPI</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank Transfer</option>
            </select>
        </div>
        <div class="form-group"><label>Transaction ID (for online/UPI)</label><input type="text" id="payTxnId" placeholder="optional"></div>
    `, async () => {
        const paymentMethod = document.getElementById('payMethod').value;
        const transactionId = document.getElementById('payTxnId').value.trim();
        const result = await apiCall(`/fees/${id}/mark-paid`, { method: 'PUT', body: JSON.stringify({ paymentMethod, transactionId }) });
        if (!result || !result.success) { showToast('Error', result?.message || 'Failed to mark fee as paid', 'error'); return; }
        showToast('Success', `Fee marked as paid — receipt ${result.data.receiptNumber}`, 'success');
        closeModal();
        loadFees();
    });
}

async function deleteFee(id) {
    if (!confirm('Delete this unpaid fee record?')) return;
    const result = await apiCall(`/fees/${id}`, { method: 'DELETE' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to delete fee record', 'error'); return; }
    showToast('Success', 'Fee record deleted', 'success');
    loadFees();
}

function downloadFeeReceipt(id) {
    fetch(`${API_BASE}/fees/${id}/receipt`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
            window.URL.revokeObjectURL(url);
        })
        .catch(() => showToast('Error', 'Failed to download receipt', 'error'));
}

async function remindOneFee(id) {
    const result = await apiCall(`/fees/${id}/remind`, { method: 'POST' });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send reminder', 'error'); return; }
    showToast(result.data.emailSent ? 'Success' : 'Note', result.message, result.data.emailSent ? 'success' : 'warning');
}

async function remindAllOverdue() {
    if (!confirm('Send a reminder email to every student with an overdue fee?')) return;
    const result = await apiCall('/fees/remind-bulk', { method: 'POST', body: JSON.stringify({ includeUpcoming: false }) });
    if (!result || !result.success) { showToast('Error', result?.message || 'Failed to send reminders', 'error'); return; }
    showToast('Success', result.message, 'success');
}

