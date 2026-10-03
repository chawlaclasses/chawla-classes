// public/admin/js/campaign-recipients.js
//
// Marketing -> "New Campaign" and "Campaign History" tabs (rendered inside
// marketing.js's #marketingViewWrap).
//
// Recipient Selection System: pick WHO (groups + class filters + hand-picked
// rows from a searchable/paginated table), write the message, see the exact
// preview and the cost, confirm, send. Channel-agnostic — the same screen
// drives SMS today; WhatsApp/Email work through the same backend engine and
// Push can plug in later (services/campaignChannels.js).
//
// Backend:  /api/admin/marketing/recipients/*  (meta, list, pool, estimate)
//           /api/admin/marketing/campaigns/send-selected, /campaign-history
//
// Selection model (kept small so it can be sent to the server as-is):
//   effective = (autoKeys - excluded) U (included ∩ pool)
//   autoKeys  = everyone in the ticked groups (except "Custom Selection")
//   included  = people ticked by hand        excluded = people un-ticked
// The server evaluates the same formula (services/recipientEngine.js) and its
// result is what is actually sent to.
//
// Classic global script (not an ES module), like the rest of public/admin/js.

const RC_TEMPLATE_ADMISSIONS = [
    'Dear Parent,', '',
    'Admissions Open at Chawla Classes.', '',
    'Maths (9th-10th)', 'Accounts (11th-12th)', '',
    'Call:', '9717914003', '9210660809', '',
    'www.chawlaclasses.in',
].join('\n');

const RC_KIND_LABELS = { student: 'Student', parent: 'Parent', teacher: 'Teacher', enquiry: 'Enquiry' };
const RC_PAGE_SIZES = [10, 25, 50, 100];

const RC = {
    meta: null,
    title: '',
    message: '',
    channel: 'sms',
    groups: new Set(),
    classKeys: new Set(),
    poolKeys: new Set(),
    autoKeys: new Set(),
    included: new Set(),
    excluded: new Set(),
    table: { rows: [], total: 0, page: 1, pages: 1, limit: 25, matchingKeys: [], loading: false, error: '' },
    filters: { search: '', status: '', classFilter: '' },
    estimate: null,
    estimating: false,
    sending: false,
    attempted: false,
    lastResult: null,
    seq: { list: 0, pool: 0, est: 0 },
    timers: { search: null, est: null },
};

const RCH = { page: 1, limit: 10, search: '', rows: [], total: 0, pages: 1, loading: false, error: '', timer: null, seq: 0 };

// ============================================================
// Small helpers
// ============================================================
function rcMoney(n) { return `₹${Number(n || 0).toFixed(2)}`; }
function rcEl(id) { return document.getElementById(id); }
function rcChannel() { return (RC.meta?.channels || []).find(c => c.id === RC.channel) || { id: 'sms', label: 'SMS' }; }

// Mirrors the server's normalizeNumber() — display hint only; the server decides.
function rcPhoneLooksValid(p) {
    const d = String(p || '').replace(/\D/g, '');
    return d.length === 10 || (d.length === 11 && d.startsWith('0')) || (d.length === 12 && d.startsWith('91'));
}

function rcIsSelected(key) {
    return (RC.autoKeys.has(key) && !RC.excluded.has(key)) || (RC.included.has(key) && RC.poolKeys.has(key));
}

function rcSelectedCount() {
    let n = 0;
    RC.autoKeys.forEach(k => { if (!RC.excluded.has(k)) n++; });
    RC.included.forEach(k => { if (!RC.autoKeys.has(k) && RC.poolKeys.has(k)) n++; });
    return n;
}

function rcSetSelected(key, on) {
    if (on) {
        if (RC.autoKeys.has(key)) RC.excluded.delete(key); else RC.included.add(key);
    } else {
        RC.included.delete(key);
        if (RC.autoKeys.has(key)) RC.excluded.add(key);
    }
}

function rcSelectionPayload() {
    return {
        groups: Array.from(RC.groups),
        classKeys: Array.from(RC.classKeys),
        included: Array.from(RC.included),
        excluded: Array.from(RC.excluded),
    };
}

// Same placeholder rules as services/campaignEngine.js renderMessage()
function rcRenderTemplate(template, r) {
    return String(template || '').replace(/\{\{?\s*(name|student|class)\s*\}?\}/gi, (_m, key) => {
        switch (key.toLowerCase()) {
            case 'name': return r.name || '';
            case 'student': return r.studentName || r.name || '';
            default: return r.className || '';
        }
    });
}

function rcSampleRecipient() {
    if (RC.estimate?.sample) return RC.estimate.sample;
    const first = RC.table.rows.find(r => rcIsSelected(r.key)) || RC.table.rows[0];
    return first ? { name: first.name, studentName: first.name, className: first.className } : { name: 'Student Name', studentName: 'Student Name', className: 'Class 10' };
}

function rcStatusClass(status) {
    switch ((status || '').toLowerCase()) {
        case 'active': case 'converted': return 'ok';
        case 'new': return 'info';
        case 'contacted': case 'fee due': return 'warn';
        default: return 'muted';
    }
}

function rcInjectStyles() {
    if (document.getElementById('rcStyles')) return;
    const style = document.createElement('style');
    style.id = 'rcStyles';
    style.textContent = `
.rc{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(320px,1fr);gap:16px;align-items:start}
.rc-side{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow-y:auto;padding-right:2px}
@media(max-width:1100px){.rc{grid-template-columns:1fr}.rc-side{position:static;max-height:none}}
.rc-card{background:var(--card-bg);border:1px solid var(--card-border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px}
.rc-card h3{font-size:14px;color:var(--white);display:flex;align-items:center;gap:10px;margin:0 0 12px}
.rc-step{width:22px;height:22px;border-radius:50%;background:var(--gold-glow);color:var(--gold);font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:none}
.rc-hint{font-size:11.5px;color:var(--muted);margin-top:6px;line-height:1.45}
.rc-input,.rc-select,.rc-textarea{width:100%;background:var(--input-bg);border:1px solid var(--card-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:13px;outline:none}
.rc-input:focus,.rc-select:focus,.rc-textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-glow)}
.rc-textarea{resize:vertical;min-height:150px;line-height:1.5;font-family:inherit}
.rc-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:560px){.rc-row{grid-template-columns:1fr}}
.rc-label{display:block;font-size:12px;font-weight:600;color:var(--white);margin-bottom:4px}
.rc-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:8px}
.rc-check{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--card-border);border-radius:8px;cursor:pointer;background:rgba(255,255,255,.02);font-size:13px;color:var(--text);transition:border-color .15s,background .15s;user-select:none}
.rc-check:hover{border-color:rgba(245,166,35,.5)}
.rc-check.on{border-color:var(--gold);background:var(--gold-glow);color:var(--white)}
.rc-check input{accent-color:var(--gold);width:16px;height:16px;flex:none;cursor:pointer}
.rc-check .rc-pill{margin-left:auto;font-size:11px;color:var(--muted);background:rgba(255,255,255,.06);padding:1px 8px;border-radius:999px}
.rc-chips{display:flex;flex-wrap:wrap;gap:8px}
.rc-chips .rc-check{padding:7px 14px;border-radius:999px}
.rc-toolbar{display:grid;grid-template-columns:minmax(180px,1.4fr) 1fr 1fr;gap:10px;margin-bottom:10px}
@media(max-width:700px){.rc-toolbar{grid-template-columns:1fr}}
.rc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.rc-actions .rc-spacer{flex:1}
.rc-btn{border:1px solid var(--card-border);background:var(--card-bg);color:var(--white);border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.rc-btn:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.rc-btn:disabled{opacity:.45;cursor:not-allowed}
.rc-btn.gold{background:linear-gradient(135deg,var(--gold),var(--gold-dim));border-color:transparent;color:#1a1204}
.rc-btn.gold:hover:not(:disabled){color:#1a1204;filter:brightness(1.07)}
.rc-btn.big{padding:12px 18px;font-size:14px;width:100%;justify-content:center;border-radius:10px}
.rc-selected{background:var(--gold-glow);color:var(--gold);font-weight:700;font-size:13px;padding:6px 14px;border-radius:999px;white-space:nowrap}
.rc-tablewrap{overflow-x:auto;border:1px solid var(--card-border);border-radius:8px;position:relative}
.rc-table{width:100%;border-collapse:collapse;min-width:680px}
.rc-table th,.rc-table td{padding:9px 12px;font-size:13px;text-align:left;border-bottom:1px solid var(--card-border);white-space:nowrap}
.rc-table th{background:rgba(255,255,255,.04);color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0}
.rc-table tr:last-child td{border-bottom:0}
.rc-table tr.sel td{background:rgba(245,166,35,.07)}
.rc-table input[type=checkbox]{accent-color:var(--gold);width:16px;height:16px;cursor:pointer}
.rc-table .rc-name{color:var(--white);font-weight:600}
.rc-table .rc-kind{display:inline-block;margin-left:6px;font-size:10px;color:var(--muted);border:1px solid var(--card-border);border-radius:4px;padding:0 5px;vertical-align:middle}
.rc-table .rc-bad{color:#f87171}
.rc-table .rc-dash{color:var(--muted)}
.rc-loading{opacity:.45;pointer-events:none;transition:opacity .15s}
.rc-overlay-spin{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.rc-spin{width:22px;height:22px;border:3px solid rgba(255,255,255,.18);border-top-color:var(--gold);border-radius:50%;animation:rcspin .7s linear infinite;display:inline-block}
.rc-spin.sm{width:14px;height:14px;border-width:2px;vertical-align:-2px}
@keyframes rcspin{to{transform:rotate(360deg)}}
.rc-skel td div{height:12px;border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));background-size:200% 100%;animation:rcsh 1.2s infinite}
@keyframes rcsh{to{background-position:-200% 0}}
.rc-badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;margin-right:4px}
.rc-badge.ok{background:rgba(34,197,94,.14);color:#4ade80}
.rc-badge.info{background:rgba(59,130,246,.16);color:#60a5fa}
.rc-badge.warn{background:rgba(245,166,35,.16);color:var(--gold)}
.rc-badge.muted{background:rgba(255,255,255,.07);color:var(--muted)}
.rc-empty{padding:28px 16px;text-align:center;color:var(--muted);font-size:13px}
.rc-empty strong{display:block;color:var(--white);margin-bottom:4px;font-size:14px}
.rc-pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--muted)}
.rc-pager .rc-spacer{flex:1}
.rc-pager select{background:var(--input-bg);color:var(--text);border:1px solid var(--card-border);border-radius:6px;padding:4px 6px;font-size:12px}
.rc-tokens{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
.rc-tokens .rc-btn{padding:3px 9px;font-size:11.5px}
.rc-counter{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--muted);margin-top:6px;flex-wrap:wrap}
.rc-phone{background:rgba(10,22,40,.6);border:1px solid var(--card-border);border-radius:14px;padding:12px}
.rc-phone-head{font-size:11px;color:var(--muted);margin-bottom:8px;display:flex;justify-content:space-between}
.rc-bubble{background:#1f3158;color:#eef2fb;border-radius:14px 14px 14px 3px;padding:12px 14px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-width:100%}
.rc-bubble.empty{color:var(--muted);font-style:italic}
.rc-stats{display:grid;gap:8px}
.rc-stat{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--text);gap:10px}
.rc-stat b{color:var(--white)}
.rc-stat.total{border-top:1px dashed var(--card-border);padding-top:10px;margin-top:2px;font-size:15px}
.rc-stat.total b{color:var(--gold);font-size:20px}
.rc-note{font-size:11.5px;color:var(--muted)}
.rc-check-list{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:5px;font-size:12.5px}
.rc-check-list li{display:flex;gap:8px;align-items:flex-start;color:var(--muted)}
.rc-check-list li.done{color:#4ade80}
.rc-check-list li.bad{color:#f87171}
.rc-result{border-left:3px solid var(--gold)}
.rc-result.fail{border-left-color:#ef4444}
.rc-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);z-index:10050;display:flex;align-items:center;justify-content:center;padding:16px}
.rc-modal{background:var(--navy-mid);border:1px solid var(--card-border);border-radius:var(--radius);padding:26px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.rc-modal h4{color:var(--white);font-size:18px;margin:0 0 12px;display:flex;gap:10px;align-items:center}
.rc-modal p{color:var(--text);font-size:14px;line-height:1.6;margin:0 0 6px}
.rc-modal .rc-cost{font-size:15px;color:var(--gold);font-weight:700;margin:10px 0}
.rc-modal .rc-skip{font-size:12.5px;color:var(--muted);margin:6px 0}
.rc-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
.rc-hist-msg{max-width:260px;white-space:normal;color:var(--muted);font-size:12px;line-height:1.4}
`;
    document.head.appendChild(style);
}

// ============================================================
// NEW CAMPAIGN VIEW
// ============================================================
async function renderCampaignComposerView() {
    rcInjectStyles();
    const wrap = rcEl('marketingViewWrap');
    wrap.innerHTML = `<div class="rc-empty"><span class="rc-spin"></span><div style="margin-top:10px;">Loading recipient groups…</div></div>`;

    const metaRes = await apiCall('/marketing/recipients/meta');
    if (!metaRes || !metaRes.success) {
        wrap.innerHTML = `<div class="rc-empty"><strong>Couldn't load recipient groups</strong>${escapeHtml(metaRes?.message || 'Please try again.')}<div style="margin-top:12px;"><button class="rc-btn gold" onclick="renderCampaignComposerView()">Retry</button></div></div>`;
        return;
    }
    RC.meta = metaRes.data;
    if (!(RC.meta.channels || []).some(c => c.id === RC.channel && c.available)) RC.channel = 'sms';

    const canSend = hasPermission('marketing:send');
    wrap.innerHTML = `
    <div class="rc">
      <div class="rc-main">

        <div class="rc-card">
          <h3><span class="rc-step">1</span> Campaign Details</h3>
          <div class="rc-row">
            <div>
              <label class="rc-label" for="rcTitle">Campaign Name *</label>
              <input class="rc-input" id="rcTitle" type="text" maxlength="120" placeholder="e.g. Admissions Open 2027" value="${escapeHtml(RC.title)}">
              <div class="rc-hint">Only for your records &amp; history. It is not added to the message (for Email it becomes the subject).</div>
            </div>
            <div>
              <label class="rc-label" for="rcChannel">Channel</label>
              <select class="rc-select" id="rcChannel">
                ${RC.meta.channels.map(c => `<option value="${c.id}" ${c.id === RC.channel ? 'selected' : ''} ${c.available ? '' : 'disabled'}>${escapeHtml(c.label)}${c.available ? '' : ' (coming soon)'}</option>`).join('')}
              </select>
              <div class="rc-hint">Cost per message is set in Settings → Campaign Costs.</div>
            </div>
          </div>
        </div>

        <div class="rc-card">
          <h3><span class="rc-step">2</span> Select Recipients</h3>
          <div class="rc-checks" id="rcGroups"></div>
          <div class="rc-hint">Ticking a group selects everyone in it — you can still un-tick individuals in the table below. <strong>Custom Selection</strong> loads everyone so you can hand-pick.</div>
        </div>

        <div class="rc-card">
          <h3><span class="rc-step">3</span> Class Filters <span class="rc-note" style="margin-left:auto;font-weight:400;">Select one or more · none = all classes</span></h3>
          <div class="rc-chips" id="rcClasses"></div>
        </div>

        <div class="rc-card">
          <h3><span class="rc-step">4</span> Recipients</h3>
          <div class="rc-toolbar">
            <input class="rc-input" id="rcSearch" type="search" placeholder="Search by name or mobile…" value="${escapeHtml(RC.filters.search)}">
            <select class="rc-select" id="rcClassFilter">
              <option value="">All classes</option>
              ${RC.meta.classes.map(c => `<option value="${escapeHtml(c.key)}" ${c.key === RC.filters.classFilter ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
            </select>
            <select class="rc-select" id="rcStatusFilter">
              <option value="">All statuses</option>
              ${RC.meta.statuses.map(s => `<option value="${escapeHtml(s)}" ${s === RC.filters.status ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </div>
          <div class="rc-actions">
            <button class="rc-btn" id="rcSelectAll" onclick="rcSelectAllMatching()"><i class="fas fa-check-double"></i> Select All</button>
            <button class="rc-btn" id="rcUnselectAll" onclick="rcUnselectAll()"><i class="fas fa-ban"></i> Unselect All</button>
            <span class="rc-spacer"></span>
            <span class="rc-selected" id="rcSelectedBadge">Selected Recipients: 0</span>
          </div>
          <div class="rc-tablewrap" id="rcTableWrap">
            <table class="rc-table">
              <thead><tr>
                <th style="width:40px;"><input type="checkbox" id="rcPageCheck" title="Select this page"></th>
                <th>Name</th><th>Mobile Number</th><th>Parent Mobile</th><th>Class</th><th>Status</th>
              </tr></thead>
              <tbody id="rcTableBody"></tbody>
            </table>
            <div class="rc-overlay-spin" id="rcTableSpin" style="display:none;"><span class="rc-spin"></span></div>
          </div>
          <div class="rc-pager" id="rcPager"></div>
        </div>

      </div>

      <aside class="rc-side">
        <div class="rc-card">
          <h3><span class="rc-step">5</span> Message</h3>
          <textarea class="rc-textarea" id="rcMessage" maxlength="${RC.meta.maxMessageLength}" placeholder="Type your message…">${escapeHtml(RC.message)}</textarea>
          <div class="rc-tokens">
            <span class="rc-note">Insert:</span>
            <button class="rc-btn" type="button" onclick="rcInsertToken('{name}')">{name}</button>
            <button class="rc-btn" type="button" onclick="rcInsertToken('{student}')">{student}</button>
            <button class="rc-btn" type="button" onclick="rcInsertToken('{class}')">{class}</button>
            <button class="rc-btn" type="button" style="margin-left:auto;" onclick="rcUseTemplate()"><i class="fas fa-file-lines"></i> Admissions template</button>
          </div>
          <div class="rc-counter"><span id="rcCounterLeft"></span><span id="rcCounterRight"></span></div>
        </div>

        <div class="rc-card">
          <h3>👁️ Preview <span class="rc-note" style="margin-left:auto;font-weight:400;">exactly as it will be sent</span></h3>
          <div class="rc-phone">
            <div class="rc-phone-head"><span id="rcPreviewTo"></span><span id="rcPreviewMeta"></span></div>
            <div class="rc-bubble" id="rcPreview"></div>
          </div>
        </div>

        <div class="rc-card">
          <h3>🧮 Cost Estimation</h3>
          <div class="rc-stats" id="rcEstimate"></div>
        </div>

        <div class="rc-card">
          ${canSend ? `<button class="rc-btn gold big" id="rcSendBtn" onclick="rcSend()"><i class="fas fa-paper-plane"></i> <span id="rcSendLabel">Send</span></button>`
                    : `<div class="rc-note">You don't have permission to send campaigns.</div>`}
          <ul class="rc-check-list" id="rcChecklist"></ul>
        </div>

        <div id="rcResult"></div>
      </aside>
    </div>`;

    rcBindStaticEvents();
    rcRenderGroups();
    rcRenderClasses();
    rcRenderTable();
    rcRenderMessageParts();
    rcRenderEstimate();
    rcRenderChecklist();
    rcRenderResult();

    // Keep a selection the admin built earlier in this session, but refresh
    // it against current data (students may have been added/removed).
    if (RC.groups.size) { await rcRefreshPool(); } else { rcRenderSelectedBadge(); }
}

function rcBindStaticEvents() {
    rcEl('rcTitle').addEventListener('input', e => { RC.title = e.target.value; rcRenderChecklist(); });
    rcEl('rcChannel').addEventListener('change', e => { RC.channel = e.target.value; rcRenderMessageParts(); rcScheduleEstimate(); rcRenderChecklist(); });
    rcEl('rcMessage').addEventListener('input', e => { RC.message = e.target.value; rcRenderMessageParts(); rcScheduleEstimate(); rcRenderChecklist(); });

    rcEl('rcSearch').addEventListener('input', e => {
        RC.filters.search = e.target.value;
        clearTimeout(RC.timers.search);
        RC.timers.search = setTimeout(() => rcLoadTable(1), 300);
    });
    rcEl('rcClassFilter').addEventListener('change', e => { RC.filters.classFilter = e.target.value; rcLoadTable(1); });
    rcEl('rcStatusFilter').addEventListener('change', e => { RC.filters.status = e.target.value; rcLoadTable(1); });

    rcEl('rcGroups').addEventListener('change', e => {
        const input = e.target.closest('input[data-group]');
        if (input) rcToggleGroup(input.dataset.group, input.checked);
    });
    rcEl('rcClasses').addEventListener('change', e => {
        const input = e.target.closest('input[data-class]');
        if (input) rcToggleClass(input.dataset.class, input.checked);
    });
    rcEl('rcTableBody').addEventListener('change', e => {
        const input = e.target.closest('input[data-key]');
        if (!input) return;
        rcSetSelected(input.dataset.key, input.checked);
        input.closest('tr').classList.toggle('sel', input.checked);
        rcAfterSelectionChange();
    });
    rcEl('rcPageCheck').addEventListener('change', e => {
        RC.table.rows.forEach(r => rcSetSelected(r.key, e.target.checked));
        rcRenderTable();
        rcAfterSelectionChange();
    });
}

// ---------- Groups & class filters ----------
function rcRenderGroups() {
    const box = rcEl('rcGroups');
    if (!box) return;
    box.innerHTML = RC.meta.groups.map(g => `
        <label class="rc-check ${RC.groups.has(g.id) ? 'on' : ''}">
            <input type="checkbox" data-group="${g.id}" ${RC.groups.has(g.id) ? 'checked' : ''}>
            <span>${escapeHtml(g.label)}</span>
            <span class="rc-pill">${g.count}</span>
        </label>`).join('');
}

function rcRenderClasses() {
    const box = rcEl('rcClasses');
    if (!box) return;
    box.innerHTML = RC.meta.classes.map(c => `
        <label class="rc-check ${RC.classKeys.has(c.key) ? 'on' : ''}">
            <input type="checkbox" data-class="${escapeHtml(c.key)}" ${RC.classKeys.has(c.key) ? 'checked' : ''}>
            <span>${escapeHtml(c.label)}</span>
        </label>`).join('');
}

async function rcToggleGroup(id, on) {
    if (on) RC.groups.add(id); else RC.groups.delete(id);
    rcRenderGroups();
    await rcRefreshPool();
}

async function rcToggleClass(key, on) {
    if (on) RC.classKeys.add(key); else RC.classKeys.delete(key);
    rcRenderClasses();
    await rcRefreshPool();
}

// Re-fetch who is in the pool / auto-selected, prune stale manual picks,
// then reload the table.
async function rcRefreshPool() {
    const seq = ++RC.seq.pool;
    if (!RC.groups.size) {
        RC.poolKeys = new Set(); RC.autoKeys = new Set();
        RC.included.clear(); RC.excluded.clear();
        await rcLoadTable(1);
        rcAfterSelectionChange();
        return;
    }
    rcSetTableLoading(true);
    const params = new URLSearchParams({ groups: Array.from(RC.groups).join(',') });
    if (RC.classKeys.size) params.set('classes', Array.from(RC.classKeys).join(','));
    const res = await apiCall(`/marketing/recipients/pool?${params.toString()}`);
    if (seq !== RC.seq.pool) return; // a newer change superseded this one
    if (!res || !res.success) {
        RC.table.error = res?.message || 'Failed to load recipients';
        rcSetTableLoading(false);
        rcRenderTable();
        return;
    }
    RC.poolKeys = new Set(res.data.poolKeys);
    RC.autoKeys = new Set(res.data.autoKeys);
    RC.included = new Set(Array.from(RC.included).filter(k => RC.poolKeys.has(k)));
    RC.excluded = new Set(Array.from(RC.excluded).filter(k => RC.autoKeys.has(k)));
    await rcLoadTable(1);
    rcAfterSelectionChange();
}

// ---------- Table ----------
function rcSetTableLoading(on) {
    RC.table.loading = on;
    const wrap = rcEl('rcTableWrap'), spin = rcEl('rcTableSpin');
    if (spin) spin.style.display = on ? 'flex' : 'none';
    if (wrap) wrap.querySelector('table').classList.toggle('rc-loading', on);
    if (on && !RC.table.rows.length) rcRenderTable(); // first load: show skeleton rows
}

async function rcLoadTable(page) {
    const seq = ++RC.seq.list;
    RC.table.error = '';
    if (!RC.groups.size) {
        RC.table = { ...RC.table, rows: [], total: 0, page: 1, pages: 1, matchingKeys: [], loading: false, error: '' };
        rcRenderTable();
        return;
    }
    rcSetTableLoading(true);
    const params = new URLSearchParams({ groups: Array.from(RC.groups).join(','), page: page || RC.table.page, limit: RC.table.limit });
    if (RC.classKeys.size) params.set('classes', Array.from(RC.classKeys).join(','));
    if (RC.filters.search.trim()) params.set('search', RC.filters.search.trim());
    if (RC.filters.status) params.set('status', RC.filters.status);
    if (RC.filters.classFilter) params.set('classFilter', RC.filters.classFilter);

    const res = await apiCall(`/marketing/recipients/list?${params.toString()}`);
    if (seq !== RC.seq.list) return;
    if (!res || !res.success) {
        RC.table.error = res?.message || 'Failed to load recipients';
        rcSetTableLoading(false);
        rcRenderTable();
        return;
    }
    RC.table = { ...RC.table, ...res.data, loading: false, error: '' };
    rcSetTableLoading(false);
    rcRenderTable();
}

function rcRenderTable() {
    const body = rcEl('rcTableBody');
    if (!body) return;
    const t = RC.table;

    if (t.loading && !t.rows.length) {
        body.innerHTML = Array.from({ length: 5 }, () => `<tr class="rc-skel">${'<td><div></div></td>'.repeat(6)}</tr>`).join('');
    } else if (t.error) {
        body.innerHTML = `<tr><td colspan="6"><div class="rc-empty"><strong>Couldn't load recipients</strong>${escapeHtml(t.error)}<div style="margin-top:10px;"><button class="rc-btn" onclick="rcLoadTable(${t.page})">Retry</button></div></div></td></tr>`;
    } else if (!RC.groups.size) {
        body.innerHTML = `<tr><td colspan="6"><div class="rc-empty"><strong>No recipient group selected</strong>Tick a group in “Select Recipients” above (or Custom Selection to pick individually).</div></td></tr>`;
    } else if (!t.rows.length) {
        body.innerHTML = `<tr><td colspan="6"><div class="rc-empty"><strong>No recipients found</strong>Try changing the search, class or status filters.</div></td></tr>`;
    } else {
        body.innerHTML = t.rows.map(r => {
            const sel = rcIsSelected(r.key);
            // Only flag a bad number when it is the one the message would go to
            // (the Mobile column for students/teachers/enquiries, the Parent
            // Mobile column for parent rows) — a student's parent number is
            // just shown for reference.
            const phoneCell = (p, isDestination) => {
                if (!p) return `<span class="rc-dash">—</span>`;
                const bad = isDestination && !rcPhoneLooksValid(p);
                return `<span class="${bad ? 'rc-bad' : ''}" ${bad ? 'title="Invalid mobile number — will be skipped"' : ''}>${escapeHtml(p)}${bad ? ' ⚠' : ''}</span>`;
            };
            return `<tr class="${sel ? 'sel' : ''}">
                <td><input type="checkbox" data-key="${escapeHtml(r.key)}" ${sel ? 'checked' : ''}></td>
                <td><span class="rc-name">${escapeHtml(r.name)}</span><span class="rc-kind">${RC_KIND_LABELS[r.kind] || ''}</span></td>
                <td>${r.kind === 'parent' ? `<span class="rc-dash">—</span>` : phoneCell(r.phone, true)}</td>
                <td>${r.kind === 'parent' ? phoneCell(r.parentPhone, true) : (r.kind === 'student' ? phoneCell(r.parentPhone, false) : `<span class="rc-dash">—</span>`)}</td>
                <td>${r.className ? escapeHtml(r.className) : `<span class="rc-dash">—</span>`}</td>
                <td><span class="rc-badge ${rcStatusClass(r.status)}">${escapeHtml(r.status)}</span>${r.feeDue ? `<span class="rc-badge warn">Fee Due</span>` : ''}</td>
            </tr>`;
        }).join('');
    }

    // header checkbox reflects the current page
    const pageCheck = rcEl('rcPageCheck');
    if (pageCheck) {
        const sel = t.rows.filter(r => rcIsSelected(r.key)).length;
        pageCheck.checked = t.rows.length > 0 && sel === t.rows.length;
        pageCheck.indeterminate = sel > 0 && sel < t.rows.length;
        pageCheck.disabled = !t.rows.length;
    }

    rcRenderPager();
    const selectAll = rcEl('rcSelectAll');
    if (selectAll) {
        selectAll.disabled = !t.total;
        selectAll.innerHTML = `<i class="fas fa-check-double"></i> Select All${t.total ? ` (${t.total})` : ''}`;
    }
    rcRenderSelectedBadge();
}

function rcRenderPager() {
    const el = rcEl('rcPager');
    if (!el) return;
    const t = RC.table;
    if (!t.total) { el.innerHTML = ''; return; }
    const from = (t.page - 1) * t.limit + 1;
    const to = Math.min(t.page * t.limit, t.total);
    el.innerHTML = `
        <span>Showing ${from}–${to} of ${t.total}</span>
        <span class="rc-spacer"></span>
        <label>Rows <select onchange="rcSetPageSize(this.value)">${RC_PAGE_SIZES.map(n => `<option value="${n}" ${n === t.limit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="rc-btn" ${t.page <= 1 ? 'disabled' : ''} onclick="rcLoadTable(${t.page - 1})"><i class="fas fa-chevron-left"></i> Prev</button>
        <span>Page ${t.page} of ${t.pages}</span>
        <button class="rc-btn" ${t.page >= t.pages ? 'disabled' : ''} onclick="rcLoadTable(${t.page + 1})">Next <i class="fas fa-chevron-right"></i></button>`;
}

function rcSetPageSize(v) {
    RC.table.limit = parseInt(v, 10) || 25;
    rcLoadTable(1);
}

function rcSelectAllMatching() {
    RC.table.matchingKeys.forEach(k => rcSetSelected(k, true));
    rcRenderTable();
    rcAfterSelectionChange();
}

function rcUnselectAll() {
    RC.included.clear();
    RC.excluded = new Set(RC.autoKeys);
    rcRenderTable();
    rcAfterSelectionChange();
}

function rcRenderSelectedBadge() {
    const n = rcSelectedCount();
    const badge = rcEl('rcSelectedBadge');
    if (badge) badge.textContent = `Selected Recipients: ${n}`;
    const un = rcEl('rcUnselectAll');
    if (un) un.disabled = n === 0;
}

function rcAfterSelectionChange() {
    rcRenderSelectedBadge();
    const pageCheck = rcEl('rcPageCheck');
    if (pageCheck) {
        const sel = RC.table.rows.filter(r => rcIsSelected(r.key)).length;
        pageCheck.checked = RC.table.rows.length > 0 && sel === RC.table.rows.length;
        pageCheck.indeterminate = sel > 0 && sel < RC.table.rows.length;
    }
    rcRenderEstimate();
    rcRenderChecklist();
    rcScheduleEstimate();
}

// ---------- Message, preview ----------
function rcInsertToken(token) {
    const ta = rcEl('rcMessage');
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + token.length, start + token.length);
    RC.message = ta.value;
    rcRenderMessageParts(); rcScheduleEstimate(); rcRenderChecklist();
}

function rcUseTemplate() {
    const ta = rcEl('rcMessage');
    if (ta.value.trim() && !confirm('Replace the current message with the Admissions template?')) return;
    ta.value = RC_TEMPLATE_ADMISSIONS;
    RC.message = ta.value;
    rcRenderMessageParts(); rcScheduleEstimate(); rcRenderChecklist();
}

function rcRenderMessageParts() {
    const ch = rcChannel();
    const preview = rcEl('rcPreview');
    if (!preview) return;

    const rendered = rcRenderTemplate(RC.message, rcSampleRecipient());
    preview.classList.toggle('empty', !RC.message.trim());
    preview.textContent = RC.message.trim() ? rendered : 'Your message will appear here.';

    const sample = rcSampleRecipient();
    rcEl('rcPreviewTo').textContent = `To: ${sample.name}${RC.estimate?.sample ? '' : ' (sample)'}`;

    const info = RC.estimate && !RC.estimating ? RC.estimate.messageInfo : null;
    const max = RC.meta.maxMessageLength;
    rcEl('rcCounterLeft').textContent = `${RC.message.length} / ${max} characters`;
    rcEl('rcCounterRight').innerHTML = RC.estimating
        ? `<span class="rc-spin sm"></span>`
        : (ch.id === 'sms' && info && RC.message.trim()
            ? `${info.units} SMS per recipient · ${escapeHtml(info.encoding)}`
            : '');
    rcEl('rcPreviewMeta').textContent = ch.id === 'sms' && info && RC.message.trim() ? `${info.length} chars · ${info.units} SMS` : '';

    const label = rcEl('rcSendLabel');
    if (label && !RC.sending) label.textContent = `Send ${ch.label}`;
}

// ---------- Estimate ----------
function rcScheduleEstimate() {
    clearTimeout(RC.timers.est);
    RC.estimating = true;
    rcRenderEstimate();
    RC.timers.est = setTimeout(() => { rcFetchEstimate(); }, 450);
}

async function rcFetchEstimate() {
    clearTimeout(RC.timers.est);
    const seq = ++RC.seq.est;
    RC.estimating = true;
    rcRenderEstimate();
    const res = await apiCall('/marketing/recipients/estimate', {
        method: 'POST',
        body: JSON.stringify({ channel: RC.channel, message: RC.message, selection: rcSelectionPayload() }),
    });
    if (seq !== RC.seq.est) return null; // superseded
    RC.estimating = false;
    RC.estimate = res && res.success ? res.data : null;
    rcRenderEstimate();
    rcRenderMessageParts();
    rcRenderChecklist();
    return RC.estimate;
}

function rcRenderEstimate() {
    const box = rcEl('rcEstimate');
    if (!box) return;
    const ch = rcChannel();
    const selected = rcSelectedCount();
    const e = RC.estimate;
    const unitLabel = ch.id === 'sms' ? 'SMS Units' : 'Messages';
    const busy = RC.estimating ? ` <span class="rc-spin sm"></span>` : '';

    if (!e) {
        box.innerHTML = `
            <div class="rc-stat"><span>Selected Recipients</span><b>${selected}</b></div>
            <div class="rc-note">${RC.estimating ? 'Calculating…' : 'Select recipients and write a message to see the cost.'}</div>`;
        return;
    }
    box.innerHTML = `
        <div class="rc-stat"><span>Selected Recipients</span><b>${selected}</b></div>
        <div class="rc-stat"><span>Recipients (will receive)</span><b>${e.validCount}${busy}</b></div>
        <div class="rc-stat"><span>${unitLabel}</span><b>${e.totalUnits}</b></div>
        <div class="rc-stat"><span>Cost per ${ch.id === 'sms' ? 'SMS' : 'message'}</span><b>${rcMoney(e.rate)}</b></div>
        <div class="rc-stat total"><span>Estimated Cost</span><b>${rcMoney(e.estimatedCost)}</b></div>
        ${e.invalidCount ? `<div class="rc-note" style="color:#f87171;">⚠ ${e.invalidCount} recipient(s) have no valid ${ch.id === 'email' ? 'email address' : 'mobile number'} and will be skipped.</div>` : ''}
        ${e.duplicateCount ? `<div class="rc-note">${e.duplicateCount} duplicate number(s) removed — each gets one message.</div>` : ''}
        ${e.rate === 0 ? `<div class="rc-note">Cost per message is ₹0 — set it in Settings → Campaign Costs.</div>` : ''}`;
}

// ---------- Checklist / validation ----------
function rcIssues() {
    const issues = [];
    if (!RC.title.trim()) issues.push({ key: 'title', text: 'Enter a campaign name' });
    if (rcSelectedCount() === 0) issues.push({ key: 'recipients', text: 'No recipients selected. Choose at least one recipient' });
    if (!RC.message.trim()) issues.push({ key: 'message', text: 'Message cannot be empty' });
    if (!issues.length && RC.estimate && RC.estimate.validationError && !RC.estimating) {
        issues.push({ key: 'server', text: RC.estimate.validationError });
    }
    return issues;
}

function rcRenderChecklist() {
    const ul = rcEl('rcChecklist');
    if (!ul) return;
    const issues = rcIssues();
    const bad = key => issues.find(i => i.key === key);
    const row = (key, okText, badText) => {
        const issue = bad(key);
        const cls = !issue ? 'done' : (RC.attempted ? 'bad' : '');
        return `<li class="${cls}"><span>${!issue ? '✓' : (RC.attempted ? '✕' : '○')}</span><span>${escapeHtml(issue ? badText : okText)}</span></li>`;
    };
    const server = bad('server');
    ul.innerHTML =
        row('title', 'Campaign name added', 'Enter a campaign name') +
        row('recipients', `${rcSelectedCount()} recipient(s) selected`, 'No recipients selected. Choose at least one recipient') +
        row('message', 'Message written', 'Message cannot be empty') +
        (server ? `<li class="${RC.attempted ? 'bad' : ''}"><span>${RC.attempted ? '✕' : '○'}</span><span>${escapeHtml(server.text)}</span></li>` : '');
}

// ---------- Send ----------
function rcConfirm(est) {
    return new Promise(resolve => {
        const ch = rcChannel();
        const n = est.validCount;
        const bg = document.createElement('div');
        bg.className = 'rc-modal-bg';
        bg.innerHTML = `
            <div class="rc-modal" role="dialog" aria-modal="true" aria-labelledby="rcConfirmTitle">
                <h4 id="rcConfirmTitle">📣 Confirm ${escapeHtml(ch.label)} Campaign</h4>
                <p>You are about to send ${escapeHtml(ch.label)} to <strong>${n} recipient${n === 1 ? '' : 's'}</strong>.</p>
                <div class="rc-cost">Estimated Cost: ${rcMoney(est.estimatedCost)}</div>
                ${est.invalidCount ? `<div class="rc-skip">${est.invalidCount} recipient(s) with invalid numbers will be skipped.</div>` : ''}
                <p>Do you want to continue?</p>
                <div class="rc-modal-actions">
                    <button class="rc-btn" id="rcConfirmCancel">Cancel</button>
                    <button class="rc-btn gold" id="rcConfirmOk"><i class="fas fa-paper-plane"></i> Send ${escapeHtml(ch.label)}</button>
                </div>
            </div>`;
        const close = result => { document.removeEventListener('keydown', onKey); bg.remove(); resolve(result); };
        const onKey = ev => { if (ev.key === 'Escape') close(false); };
        document.addEventListener('keydown', onKey);
        bg.addEventListener('click', ev => { if (ev.target === bg) close(false); });
        document.body.appendChild(bg);
        bg.querySelector('#rcConfirmCancel').onclick = () => close(false);
        bg.querySelector('#rcConfirmOk').onclick = () => close(true);
        bg.querySelector('#rcConfirmOk').focus();
    });
}

function rcSetSending(on, label) {
    RC.sending = on;
    const btn = rcEl('rcSendBtn'), lbl = rcEl('rcSendLabel');
    if (btn) btn.disabled = on;
    if (lbl) lbl.innerHTML = on ? `<span class="rc-spin sm"></span> ${escapeHtml(label || 'Working…')}` : `Send ${escapeHtml(rcChannel().label)}`;
}

async function rcSend() {
    if (RC.sending) return;
    RC.attempted = true;
    rcRenderChecklist();

    // Quick local checks first so the admin gets an immediate, specific message
    const local = rcIssues().filter(i => i.key !== 'server');
    if (local.length) { showToast('Cannot send yet', local[0].text, 'error'); return; }

    rcSetSending(true, 'Checking…');
    const est = await rcFetchEstimate(); // authoritative numbers, right now
    rcSetSending(false);
    if (!est) { showToast('Error', 'Could not calculate the estimate. Please try again.', 'error'); return; }
    if (est.validationError) { showToast('Cannot send', est.validationError, 'error'); return; }

    const ok = await rcConfirm(est);
    if (!ok) return;

    rcSetSending(true, 'Sending…');
    const res = await apiCall('/marketing/campaigns/send-selected', {
        method: 'POST',
        body: JSON.stringify({ title: RC.title.trim(), message: RC.message, channel: RC.channel, selection: rcSelectionPayload() }),
    });
    rcSetSending(false);

    if (!res || !res.success) {
        RC.lastResult = { error: res?.message || 'Failed to send campaign' };
        showToast('Error', RC.lastResult.error, 'error');
        rcRenderResult();
        return;
    }
    RC.lastResult = res.data;
    showToast(res.data.failed ? 'Sent with errors' : 'Success', res.message, res.data.failed ? 'error' : 'success');
    RC.attempted = false;
    rcRenderResult();
    rcRenderChecklist();
    // History tab data is now stale
    RCH.rows = [];
}

function rcRenderResult() {
    const box = rcEl('rcResult');
    if (!box) return;
    const r = RC.lastResult;
    if (!r) { box.innerHTML = ''; return; }
    if (r.error) {
        box.innerHTML = `<div class="rc-card rc-result fail"><h3>❌ Not sent</h3><div class="rc-note">${escapeHtml(r.error)}</div></div>`;
        return;
    }
    const reasons = Object.entries(r.failureReasons || {});
    box.innerHTML = `
        <div class="rc-card rc-result ${r.failed ? 'fail' : ''}">
            <h3>${r.failed ? '⚠️' : '✅'} Last campaign result</h3>
            <div class="rc-stats">
                <div class="rc-stat"><span>Successful sends</span><b>${r.sent}</b></div>
                <div class="rc-stat"><span>Failed sends</span><b>${r.failed}</b></div>
                ${r.skippedInvalid ? `<div class="rc-stat"><span>Skipped (invalid number)</span><b>${r.skippedInvalid}</b></div>` : ''}
                <div class="rc-stat"><span>Total cost</span><b>${rcMoney(r.totalCost)}</b></div>
            </div>
            ${reasons.length ? `<div class="rc-note" style="margin-top:10px;">Why some failed:<br>${reasons.slice(0, 4).map(([why, n]) => `• ${escapeHtml(why)} (${n})`).join('<br>')}</div>` : ''}
            <div style="margin-top:12px;"><button class="rc-btn" onclick="switchMarketingView('history')"><i class="fas fa-clock-rotate-left"></i> View Campaign History</button></div>
        </div>`;
}

// ============================================================
// CAMPAIGN HISTORY VIEW
// ============================================================
async function renderCampaignHistoryView() {
    rcInjectStyles();
    const wrap = rcEl('marketingViewWrap');
    wrap.innerHTML = `
        <div class="rc-card">
            <h3>🕒 Campaign History</h3>
            <div class="rc-toolbar" style="grid-template-columns:minmax(200px,1fr) auto;">
                <input class="rc-input" id="rchSearch" type="search" placeholder="Search by campaign name…" value="${escapeHtml(RCH.search)}">
                <button class="rc-btn" onclick="rchLoad(RCH.page)"><i class="fas fa-rotate"></i> Refresh</button>
            </div>
            <div class="rc-tablewrap" id="rchWrap">
                <table class="rc-table" style="min-width:900px;">
                    <thead><tr>
                        <th>Campaign Name</th><th>Message</th><th>Channel</th><th>Total Recipients</th>
                        <th>Successful</th><th>Failed</th><th>Total Cost</th><th>Created By</th><th>Created At</th>
                    </tr></thead>
                    <tbody id="rchBody"></tbody>
                </table>
                <div class="rc-overlay-spin" id="rchSpin" style="display:none;"><span class="rc-spin"></span></div>
            </div>
            <div class="rc-pager" id="rchPager"></div>
        </div>`;
    rcEl('rchSearch').addEventListener('input', e => {
        RCH.search = e.target.value;
        clearTimeout(RCH.timer);
        RCH.timer = setTimeout(() => rchLoad(1), 300);
    });
    await rchLoad(RCH.page);
}

async function rchLoad(page) {
    const seq = ++RCH.seq;
    RCH.loading = true; RCH.error = '';
    rchRender();
    const params = new URLSearchParams({ page: page || 1, limit: RCH.limit });
    if (RCH.search.trim()) params.set('search', RCH.search.trim());
    const res = await apiCall(`/marketing/campaigns/campaign-history?${params.toString()}`);
    if (seq !== RCH.seq) return;
    RCH.loading = false;
    if (!res || !res.success) { RCH.error = res?.message || 'Failed to load campaign history'; rchRender(); return; }
    Object.assign(RCH, res.data);
    rchRender();
}

function rchRender() {
    const body = rcEl('rchBody');
    if (!body) return;
    const spin = rcEl('rchSpin');
    if (spin) spin.style.display = RCH.loading ? 'flex' : 'none';
    rcEl('rchWrap').querySelector('table').classList.toggle('rc-loading', RCH.loading);

    if (RCH.loading && !RCH.rows.length) {
        body.innerHTML = Array.from({ length: 4 }, () => `<tr class="rc-skel">${'<td><div></div></td>'.repeat(9)}</tr>`).join('');
    } else if (RCH.error) {
        body.innerHTML = `<tr><td colspan="9"><div class="rc-empty"><strong>Couldn't load history</strong>${escapeHtml(RCH.error)}<div style="margin-top:10px;"><button class="rc-btn" onclick="rchLoad(${RCH.page})">Retry</button></div></div></td></tr>`;
    } else if (!RCH.rows.length) {
        body.innerHTML = `<tr><td colspan="9"><div class="rc-empty"><strong>${RCH.search ? 'No campaigns match your search' : 'No campaigns sent yet'}</strong>${RCH.search ? '' : 'Campaigns you send will be listed here.'}</div></td></tr>`;
    } else {
        body.innerHTML = RCH.rows.map(c => `
            <tr>
                <td><span class="rc-name">${escapeHtml(c.campaignName)}</span></td>
                <td><div class="rc-hist-msg" title="${escapeHtml(c.message)}">${escapeHtml(c.message.slice(0, 90))}${c.message.length > 90 ? '…' : ''}</div></td>
                <td>${(c.channels || []).map(ch => `<span class="rc-badge info">${escapeHtml(ch)}</span>`).join('') || '—'}</td>
                <td>${c.totalRecipients}</td>
                <td><span class="rc-badge ok">${c.successfulSends}</span></td>
                <td>${c.failedSends ? `<span class="rc-badge warn" style="background:rgba(239,68,68,.15);color:#f87171;">${c.failedSends}</span>` : `<span class="rc-dash" style="color:var(--muted);">0</span>`}</td>
                <td>${c.totalCost === null ? `<span class="rc-dash" style="color:var(--muted);" title="Sent before cost tracking existed">—</span>` : rcMoney(c.totalCost)}</td>
                <td>${escapeHtml(c.createdBy)}</td>
                <td>${c.createdAt ? new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
            </tr>`).join('');
    }

    const pager = rcEl('rchPager');
    if (!RCH.total) { pager.innerHTML = ''; return; }
    const from = (RCH.page - 1) * RCH.limit + 1, to = Math.min(RCH.page * RCH.limit, RCH.total);
    pager.innerHTML = `
        <span>Showing ${from}–${to} of ${RCH.total}</span>
        <span class="rc-spacer"></span>
        <button class="rc-btn" ${RCH.page <= 1 ? 'disabled' : ''} onclick="rchLoad(${RCH.page - 1})"><i class="fas fa-chevron-left"></i> Prev</button>
        <span>Page ${RCH.page} of ${RCH.pages}</span>
        <button class="rc-btn" ${RCH.page >= RCH.pages ? 'disabled' : ''} onclick="rchLoad(${RCH.page + 1})">Next <i class="fas fa-chevron-right"></i></button>`;
}
