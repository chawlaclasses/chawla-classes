/**
 * services/feeCalc.js
 *
 * Shared "computed fields" for a fee record — net payable after
 * discount/scholarship/late fine, overdue status, and a suggested late
 * fine. Used by both the admin and student fee routes so the numbers
 * shown to each side can never drift apart.
 */

"use strict";

const LATE_FINE_PER_DAY = 10;   // ₹ per day overdue, used only as a *suggestion*
const LATE_FINE_CAP = 500;      // admin can still override with any amount

function feeWithComputed(fee) {
  const netPayable = Math.max(0,
    (Number(fee.amount) || 0)
    - (Number(fee.discountAmount) || 0)
    - (Number(fee.scholarshipAmount) || 0)
    + (Number(fee.lateFineAmount) || 0)
  );
  const isOverdue = fee.status === 'Pending' && new Date(fee.dueDate) < new Date();
  const daysOverdue = isOverdue ? Math.floor((Date.now() - new Date(fee.dueDate)) / 86400000) : 0;
  const suggestedLateFine = isOverdue ? Math.min(daysOverdue * LATE_FINE_PER_DAY, LATE_FINE_CAP) : 0;

  return { ...fee, netPayable, isOverdue, daysOverdue, suggestedLateFine };
}

module.exports = { feeWithComputed, LATE_FINE_PER_DAY, LATE_FINE_CAP };
