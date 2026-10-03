// public/admin/js/campaign-selection.js
//
// Marketing -> Quick Send -> Target By "Custom Recipient Selection".
//
// The admin ticks exactly who should receive a campaign:
//   * three groups  - Students, Enquiries, Admissions (checkbox chips)
//   * a searchable, paginated table - checkbox, Name, Phone, Email, Source Type
//   * Select All / Unselect All / per-row / per-page checkboxes
//   * a live "Selected: N" counter (with per-group and reachability breakdown)
//   * Preview Recipients (server-validated) before sending
//
// Backend (routes/admin/marketing-campaigns.js, services/marketingSelection.js):
//   GET  /api/admin/marketing/campaigns/targets/recipients   -> the picker's directory
//   POST /api/admin/marketing/campaigns/targets/preview      -> { targetType:'selection', selection }
//   POST /api/admin/marketing/campaigns/send                 -> { ..., targetType:'selection', selection }
//
// What travels over the wire is only REFERENCES, never contact details:
//   selection = { recipients: [ { source: 'students'|'enquiries'|'admissions', id: '<uuid>' }, ... ] }
// The server looks every id up again, so what is previewed/sent is always
// what really exists in the database.
//
// marketing.js calls into this file (crsRender, crsPreview, crsValidate,
// crsPayload, crsSelectedCount, crsReset). Classic global script (not an ES
// module), like the rest of public/admin/js - inline onclick handlers need
// these functions in global scope.

const CRS_SOURCES = [
    { id: 'students', label: 'Students' },
    { id: 'enquiries', label: 'Enquiries' },
    { id: 'admissions', label: 'Admissions' },
];
const CRS_PAGE_SIZES = [10, 25, 50, 100];
const CRS_MSG_NONE = 'Please select at least one recipient.';

const CRS = {
    rows: [],                 // the whole directory: { key, source, sourceLabel, id, name, phone, email, status }
    byKey: new Map(),
    counts: {},               // total per source, from the server
    max: 1000,                // per-campaign cap, from the server
    loaded: false,
    loading: false,
    error: '',
    selected: new Set(),      // keys ("students:<id>") - survives filter / page / group changes
    groups: new Set(CRS_SOURCES.map(s => s.id)),
    search: '',
    page: 1,
    limit: 25,
    filtered: [],             // rows matching groups + search (all pages)
    previewing: false,
    seq: { load: 0, preview: 0 },
    timer: null,
};

// ============================================================
// Small helpers
// ============================================================
function crsEl(id) { return document.getElementById(id); }

// escapeHtml() (ui-helpers.js) is for text nodes; attribute values also need quotes escaped.
function crsAttr(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function crsSelectedCount() { return CRS.selected.size; }

// Returns '' when OK, otherwise a user-friendly message. Mirrors the server's
// checks (the server is still the real guard).
function crsValidate() {
    const n = CRS.selected.size;
    if (n === 0) return CRS_MSG_NONE;
    if (n > CRS.max) return `You selected ${n} recipients, but a campaign can reach at most ${CRS.max}. Please unselect ${n - CRS.max}.`;
    return '';
}

// The API payload for preview + send.
function crsPayload() {
    const recipients = [];
    CRS.selected.forEach(key => {
        const r = CRS.byKey.get(key);
        if (r) recipients.push({ source: r.source, id: r.id });
    });
    return { recipients };
}

function crsStats() {
    const bySource = {};
    CRS_SOURCES.forEach(s => { bySource[s.id] = 0; });
    let phone = 0;
    let email = 0;
    CRS.selected.forEach(key => {
        const r = CRS.byKey.get(key);
        if (!r) return;
        bySource[r.source] += 1;
        if (r.phone) phone += 1;
        if (r.email) email += 1;
    });
    return { bySource, phone, email };
}

function crsReset() {
    CRS.selected.clear();
    CRS.search = '';
    CRS.page = 1;
    CRS.groups = new Set(CRS_SOURCES.map(s => s.id));
    crsHidePreview();
    crsClearMessage();
}

// ============================================================
// Styles (injected once; same look as the New Campaign recipient table)
// ============================================================
function crsInjectStyles() {
    if (document.getElementById('crsStyles')) return;
    const style = document.createElement('style');
    style.id = 'crsStyles';
    style.textContent = `
.crs{margin:4px 0 8px}
.crs-label{display:block;font-size:12px;font-weight:600;color:var(--white);margin-bottom:6px}
.crs-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.crs-chip{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border:1px solid var(--card-border);border-radius:999px;cursor:pointer;background:rgba(255,255,255,.02);font-size:13px;color:var(--text);user-select:none;transition:border-color .15s,background .15s}
.crs-chip:hover{border-color:rgba(245,166,35,.5)}
.crs-chip.on{border-color:var(--gold);background:var(--gold-glow);color:var(--white)}
.crs-chip input{accent-color:var(--gold);width:16px;height:16px;cursor:pointer}
.crs-pill{font-size:11px;color:var(--muted);background:rgba(255,255,255,.06);padding:1px 8px;border-radius:999px}
.crs-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.crs-input{flex:1 1 220px;min-width:180px;background:var(--input-bg);border:1px solid var(--card-border);color:var(--text);padding:8px 12px;border-radius:8px;font-size:13px;outline:none}
.crs-input:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-glow)}
.crs-counter{font-size:12.5px;color:var(--muted);margin:6px 0;line-height:1.6}
.crs-counter strong{color:var(--gold);font-size:14px}
.crs-counter.warn,.crs-counter.warn strong{color:#f87171}
.crs-msg{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.4);color:#fca5a5;border-radius:8px;padding:8px 12px;font-size:12.5px;margin:6px 0}
.crs-tablewrap{overflow:auto;max-height:420px;border:1px solid var(--card-border);border-radius:8px}
.crs-table{width:100%;border-collapse:collapse;min-width:560px}
.crs-table th,.crs-table td{padding:8px 12px;font-size:13px;text-align:left;border-bottom:1px solid var(--card-border);white-space:nowrap}
.crs-table th{background:var(--card-bg);color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0;z-index:1}
.crs-table tr:last-child td{border-bottom:0}
.crs-table tr.sel td{background:rgba(245,166,35,.07)}
.crs-table input[type=checkbox]{accent-color:var(--gold);width:16px;height:16px;cursor:pointer}
.crs-name{color:var(--white);font-weight:600}
.crs-dash,.crs-dim{color:var(--muted)}
.crs-empty{text-align:center;color:var(--muted);padding:22px 12px !important;white-space:normal !important}
.crs-src{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--card-border);color:var(--muted)}
.crs-src-students{color:#34d399;border-color:rgba(52,211,153,.4)}
.crs-src-enquiries{color:#60a5fa;border-color:rgba(96,165,250,.4)}
.crs-src-admissions{color:#fbbf24;border-color:rgba(251,191,36,.4)}
.crs-pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:12.5px;color:var(--muted)}
.crs-pager .crs-spacer{flex:1}
.crs-pager select{background:var(--input-bg);color:var(--text);border:1px solid var(--card-border);border-radius:6px;padding:4px 6px;font-size:12px}
.crs-preview{margin-top:10px;border:1px solid var(--card-border);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--text)}
.crs-prev-notes,.crs-prev-reach{font-size:12px;color:var(--muted)}
.crs-prev-list{list-style:none;margin:8px 0 0;padding:0;max-height:180px;overflow:auto;display:grid;gap:4px}
.crs-prev-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px}
`;
    document.head.appendChild(style);
}

// ============================================================
// Render
// ============================================================
// Called by marketing.js when Target By = "Custom Recipient Selection".
function crsRender() {
    const wrap = crsEl('campSelectionWrap');
    if (!wrap) return;
    crsInjectStyles();

    wrap.innerHTML = `
        <div class="crs">
            <span class="crs-label">Recipient groups <span class="crs-dim" style="font-weight:400;">(untick a group to hide it from the list - your ticks are kept)</span></span>
            <div class="crs-chips" id="crsGroups">
                ${CRS_SOURCES.map(s => `
                    <label class="crs-chip" data-chip="${s.id}">
                        <input type="checkbox" data-group="${s.id}"> ${s.label}
                        <span class="crs-pill" data-pill="${s.id}">0/0</span>
                    </label>`).join('')}
            </div>

            <div class="crs-toolbar">
                <input type="search" id="crsSearch" class="crs-input" placeholder="Search by name, phone or email…" autocomplete="off" aria-label="Search recipients" value="${crsAttr(CRS.search)}">
                <button type="button" class="btn btn-secondary btn-sm" onclick="crsSelectAll()" title="Selects everyone matching the current groups and search, on every page"><i class="fas fa-check-double"></i> Select All</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="crsUnselectAll()" title="Clears the whole selection"><i class="fas fa-xmark"></i> Unselect All</button>
            </div>

            <div class="crs-counter" id="crsCounter" aria-live="polite"></div>
            <div class="crs-msg" id="crsMsg" role="alert" style="display:none;"></div>

            <div class="crs-tablewrap">
                <table class="crs-table">
                    <thead>
                        <tr>
                            <th style="width:36px;"><input type="checkbox" id="crsPageToggle" aria-label="Select everyone on this page"></th>
                            <th>Name</th><th>Phone</th><th>Email</th><th>Source Type</th>
                        </tr>
                    </thead>
                    <tbody id="crsBody"></tbody>
                </table>
            </div>
            <div class="crs-pager" id="crsPager"></div>
            <div class="crs-preview" id="crsPreviewBox" style="display:none;"></div>
        </div>
    `;

    // Search (debounced so typing stays smooth on long lists)
    crsEl('crsSearch').addEventListener('input', (e) => {
        clearTimeout(CRS.timer);
        const value = e.target.value;
        CRS.timer = setTimeout(() => { CRS.search = value; CRS.page = 1; crsRefresh(); }, 200);
    });
    // Group chips
    crsEl('crsGroups').addEventListener('change', (e) => {
        const input = e.target.closest('input[data-group]');
        if (!input) return;
        if (input.checked) CRS.groups.add(input.dataset.group); else CRS.groups.delete(input.dataset.group);
        CRS.page = 1;
        crsRefresh();
    });
    // Row checkboxes (delegated - rows are re-rendered)
    crsEl('crsBody').addEventListener('change', (e) => {
        const input = e.target.closest('input.crs-row-check');
        if (!input) return;
        if (input.checked) CRS.selected.add(input.dataset.key); else CRS.selected.delete(input.dataset.key);
        input.closest('tr').classList.toggle('sel', input.checked);
        crsSelectionChanged();
    });
    // Header checkbox = this page only
    crsEl('crsPageToggle').addEventListener('change', (e) => {
        crsPageRows().forEach(r => { if (e.target.checked) CRS.selected.add(r.key); else CRS.selected.delete(r.key); });
        crsSelectionChanged();
        crsRenderBody();
    });

    crsRefresh();
    crsLoad(); // always fetch a fresh directory when the picker is shown
}

async function crsLoad() {
    const seq = ++CRS.seq.load;
    CRS.loading = true;
    CRS.error = '';
    crsRefresh();

    const result = await apiCall('/marketing/campaigns/targets/recipients');
    if (seq !== CRS.seq.load) return; // a newer load superseded this one

    CRS.loading = false;
    if (!result || !result.success) {
        CRS.error = result?.message || 'Could not load recipients. Please try again.';
        crsRefresh();
        return;
    }

    CRS.rows = result.data.rows || [];
    CRS.counts = result.data.counts || {};
    CRS.max = result.data.maxSelectable || CRS.max;
    CRS.byKey = new Map(CRS.rows.map(r => [r.key, r]));
    CRS.loaded = true;
    // forget ticks for people deleted/deactivated since the last load
    Array.from(CRS.selected).forEach(k => { if (!CRS.byKey.has(k)) CRS.selected.delete(k); });
    crsRefresh();
}

// ============================================================
// Filtering + drawing
// ============================================================
function crsApplyFilters() {
    const q = CRS.search.trim().toLowerCase();
    // Treat the query as a phone fragment only when it LOOKS like a number,
    // so "Student 7" is a name search and not "any number containing a 7".
    const qDigits = /^[\d\s+\-()]+$/.test(q) ? q.replace(/\D/g, '') : '';

    CRS.filtered = CRS.rows.filter(r => {
        if (!CRS.groups.has(r.source)) return false;
        if (!q) return true;
        return (r.name || '').toLowerCase().includes(q)
            || (r.email || '').toLowerCase().includes(q)
            || (r.phone || '').toLowerCase().includes(q)
            || (qDigits && (r.phone || '').replace(/\D/g, '').includes(qDigits));
    });

    const pages = Math.max(Math.ceil(CRS.filtered.length / CRS.limit), 1);
    CRS.page = Math.min(Math.max(CRS.page, 1), pages);
}

function crsPageRows() {
    const start = (CRS.page - 1) * CRS.limit;
    return CRS.filtered.slice(start, start + CRS.limit);
}

function crsRefresh() {
    if (!crsEl('crsBody')) return; // picker isn't on screen
    crsApplyFilters();
    crsRenderGroups();
    crsRenderCounter();
    crsRenderBody();
    crsRenderPager();
}

function crsRenderGroups() {
    const stats = crsStats();
    CRS_SOURCES.forEach(s => {
        const on = CRS.groups.has(s.id);
        const chip = document.querySelector(`[data-chip="${s.id}"]`);
        const box = document.querySelector(`input[data-group="${s.id}"]`);
        const pill = document.querySelector(`[data-pill="${s.id}"]`);
        if (chip) chip.classList.toggle('on', on);
        if (box) box.checked = on;
        if (pill) pill.textContent = `${stats.bySource[s.id]}/${CRS.counts[s.id] || 0}`;
    });
}

function crsRenderCounter() {
    const el = crsEl('crsCounter');
    if (!el) return;
    const stats = crsStats();
    const n = CRS.selected.size;
    el.classList.toggle('warn', n > CRS.max);
    el.innerHTML = `Selected: <strong>${n}</strong> of ${CRS.rows.length}`
        + (n ? ` &middot; ${CRS_SOURCES.map(s => `${s.label} ${stats.bySource[s.id]}`).join(' &middot; ')}` : '')
        + (n ? ` &middot; ${stats.phone} with phone &middot; ${stats.email} with email` : '')
        + (n > CRS.max ? ` &middot; <strong>max ${CRS.max} per campaign</strong>` : '');
}

function crsRenderBody() {
    const body = crsEl('crsBody');
    if (!body) return;

    if (CRS.loading && !CRS.loaded) {
        body.innerHTML = `<tr><td colspan="5" class="crs-empty">Loading recipients…</td></tr>`;
    } else if (CRS.error) {
        body.innerHTML = `<tr><td colspan="5" class="crs-empty">${escapeHtml(CRS.error)} <button type="button" class="btn btn-secondary btn-sm" onclick="crsLoad()">Retry</button></td></tr>`;
    } else if (CRS.filtered.length === 0) {
        const msg = CRS.groups.size === 0 ? 'Choose at least one recipient group above.'
            : CRS.search.trim() ? `No recipients match “${escapeHtml(CRS.search.trim())}”.`
            : 'No recipients found in the selected groups.';
        body.innerHTML = `<tr><td colspan="5" class="crs-empty">${msg}</td></tr>`;
    } else {
        body.innerHTML = crsPageRows().map(r => {
            const on = CRS.selected.has(r.key);
            return `
                <tr class="${on ? 'sel' : ''}">
                    <td><input type="checkbox" class="crs-row-check" data-key="${crsAttr(r.key)}" ${on ? 'checked' : ''} aria-label="Select ${crsAttr(r.name)}"></td>
                    <td class="crs-name">${escapeHtml(r.name)}</td>
                    <td>${r.phone ? escapeHtml(r.phone) : '<span class="crs-dash" title="No phone number">—</span>'}</td>
                    <td>${r.email ? escapeHtml(r.email) : '<span class="crs-dash" title="No email address">—</span>'}</td>
                    <td><span class="crs-src crs-src-${crsAttr(r.source)}">${escapeHtml(r.sourceLabel)}</span></td>
                </tr>`;
        }).join('');
    }
    crsSyncPageToggle();
}

function crsRenderPager() {
    const el = crsEl('crsPager');
    if (!el) return;
    const total = CRS.filtered.length;
    const pages = Math.max(Math.ceil(total / CRS.limit), 1);
    const from = total === 0 ? 0 : (CRS.page - 1) * CRS.limit + 1;
    const to = Math.min(CRS.page * CRS.limit, total);
    el.innerHTML = `
        <span>${total === 0 ? 'No matches' : `Showing ${from}–${to} of ${total}`}</span>
        <span class="crs-spacer"></span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="crsGoPage(${CRS.page - 1})" ${CRS.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span>Page ${CRS.page} of ${pages}</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="crsGoPage(${CRS.page + 1})" ${CRS.page >= pages ? 'disabled' : ''}>Next ›</button>
        <select onchange="crsSetLimit(this.value)" aria-label="Rows per page">
            ${CRS_PAGE_SIZES.map(n => `<option value="${n}" ${n === CRS.limit ? 'selected' : ''}>${n} / page</option>`).join('')}
        </select>`;
}

// Header checkbox reflects the current page: all / some / none ticked.
function crsSyncPageToggle() {
    const toggle = crsEl('crsPageToggle');
    if (!toggle) return;
    const rows = CRS.loaded ? crsPageRows() : [];
    const ticked = rows.filter(r => CRS.selected.has(r.key)).length;
    toggle.checked = rows.length > 0 && ticked === rows.length;
    toggle.indeterminate = ticked > 0 && ticked < rows.length;
    toggle.disabled = rows.length === 0;
}

// ============================================================
// Actions
// ============================================================
// Any change to who is selected makes an earlier preview stale.
function crsSelectionChanged() {
    crsClearMessage();
    crsHidePreview();
    crsRenderGroups();
    crsRenderCounter();
    crsSyncPageToggle();
}

function crsSelectAll() {
    if (CRS.filtered.length === 0) {
        crsShowMessage('There is nobody to select with the current groups and search.');
        return;
    }
    CRS.filtered.forEach(r => CRS.selected.add(r.key)); // every page, not just the visible one
    crsSelectionChanged();
    crsRenderBody();
}

function crsUnselectAll() {
    CRS.selected.clear();
    crsSelectionChanged();
    crsRenderBody();
}

function crsGoPage(page) {
    CRS.page = page;
    crsRefresh();
}

function crsSetLimit(value) {
    CRS.limit = parseInt(value, 10) || 25;
    CRS.page = 1;
    crsRefresh();
}

// ============================================================
// Messages + preview
// ============================================================
function crsShowMessage(text) {
    const el = crsEl('crsMsg');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
}

function crsClearMessage() {
    const el = crsEl('crsMsg');
    if (el) el.style.display = 'none';
}

function crsHidePreview() {
    CRS.seq.preview += 1; // an in-flight preview no longer matches the selection
    const box = crsEl('crsPreviewBox');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    const resultEl = crsEl('campPreviewResult');
    if (resultEl) resultEl.textContent = '';
}

// "Preview Recipients" for a custom selection. The server re-resolves every
// id, so this shows who would REALLY be messaged (duplicates merged, deleted
// people dropped) - not just a count of ticked boxes.
async function crsPreview() {
    const resultEl = crsEl('campPreviewResult');

    const problem = crsValidate();
    if (problem) {
        crsShowMessage(problem);
        crsHidePreview();
        return;
    }
    crsClearMessage();
    if (CRS.previewing) return;

    CRS.previewing = true;
    const seq = ++CRS.seq.preview;
    if (resultEl) resultEl.textContent = 'Loading…';

    const result = await apiCall('/marketing/campaigns/targets/preview', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'selection', selection: crsPayload() }),
    });
    CRS.previewing = false;
    if (seq !== CRS.seq.preview) return; // selection changed while we waited

    if (!result || !result.success) {
        if (resultEl) resultEl.textContent = '';
        crsShowMessage(result?.message || 'Failed to preview. Please try again.');
        return;
    }
    if (!result.data.valid) { // e.g. nothing selected / everyone deleted / over the cap
        if (resultEl) resultEl.textContent = '';
        crsShowMessage(result.data.message || CRS_MSG_NONE);
        return;
    }
    if (resultEl) resultEl.textContent = `${result.data.count} recipient(s) ready.`;
    crsRenderPreview(result.data);
}

function crsRenderPreview(data) {
    const box = crsEl('crsPreviewBox');
    if (!box) return;
    const s = data.summary || {};
    const notes = [];
    if (s.duplicates) notes.push(`${s.duplicates} duplicate number/email merged`);
    if (s.missing) notes.push(`${s.missing} no longer exist — skipped`);
    if (s.unreachable) notes.push(`${s.unreachable} have no phone or email — skipped`);
    if (s.malformed) notes.push(`${s.malformed} invalid — skipped`);

    box.innerHTML = `
        <div><strong>${data.count}</strong> recipient(s) will receive this campaign
            ${notes.length ? `<span class="crs-prev-notes">(${escapeHtml(notes.join('; '))})</span>` : ''}</div>
        <div class="crs-prev-reach">${(s.reach && s.reach.phone) || 0} with a phone number &middot; ${(s.reach && s.reach.email) || 0} with an email address</div>
        <ul class="crs-prev-list">
            ${data.contacts.map(c => `
                <li>
                    <span class="crs-name">${escapeHtml(c.name || '—')}</span>
                    <span class="crs-src crs-src-${crsAttr(c.source)}">${escapeHtml(c.sourceLabel || '')}</span>
                    <span class="crs-dim">${escapeHtml(c.phone || c.email || '')}</span>
                </li>`).join('')}
        </ul>
        ${data.count > data.contacts.length ? `<div class="crs-prev-notes" style="margin-top:6px;">…and ${data.count - data.contacts.length} more</div>` : ''}
    `;
    box.style.display = 'block';
}
