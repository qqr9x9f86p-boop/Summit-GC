/* ============================================================
 * crm.js — M.A.Y.A CRM · Summit GC build
 * localStorage-based — no backend required for demo
 * ============================================================ */

// ── Constants ─────────────────────────────────────────────────
const STATUS_LABELS = {
  new:       'New Lead',
  contacted: 'Contacted',
  quoted:    'Quoted',
  won:       'Won',
  lost:      'Lost',
  nurture:   'Nurture',
};

const STATUS_CLASSES = {
  new:       'badge-new',
  contacted: 'badge-contacted',
  quoted:    'badge-quoted',
  won:       'badge-won',
  lost:      'badge-lost',
  nurture:   'badge-nurture',
};

// Next stage for direct advance (gates handled separately)
const NEXT_STAGE = {
  new:     'contacted',
  nurture: 'contacted',
};

const NEXT_LABEL = {
  new:       'Mark Contacted',
  contacted: 'Send Quote →',
  quoted:    'Mark Won',
  nurture:   'Re-engage',
};

const TIMELINE_URGENCY = {
  'ASAP (within 30 days)': 3,
  'Within 1 month':        2,
  '1-3 months':            1,
  '3-6 months':            0,
  '6+ months / planning':  0,
  'Just exploring':        0,
};

const STAGE_FILL = { new: 1, contacted: 2, quoted: 3, won: 4, lost: 4, nurture: 2 };
const DOT_LABELS = ['Lead', 'Contacted', 'Quoted', 'Close'];

// ── Store (localStorage) ───────────────────────────────────────
const STORE = {
  RECORDS_KEY: 'sgc_crm_records',
  AUDIT_KEY:   'sgc_crm_audit',

  getAll() {
    try { return JSON.parse(localStorage.getItem(this.RECORDS_KEY) || '[]'); }
    catch { return []; }
  },
  save(records) {
    localStorage.setItem(this.RECORDS_KEY, JSON.stringify(records));
  },
  add(record) {
    const all = this.getAll(); all.push(record); this.save(all); return record;
  },
  update(id, updates) {
    const all = this.getAll();
    const i   = all.findIndex(r => r.id === id);
    if (i === -1) return null;
    all[i] = { ...all[i], ...updates };
    this.save(all);
    return all[i];
  },
  remove(id) {
    const all    = this.getAll();
    const record = all.find(r => r.id === id);
    this.save(all.filter(r => r.id !== id));
    return record;
  },
  addActivity(id, activity) {
    const all = this.getAll();
    const i   = all.findIndex(r => r.id === id);
    if (i === -1) return;
    if (!all[i].activities) all[i].activities = [];
    all[i].activities.unshift({ ...activity, at: Date.now() });
    this.save(all);
  },

  // Audit log
  getAudit() {
    try { return JSON.parse(localStorage.getItem(this.AUDIT_KEY) || '[]'); }
    catch { return []; }
  },
  addAudit(record) {
    const audit = this.getAudit();
    audit.unshift({ ...record, archivedAt: Date.now() });
    localStorage.setItem(this.AUDIT_KEY, JSON.stringify(audit));
  },
  reactivate(id) {
    const audit = this.getAudit();
    const i     = audit.findIndex(r => r.id === id);
    if (i === -1) return;
    const record = { ...audit[i], status: 'new', lastMovedAt: Date.now() };
    delete record.archivedAt;
    audit.splice(i, 1);
    localStorage.setItem(this.AUDIT_KEY, JSON.stringify(audit));
    this.add(record);
  },
};

// ── Utils ──────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

// ── Status helpers ─────────────────────────────────────────────
function isStale(r) {
  if (['won', 'lost'].includes(r.status)) return false;
  const last = r.lastMovedAt || r.createdAt || 0;
  return (Date.now() - last) > 7 * 24 * 60 * 60 * 1000;
}
function isOverdue(r) {
  if (r.status !== 'quoted' || !r.followUpDate) return false;
  return new Date(r.followUpDate) < new Date(new Date().toDateString());
}
function isDueToday(r) {
  if (r.status !== 'quoted' || !r.followUpDate) return false;
  return r.followUpDate === new Date().toISOString().split('T')[0];
}

// ── Urgency Score (higher = more urgent, sort DESC) ────────────
function urgencyScore(r) {
  if (r.status === 'won')  return -2;
  if (r.status === 'lost') return -1;
  let s = 0;
  if (isOverdue(r))   s += 1000;
  if (isDueToday(r))  s += 500;
  s += (TIMELINE_URGENCY[r.timeline] || 0) * 100;
  const age = Date.now() - (r.createdAt || 0);
  if (age < 2 * 60 * 60 * 1000) s += 300;   // fresh < 2h
  if (isStale(r))                s += 50;    // stale still needs attn
  return s;
}
function sortByUrgency(list) {
  return [...list].sort((a, b) => urgencyScore(b) - urgencyScore(a));
}

// ── Stage dots ─────────────────────────────────────────────────
function stageDots(status) {
  const fill   = STAGE_FILL[status] ?? 1;
  const isLost = status === 'lost';
  const dots   = [1,2,3,4].map(i => {
    let cls = 'sdot';
    if      (i < fill)             cls += ' sdot-done';
    else if (i === fill && isLost) cls += ' sdot-lost';
    else if (i === fill)           cls += ' sdot-active';
    return `<span class="${cls}" title="${DOT_LABELS[i-1]}"></span>`;
  }).join('');
  return `<span class="stage-pip">${dots}<span class="stage-label">${STATUS_LABELS[status] || status}</span></span>`;
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, kind = 'info') {
  const root = document.getElementById('toast-root');
  const el   = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2800);
}

// ── Modal ──────────────────────────────────────────────────────
function openModal({ title, body, footer }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${title || ''}</h3>
          <button class="icon-btn" id="modal-close-btn" aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  root.classList.remove('hidden');
  const onEsc = e => { if (e.key === 'Escape') closeModal(); };
  root.querySelector('#modal-close-btn').addEventListener('click', closeModal);
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', onEsc);
  root._cleanupEsc = onEsc;
  return root.querySelector('.modal');
}
function closeModal() {
  const root = document.getElementById('modal-root');
  if (root._cleanupEsc) { document.removeEventListener('keydown', root._cleanupEsc); delete root._cleanupEsc; }
  root.classList.add('hidden');
  root.innerHTML = '';
}

// ── View router ────────────────────────────────────────────────
let currentView = 'dashboard';

function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const titleEl   = document.getElementById('main-head-title');
  const viewRoot  = document.getElementById('view-root');
  const actionsEl = document.getElementById('view-actions');
  actionsEl.innerHTML = '';

  const titles = { dashboard: 'Dashboard', records: 'Pipeline', audit: 'Audit Log' };
  titleEl.textContent = titles[view] || view;

  if      (view === 'dashboard') renderDashboard(viewRoot);
  else if (view === 'records')   renderRecords(viewRoot, actionsEl);
  else if (view === 'audit')     renderAudit(viewRoot);
}

function refresh() {
  updateNavBadges();
  setView(currentView);
}

function updateNavBadges() {
  const records  = STORE.getAll();
  const newCount = records.filter(r => r.status === 'new').length;
  const newBadge = document.getElementById('badge-new');
  if (newBadge) {
    newBadge.textContent = newCount;
    newBadge.classList.toggle('hidden', newCount === 0);
  }
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard(root) {
  const records  = STORE.getAll();
  const active   = records.filter(r => !['won', 'lost'].includes(r.status));
  const won      = records.filter(r => r.status === 'won');
  const wonRev   = won.reduce((s, r) => s + (r.dealValue || 0), 0);
  const overdue  = records.filter(isOverdue).length;
  const staleN   = records.filter(isStale).length;
  const priority = sortByUrgency(records.filter(r => !['won','lost'].includes(r.status))).slice(0, 8);

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Active Pipeline</div>
        <div class="kpi-val">${active.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">New Leads</div>
        <div class="kpi-val kpi-accent">${records.filter(r=>r.status==='new').length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Contacted</div>
        <div class="kpi-val">${records.filter(r=>r.status==='contacted').length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Quoted</div>
        <div class="kpi-val">${records.filter(r=>r.status==='quoted').length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Won</div>
        <div class="kpi-val kpi-won">${won.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Won Revenue</div>
        <div class="kpi-val kpi-won">$${wonRev.toLocaleString()}</div>
      </div>
      <div class="kpi-card ${overdue > 0 ? 'kpi-alert' : ''}">
        <div class="kpi-label">Overdue Follow-Ups</div>
        <div class="kpi-val">${overdue}</div>
      </div>
      <div class="kpi-card ${staleN > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Stale (7+ Days)</div>
        <div class="kpi-val">${staleN}</div>
      </div>
    </div>

    <h3 class="section-title">Priority Queue</h3>
    ${priority.length === 0
      ? '<div class="empty-state"><p>No active records. Add a lead to get started.</p></div>'
      : `<div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Name</th><th>Service</th><th>Stage</th><th>Timeline</th><th>Action</th>
          </tr></thead>
          <tbody>${priority.map(r => buildRow(r, false)).join('')}</tbody>
        </table></div>`
    }`;

  bindRowEvents(root);
}

// ── Records View ───────────────────────────────────────────────
let recSearch = '';
let recFilter = '';

function renderRecords(root, actionsEl) {
  actionsEl.innerHTML = `
    <button class="btn btn-primary btn-sm" id="add-lead-btn">+ Add Lead</button>
    <button class="btn btn-sm" id="add-contact-btn">+ Add Contact</button>`;
  actionsEl.querySelector('#add-lead-btn').addEventListener('click', () => openAddModal('lead'));
  actionsEl.querySelector('#add-contact-btn').addEventListener('click', () => openAddModal('contact'));

  root.innerHTML = `
    <div class="toolbar">
      <input type="search" id="rec-search" placeholder="Search name, phone, email…" value="${esc(recSearch)}" autocomplete="off" />
      <select id="rec-filter">
        <option value="">All Stages</option>
        ${Object.entries(STATUS_LABELS).map(([v,l]) => `<option value="${v}" ${recFilter===v?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <div id="rec-table-wrap"></div>`;

  root.querySelector('#rec-search').addEventListener('input', e => { recSearch = e.target.value; refreshTable(root); });
  root.querySelector('#rec-filter').addEventListener('change', e => { recFilter = e.target.value; refreshTable(root); });
  refreshTable(root);
}

function refreshTable(root) {
  const wrap = root.querySelector('#rec-table-wrap');
  if (!wrap) return;
  let list = sortByUrgency(STORE.getAll());
  const q  = recSearch.trim().toLowerCase();
  if (q)         list = list.filter(r => (r.name||'').toLowerCase().includes(q) || (r.phone||'').toLowerCase().includes(q) || (r.email||'').toLowerCase().includes(q));
  if (recFilter) list = list.filter(r => r.status === recFilter);

  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><p>${STORE.getAll().length === 0 ? 'No records yet.' : 'No records match.'}</p></div>`;
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr>
      <th>Name</th><th>Phone</th><th>Service</th><th>Stage</th><th>Timeline</th><th>Added</th><th>Action</th>
    </tr></thead>
    <tbody>${list.map(r => buildRow(r, true)).join('')}</tbody>
  </table></div>`;
  bindRowEvents(root);
}

function buildRow(r, full) {
  const stale   = isStale(r);
  const overdue = isOverdue(r);
  const typePill = r.type === 'lead'
    ? '<span class="pill pill-lead">Inbound</span>'
    : '<span class="pill pill-contact">Contact</span>';
  const flags = [
    typePill,
    stale   ? '<span class="badge badge-stale">Stale</span>' : '',
    overdue ? '<span class="badge badge-overdue">Overdue</span>' : '',
  ].join('');

  const tlShort = (r.timeline || '')
    .replace(' (within 30 days)', '')
    .replace('6+ months / planning', '6+ mo.')
    .replace('Just exploring', 'Exploring');
  const tlBadge = r.timeline ? `<span class="pill pill-timeline">${esc(tlShort)}</span>` : '';

  return `
    <tr class="lead-row ${overdue ? 'row-overdue' : stale ? 'row-stale' : ''}" data-id="${r.id}">
      <td><strong>${esc(r.name || '—')}</strong><div class="cell-sub">${flags}</div></td>
      ${full ? `<td class="muted">${esc(r.phone || '—')}</td>` : ''}
      <td class="muted">${esc(r.service || '—')}</td>
      <td>${stageDots(r.status || 'new')}</td>
      <td>${tlBadge}</td>
      ${full ? `<td class="muted small">${formatDate(r.createdAt)}</td>` : ''}
      <td class="qa-cell" onclick="event.stopPropagation()">${qaHtml(r)}</td>
    </tr>`;
}

function qaHtml(r) {
  const s = r.status;
  if (s === 'new' || s === 'nurture')
    return `<button class="qa-btn" data-id="${r.id}" data-qa="advance">${NEXT_LABEL[s]}</button>`;
  if (s === 'contacted')
    return `<button class="qa-btn" data-id="${r.id}" data-qa="advance">${NEXT_LABEL[s]}</button>`;
  if (s === 'quoted')
    return `<button class="qa-btn qa-won"  data-id="${r.id}" data-qa="advance">Won ✓</button>
            <button class="qa-btn qa-lost" data-id="${r.id}" data-qa="lost">Lost</button>`;
  if (s === 'won')  return `<span class="badge badge-won">Won</span>`;
  if (s === 'lost') return `<button class="qa-btn" data-id="${r.id}" data-qa="nurture">Re-engage</button>`;
  return '';
}

function bindRowEvents(root) {
  root.querySelectorAll('.lead-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const r = STORE.getAll().find(x => x.id === tr.dataset.id);
      if (r) openRecordModal(r);
    });
  });
  root.querySelectorAll('[data-qa]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const r = STORE.getAll().find(x => x.id === btn.dataset.id);
      if (!r) return;
      const qa = btn.dataset.qa;
      if      (qa === 'advance') handleAdvance(r);
      else if (qa === 'lost')    openLostModal(r);
      else if (qa === 'nurture') {
        STORE.update(r.id, { status: 'contacted', lastMovedAt: Date.now() });
        STORE.addActivity(r.id, { type: 'status', text: 'Re-engaged from Lost → Contacted', byName: 'You' });
        toast('Re-engaged — moved to Contacted', 'success');
        refresh();
      }
    });
  });
}

// ── Pipeline advancement with gates ───────────────────────────
function handleAdvance(r) {
  const s = r.status;
  // Direct advances (no gate)
  if (s === 'new' || s === 'nurture') {
    STORE.update(r.id, { status: 'contacted', lastMovedAt: Date.now() });
    STORE.addActivity(r.id, { type: 'status', text: `Moved to ${STATUS_LABELS.contacted}`, byName: 'You' });
    toast(`Moved to Contacted`, 'success');
    refresh();
    return;
  }
  // Gate: contacted → quoted requires follow-up date
  if (s === 'contacted') { openQuoteGateModal(r); return; }
  // Gate: quoted → won requires deal value
  if (s === 'quoted')    { openWonGateModal(r);   return; }
}

function openQuoteGateModal(r) {
  const modal = openModal({
    title: `Send Quote — ${esc(r.name)}`,
    body: `
      <p class="modal-hint">A follow-up date is required before advancing. No date, no move.</p>
      <label class="field-label">Follow-up date *
        <input type="date" id="gate-date" min="${new Date().toISOString().split('T')[0]}" />
      </label>
      <label class="field-label" style="margin-top:10px">Quote notes (optional)
        <textarea id="gate-note" rows="2" placeholder="What was quoted, scope details…"></textarea>
      </label>`,
    footer: `<button class="btn" id="gate-cancel">Cancel</button>
             <button class="btn btn-primary" id="gate-confirm">Move to Quoted →</button>`,
  });
  modal.querySelector('#gate-cancel').addEventListener('click', closeModal);
  modal.querySelector('#gate-confirm').addEventListener('click', () => {
    const date = modal.querySelector('#gate-date').value;
    if (!date) { toast('Follow-up date is required', 'error'); return; }
    const note = modal.querySelector('#gate-note').value.trim();
    STORE.update(r.id, { status: 'quoted', followUpDate: date, lastMovedAt: Date.now() });
    if (note) STORE.addActivity(r.id, { type: 'note', text: note, byName: 'You' });
    STORE.addActivity(r.id, { type: 'status', text: `Quoted · Follow-up set: ${date}`, byName: 'You' });
    toast('Moved to Quoted', 'success');
    closeModal(); refresh();
  });
}

function openWonGateModal(r) {
  const modal = openModal({
    title: `Mark Won — ${esc(r.name)}`,
    body: `
      <p class="modal-hint">Enter the deal value to track revenue. Required to close.</p>
      <label class="field-label">Deal value ($) *
        <input type="number" id="won-val" placeholder="0" min="0" style="margin-top:4px" />
      </label>`,
    footer: `<button class="btn" id="won-cancel">Cancel</button>
             <button class="btn btn-primary" id="won-confirm">Mark Won ✓</button>`,
  });
  modal.querySelector('#won-val').focus();
  modal.querySelector('#won-cancel').addEventListener('click', closeModal);
  modal.querySelector('#won-confirm').addEventListener('click', () => {
    const raw = modal.querySelector('#won-val').value;
    if (!raw) { toast('Deal value is required', 'error'); return; }
    const val = parseFloat(raw) || 0;
    STORE.update(r.id, { status: 'won', dealValue: val, lastMovedAt: Date.now() });
    STORE.addActivity(r.id, { type: 'status', text: `Won · $${val.toLocaleString()} closed`, byName: 'You' });
    toast(`Won! $${val.toLocaleString()} closed.`, 'success');
    closeModal(); refresh();
  });
}

function openLostModal(r) {
  const modal = openModal({
    title: `Mark Lost — ${esc(r.name)}`,
    body: `
      <p class="modal-hint">Choose how to handle this record going forward.</p>
      <label class="field-label">Reason (optional)
        <textarea id="lost-reason" rows="2" placeholder="Why was this lost?"></textarea>
      </label>`,
    footer: `
      <button class="btn" id="lost-cancel">Cancel</button>
      <button class="btn btn-warn" id="lost-nurture">Nurture Further</button>
      <button class="btn btn-danger" id="lost-disq">Disqualify</button>`,
  });
  modal.querySelector('#lost-cancel').addEventListener('click', closeModal);
  modal.querySelector('#lost-nurture').addEventListener('click', () => {
    const reason = modal.querySelector('#lost-reason').value.trim();
    STORE.update(r.id, { status: 'nurture', lastMovedAt: Date.now() });
    if (reason) STORE.addActivity(r.id, { type: 'note', text: `Lost reason: ${reason}`, byName: 'You' });
    STORE.addActivity(r.id, { type: 'status', text: 'Moved to Nurture', byName: 'You' });
    toast('Moved to Nurture', 'info');
    closeModal(); refresh();
  });
  modal.querySelector('#lost-disq').addEventListener('click', () => {
    const reason = modal.querySelector('#lost-reason').value.trim();
    const record = STORE.remove(r.id);
    if (record) STORE.addAudit({ ...record, status: 'lost', disqualifyReason: reason });
    toast('Disqualified — saved to Audit Log', 'warn');
    closeModal(); refresh();
  });
}

// ── Add Record Modal ───────────────────────────────────────────
function openAddModal(type = 'lead') {
  const modal = openModal({
    title: type === 'lead' ? 'Add New Lead' : 'Add New Contact',
    body: `
      <div class="form-grid">
        <label class="field-label">Full Name *<input type="text" id="f-name" placeholder="Jane Smith" /></label>
        <label class="field-label">Phone<input type="tel" id="f-phone" placeholder="(555) 000-0000" /></label>
        <label class="field-label">Email<input type="email" id="f-email" placeholder="jane@email.com" /></label>
        <label class="field-label">Project / Service
          <select id="f-service">
            <option value="">Select…</option>
            <option>Kitchen Remodel</option>
            <option>Bathroom Renovation</option>
            <option>Home Addition</option>
            <option>Whole-Home Remodel</option>
            <option>Exterior / Outdoor</option>
            <option>Light Commercial</option>
            <option>Other</option>
          </select>
        </label>
        <label class="field-label">Timeline
          <select id="f-timeline">
            <option value="">Unknown</option>
            <option>ASAP (within 30 days)</option>
            <option>Within 1 month</option>
            <option>1-3 months</option>
            <option>3-6 months</option>
            <option>6+ months / planning</option>
            <option>Just exploring</option>
          </select>
        </label>
      </div>
      <label class="field-label" style="margin-top:6px">Notes
        <textarea id="f-notes" rows="2" placeholder="Any context or details…"></textarea>
      </label>`,
    footer: `<button class="btn" id="add-cancel">Cancel</button>
             <button class="btn btn-primary" id="add-confirm">Add ${type === 'lead' ? 'Lead' : 'Contact'}</button>`,
  });
  modal.querySelector('#f-name').focus();
  modal.querySelector('#add-cancel').addEventListener('click', closeModal);
  modal.querySelector('#add-confirm').addEventListener('click', () => {
    const name = modal.querySelector('#f-name').value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    const record = {
      id:          uid(),
      type,
      name,
      phone:       modal.querySelector('#f-phone').value.trim(),
      email:       modal.querySelector('#f-email').value.trim(),
      service:     modal.querySelector('#f-service').value,
      timeline:    modal.querySelector('#f-timeline').value,
      notes:       modal.querySelector('#f-notes').value.trim(),
      status:      'new',
      createdAt:   Date.now(),
      lastMovedAt: Date.now(),
      activities:  [],
    };
    STORE.add(record);
    STORE.addActivity(record.id, { type: 'note', text: 'Record created manually', byName: 'You' });
    toast(`${type === 'lead' ? 'Lead' : 'Contact'} added`, 'success');
    closeModal(); refresh();
  });
}

// ── Record Detail Modal ────────────────────────────────────────
function openRecordModal(r) {
  const acts = r.activities || [];
  const modal = openModal({
    title: `${esc(r.name)} <span class="badge ${STATUS_CLASSES[r.status] || ''}">${STATUS_LABELS[r.status] || r.status}</span>`,
    body: `
      <div class="record-detail">
        <div class="record-meta">
          <div class="meta-row"><span class="meta-key">Phone</span><span>${esc(r.phone||'—')}</span></div>
          <div class="meta-row"><span class="meta-key">Email</span><span>${esc(r.email||'—')}</span></div>
          <div class="meta-row"><span class="meta-key">Service</span><span>${esc(r.service||'—')}</span></div>
          <div class="meta-row"><span class="meta-key">Timeline</span><span>${esc(r.timeline||'—')}</span></div>
          <div class="meta-row"><span class="meta-key">Added</span><span>${formatDate(r.createdAt)}</span></div>
          ${r.followUpDate ? `<div class="meta-row"><span class="meta-key">Follow-Up</span><span class="${isOverdue(r)?'text-danger':''}">${r.followUpDate}${isOverdue(r)?' (OVERDUE)':''}</span></div>` : ''}
          ${r.dealValue != null ? `<div class="meta-row"><span class="meta-key">Deal Value</span><span class="text-won">$${r.dealValue.toLocaleString()}</span></div>` : ''}
          ${r.notes ? `<div class="meta-row"><span class="meta-key">Notes</span><span>${esc(r.notes)}</span></div>` : ''}
        </div>

        <div class="stage-bar">${stageDots(r.status)}</div>

        <div class="activity-section">
          <h4 class="activity-title">Activity Log</h4>
          <form id="log-form" class="log-form">
            <input type="text" id="log-input" placeholder="Log a call, note, or objection…" autocomplete="off" />
            <button type="submit" class="btn btn-primary btn-sm">Log</button>
          </form>
          <div class="activity-list">
            ${acts.length === 0
              ? '<div class="muted small" style="padding:8px 0">No activity yet.</div>'
              : acts.map(a => `
                <div class="activity-item">
                  <div class="activity-dot"></div>
                  <div>
                    <div class="activity-text">${esc(a.text)}</div>
                    <div class="activity-meta muted small">${esc(a.byName||'You')} · ${formatRelative(a.at)}</div>
                  </div>
                </div>`).join('')}
          </div>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-danger btn-sm" id="rd-delete">Delete</button>
      <div style="flex:1"></div>
      ${qaHtml(r)}`,
  });

  modal.querySelector('#log-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = modal.querySelector('#log-input');
    const text  = input.value.trim();
    if (!text) return;
    STORE.addActivity(r.id, { type: 'note', text, byName: 'You' });
    input.value = '';
    toast('Activity logged', 'success');
    closeModal();
    const updated = STORE.getAll().find(x => x.id === r.id);
    if (updated) openRecordModal(updated);
    refresh();
  });

  modal.querySelector('#rd-delete').addEventListener('click', () => {
    if (!confirm(`Delete ${r.name}? They'll be saved to the Audit Log.`)) return;
    const record = STORE.remove(r.id);
    if (record) STORE.addAudit({ ...record, status: 'lost' });
    toast('Deleted — saved to Audit Log', 'warn');
    closeModal(); refresh();
  });

  modal.querySelectorAll('[data-qa]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeModal();
      const qa = btn.dataset.qa;
      if      (qa === 'advance') handleAdvance(r);
      else if (qa === 'lost')    openLostModal(r);
      else if (qa === 'nurture') {
        STORE.update(r.id, { status: 'contacted', lastMovedAt: Date.now() });
        STORE.addActivity(r.id, { type: 'status', text: 'Re-engaged → Contacted', byName: 'You' });
        toast('Re-engaged', 'success');
        refresh();
      }
    });
  });
}

// ── Audit Log ──────────────────────────────────────────────────
function renderAudit(root) {
  const audit = STORE.getAudit();
  if (!audit.length) {
    root.innerHTML = `<div class="empty-state"><p>No archived records. Disqualified and deleted records appear here.</p></div>`;
    return;
  }
  root.innerHTML = `
    <p class="muted small" style="margin-bottom:16px">${audit.length} record${audit.length !== 1 ? 's' : ''} archived. Any can be re-activated back to New.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Name</th><th>Phone</th><th>Service</th><th>Stage at Removal</th><th>Reason</th><th>Archived</th><th>Action</th>
      </tr></thead>
      <tbody>${audit.map(r => `
        <tr>
          <td><strong>${esc(r.name||'—')}</strong></td>
          <td class="muted">${esc(r.phone||'—')}</td>
          <td class="muted">${esc(r.service||'—')}</td>
          <td>${stageDots(r.status||'lost')}</td>
          <td class="muted small">${esc(r.disqualifyReason||'—')}</td>
          <td class="muted small">${formatDate(r.archivedAt)}</td>
          <td><button class="qa-btn" data-audit-id="${r.id}">Re-activate</button></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;

  root.querySelectorAll('[data-audit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      STORE.reactivate(btn.dataset.auditId);
      toast('Re-activated — moved to New', 'success');
      refresh();
    });
  });
}

// ── Inbound form bridge ────────────────────────────────────────
// Picks up submissions from the main site quote form
function checkInboundQueue() {
  try {
    const raw = localStorage.getItem('sgc_inbound_queue');
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) return;
    let added = 0;
    queue.forEach(lead => {
      if (!STORE.getAll().find(r => r.id === lead.id)) {
        STORE.add(lead);
        STORE.addActivity(lead.id, { type: 'note', text: 'Inbound lead from website form', byName: 'System' });
        added++;
      }
    });
    localStorage.removeItem('sgc_inbound_queue');
    if (added > 0) { toast(`${added} new inbound lead${added > 1 ? 's' : ''} received`, 'success'); refresh(); }
  } catch (e) { /* silent */ }
}

// ── Seed demo data ─────────────────────────────────────────────
function seedIfEmpty() {
  if (STORE.getAll().length > 0) return;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  [
    { type: 'lead',    name: 'Marcus Johnson',     phone: '(555) 201-4433', email: 'marcus@email.com',  service: 'Kitchen Remodel',       timeline: 'ASAP (within 30 days)', status: 'new',       createdAt: now - 1 * 60 * 60 * 1000, lastMovedAt: now - 1 * 60 * 60 * 1000 },
    { type: 'lead',    name: 'Sarah Okafor',        phone: '(555) 887-3321', email: 'sarah@email.com',   service: 'Bathroom Renovation',    timeline: 'Within 1 month',        status: 'contacted', createdAt: now - 2 * day, lastMovedAt: now - 2 * day },
    { type: 'contact', name: 'Derek & Kim Walton',  phone: '(555) 543-9900', email: 'dwalton@email.com', service: 'Home Addition',          timeline: '1-3 months',            status: 'quoted',    followUpDate: new Date(now - 2 * day).toISOString().split('T')[0], createdAt: now - 9 * day, lastMovedAt: now - 9 * day },
    { type: 'lead',    name: 'Tanya Brooks',         phone: '(555) 112-7654', email: 'tanya@email.com',   service: 'Exterior / Outdoor',     timeline: '3-6 months',            status: 'won',       dealValue: 28500, createdAt: now - 30 * day, lastMovedAt: now - 14 * day },
    { type: 'contact', name: 'Ray Mendoza',          phone: '(555) 660-4411', email: 'ray@email.com',     service: 'Light Commercial',       timeline: 'Just exploring',        status: 'nurture',   createdAt: now - 20 * day, lastMovedAt: now - 20 * day },
  ].forEach(seed => {
    const r = { id: uid(), activities: [], ...seed };
    STORE.add(r);
    STORE.addActivity(r.id, { type: 'note', text: 'Demo record', byName: 'System' });
  });
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  seedIfEmpty();
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
  checkInboundQueue();
  setInterval(checkInboundQueue, 15000);
  setView('dashboard');
});
