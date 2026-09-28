/**
 * utils/feeReceipt.js
 *
 * Streams a branded PDF payment receipt for a paid fee record — same
 * pdfkit pattern as controllers/student/resultController.js's result PDF,
 * so it looks consistent with the rest of the portal's generated documents.
 */

"use strict";

const PDFDocument = require("pdfkit");

const GOLD = "#c9a84c";
const INK  = "#333333";
const MUTED = "#777777";

function money(n) {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * @param {object} fee - fee record (with computed netPayable already attached)
 * @param {object} student - the student the fee belongs to
 * @param {import('express').Response} res
 */
function streamFeeReceipt(fee, student, res) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=receipt-${fee.receiptNumber || fee._id}.pdf`);
  doc.pipe(res);

  // Header
  doc.fontSize(24).fillColor(GOLD).text("Chawla Classes", { align: "center" });
  doc.fontSize(14).fillColor(MUTED).text("Fee Payment Receipt", { align: "center" });
  doc.moveDown();

  doc.fontSize(11).fillColor(INK)
     .text(`Receipt No: ${fee.receiptNumber || "N/A"}`, { continued: true })
     .text(`   Date: ${new Date(fee.paidDate || Date.now()).toLocaleDateString("en-IN")}`, { align: "right" });
  doc.moveDown();

  // Student info
  doc.fontSize(12).fillColor(GOLD).text("Student Details", { underline: true });
  doc.fontSize(11).fillColor(INK);
  doc.text(`Name: ${student?.name || "N/A"}`);
  doc.text(`Class: ${student?.className || student?.classId || "N/A"}`);
  if (student?.rollNumber) doc.text(`Roll No: ${student.rollNumber}`);
  doc.moveDown();

  // Fee breakdown
  doc.fontSize(12).fillColor(GOLD).text("Fee Details", { underline: true });
  doc.fontSize(11).fillColor(INK);
  doc.text(`Description: ${fee.title || fee.description || "Fee Payment"}`);
  if (fee.totalInstallments > 1) {
    doc.text(`Installment: ${fee.installmentNumber} of ${fee.totalInstallments}`);
  }
  doc.text(`Due Date: ${new Date(fee.dueDate).toLocaleDateString("en-IN")}`);
  doc.moveDown(0.5);

  const rows = [["Base Amount", money(fee.amount)]];
  if (fee.discountAmount > 0) rows.push([`Discount${fee.discountReason ? ` (${fee.discountReason})` : ""}`, `- ${money(fee.discountAmount)}`]);
  if (fee.scholarshipAmount > 0) rows.push([`Scholarship${fee.scholarshipReason ? ` (${fee.scholarshipReason})` : ""}`, `- ${money(fee.scholarshipAmount)}`]);
  if (fee.lateFineAmount > 0) rows.push(["Late Fine", `+ ${money(fee.lateFineAmount)}`]);

  rows.forEach(([label, value]) => {
    doc.text(label, { continued: true });
    doc.text(value, { align: "right" });
  });

  doc.moveDown(0.3);
  doc.fontSize(13).fillColor(GOLD)
     .text("Amount Paid", { continued: true })
     .text(money(fee.netPayable), { align: "right" });
  doc.moveDown();

  // Payment info
  doc.fontSize(11).fillColor(INK);
  doc.text(`Payment Method: ${(fee.paymentMethod || "cash").toUpperCase()}`);
  if (fee.transactionId) doc.text(`Transaction ID: ${fee.transactionId}`);
  doc.moveDown();

  // Footer
  doc.fontSize(10).fillColor(MUTED)
     .text("This is a system-generated receipt from Chawla Classes.", { align: "center" });
  doc.text(new Date().toLocaleString("en-IN"), { align: "center" });

  doc.end();
}

module.exports = { streamFeeReceipt };
