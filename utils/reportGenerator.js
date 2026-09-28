// utils/reportGenerator.js
"use strict";

const PDFDocument = require('pdfkit');

const BRAND_GOLD = '#c9a84c';
const TEXT_DARK = '#222222';
const TEXT_MUTED = '#666666';
const BORDER_LIGHT = '#dddddd';
const HEADER_BG = '#f4ecd8';

// ── PDF building blocks ──────────────────────────────────────────────────

function createPdfDoc() {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    return { doc, chunks };
}

function finalizePdf(doc, chunks) {
    return new Promise(resolve => {
        // Add page numbers to every buffered page before closing.
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) {
            doc.switchToPage(range.start + i);
            const bottom = doc.page.height - doc.page.margins.bottom + 15;
            doc.fontSize(8).fillColor(TEXT_MUTED)
                .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, bottom, {
                    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
                    align: 'center'
                });
        }
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.end();
    });
}

function renderHeader(doc, { title, subtitle, meta = [] }) {
    doc.fontSize(20).fillColor(BRAND_GOLD).text('Chawla Classes', { align: 'center' });
    doc.fontSize(13).fillColor(TEXT_MUTED).text(title, { align: 'center' });
    if (subtitle) {
        doc.fontSize(10).fillColor(TEXT_MUTED).text(subtitle, { align: 'center' });
    }
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor(TEXT_DARK);
    meta.forEach(line => doc.text(line));
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();

    // A thin rule under the header block
    doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor(BORDER_LIGHT).lineWidth(1).stroke();
    doc.moveDown();
}

function ensureSpace(doc, neededHeight) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + neededHeight > bottom) {
        doc.addPage();
    }
}

function renderSectionTitle(doc, text) {
    ensureSpace(doc, 30);
    doc.fontSize(13).fillColor(BRAND_GOLD).text(text);
    doc.moveDown(0.3);
}

function renderKeyValueGrid(doc, pairs) {
    ensureSpace(doc, pairs.length * 16);
    doc.fontSize(10.5).fillColor(TEXT_DARK);
    pairs.forEach(([label, value]) => {
        doc.text(`${label}: `, { continued: true }).fillColor(TEXT_MUTED).text(`${value}`).fillColor(TEXT_DARK);
    });
    doc.moveDown();
}

// columns: [{ key, label, width }]  rows: [{ key: value, ... }]
function renderTable(doc, { columns, rows, rowHeight = 22 }) {
    const startX = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Normalize widths to fill tableWidth if not all specified
    const totalSpecified = columns.reduce((sum, c) => sum + (c.width || 0), 0);
    const unspecifiedCount = columns.filter(c => !c.width).length;
    const remaining = Math.max(0, tableWidth - totalSpecified);
    const autoWidth = unspecifiedCount ? remaining / unspecifiedCount : 0;
    const widths = columns.map(c => c.width || autoWidth);

    function drawHeaderRow() {
        ensureSpace(doc, rowHeight + 4);
        const y = doc.y;
        doc.rect(startX, y, tableWidth, rowHeight).fill(HEADER_BG);
        doc.fillColor(TEXT_DARK).fontSize(9.5);
        let x = startX;
        columns.forEach((col, i) => {
            doc.text(col.label, x + 4, y + 6, { width: widths[i] - 8, align: col.align || 'left' });
            x += widths[i];
        });
        doc.y = y + rowHeight;
    }

    drawHeaderRow();

    doc.fontSize(9.5).fillColor(TEXT_DARK);
    rows.forEach((row, rIdx) => {
        ensureSpace(doc, rowHeight);
        // Re-draw header on new page for continuity
        if (doc.y === doc.page.margins.top) {
            drawHeaderRow();
        }
        const y = doc.y;
        if (rIdx % 2 === 1) {
            doc.rect(startX, y, tableWidth, rowHeight).fill('#fafafa');
            doc.fillColor(TEXT_DARK);
        }
        let x = startX;
        columns.forEach((col, i) => {
            const val = row[col.key] === undefined || row[col.key] === null ? '' : String(row[col.key]);
            doc.text(val, x + 4, y + 6, { width: widths[i] - 8, align: col.align || 'left' });
            x += widths[i];
        });
        doc.y = y + rowHeight;
    });

    // Border around the whole table
    doc.moveDown();
}

// ── CSV ("Excel") export ─────────────────────────────────────────────────

function escapeCsvValue(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// columns: [{ key, label }]  rows: [{ key: value, ... }]
function toCSV(columns, rows) {
    const headerLine = columns.map(c => escapeCsvValue(c.label)).join(',');
    const lines = rows.map(row => columns.map(c => escapeCsvValue(row[c.key])).join(','));
    // Leading BOM so Excel opens UTF-8 (₹, é, etc.) correctly instead of mangling it.
    return '\uFEFF' + [headerLine, ...lines].join('\r\n');
}

// ── Express response helpers ─────────────────────────────────────────────

function sendPdf(res, buffer, filename) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
}

function sendCsv(res, csvString, filename) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);
}

module.exports = {
    createPdfDoc,
    finalizePdf,
    renderHeader,
    renderSectionTitle,
    renderKeyValueGrid,
    renderTable,
    ensureSpace,
    toCSV,
    sendPdf,
    sendCsv
};