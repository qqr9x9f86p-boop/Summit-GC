/* ============================================================
 * crm.js — M.A.Y.A CRM · Summit GC · Firebase/Firestore build
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

// ── Firestore Store ────────────────────────────────────────────
const STORE = {
  _col()      { return window.fbDb.collection('sgc_records'); },
  _auditCol() { return window.fbDb.collection('sgc_audit');   },

  add(record) {
    return this._col().doc(record.id).set(record);
  },
  update(id, updates) {
    return this._col().doc(id).update(updates);
  },
  remove(id) {
    return this._col().doc(id).delete();
  },
  addActivity(id, activity) {
    const entry = { ...activity, at: Date.now() };
    return this._col().doc(id).update({
      activities: firebase.firestore.FieldValue.arrayUnion(entry),
    });
  },

  // Audit
  addAudit(record) {
    return this._auditCol().doc(record.id).set({ ...record, archivedAt: Date.now() });
  },
  getAudit() {
    return this._auditCol().orderBy('archivedAt', 'desc').get().then(snap =>
      snap.docs.map(d => ({ id: d.id, ...d.data() }))
    );
  },
  async reactivate(id) {
    const doc = await this._auditCol().doc(id).get();
    if (!doc.exists) return;
    const record = { ...doc.data(), status: 'new', lastMovedAt: Date.now() };
    delete record.archivedAt;
    await Promise.all([
      this._col().doc(id).set(record),
      this._auditCol().doc(id).delete(),
    ]);
  },
};

// ── In-memory cache (populated by onSnapshot) ─────────────────
let _records = [];
let _unsubRecords = null;

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
  return (Date.now() - (r.lastMovedAt || r.createdAt || 0)) > 7 * 86400000;
}
function isOverdue(r) {
  if (r.status !== 'quoted' || !r.followUpDate) return false;
  return new Date(r.followUpDate) < new Date(new Date().toDateString());
}
function isDueToday(r) {
  if (r.status !== 'quoted' || !r.followUpDate) return false;
  return r.followUpDate === new Date().toISOString().split('T')[0];
}

// ── Urgency score ──────────────────────────────────────────────
function urgencyScore(r) {
  if (r.status === 'won')  return -2;
  if (r.status === 'lost') return -1;
  let s = 0;
  if (isOverdue(r))   s += 1000;
  if (isDueToday(r))  s += 500;
  s += (TIMELINE_URGENCY[r.timeline] || 0) * 100;
  if ((Date.now() - (r.createdAt || 0)) < 2 * 3600000) s += 300;
  if (isStale(r)) s += 50;
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
  root._cleanupEsc  = onEsc;
  root._cleanupFns  = [];
  return root.querySelector('.modal');
}
function closeModal() {
  const root = document.getElementById('modal-root');
  if (root._cleanupEsc) { document.removeEventListener('keydown', root._cleanupEsc); delete root._cleanupEsc; }
  (root._cleanupFns || []).forEach(fn => { try { fn(); } catch {} });
  delete root._cleanupFns;
  root.classList.add('hidden');
  root.innerHTML = '';
}
function modalOnClose(fn) {
  const root = document.getElementById('modal-root');
  if (!root._cleanupFns) root._cleanupFns = [];
  root._cleanupFns.push(fn);
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
  const titles = { dashboard: 'Dashboard', records: 'Pipeline', audit: 'Audit Log', jobs: 'Jobs', calendar: 'Calendar' };
  titleEl.textContent = titles[view] || view;
  if      (view === 'dashboard') renderDashboard(viewRoot);
  else if (view === 'records')   renderRecords(viewRoot, actionsEl);
  else if (view === 'audit')     renderAudit(viewRoot);
  else if (view === 'jobs')      window.JOBS?.mount(viewRoot, { headerActionsEl: actionsEl });
  else if (view === 'calendar')  window.CALENDAR?.mount(viewRoot);
}

function refresh() {
  updateNavBadges();
  setView(currentView);
}

function updateNavBadges() {
  const newCount = _records.filter(r => r.status === 'new').length;
  const badge    = document.getElementById('badge-new');
  if (badge) { badge.textContent = newCount; badge.classList.toggle('hidden', newCount === 0); }
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard(root) {
  const records  = _records;
  const won      = records.filter(r => r.status === 'won');
  const wonRev   = won.reduce((s, r) => s + (r.dealValue || 0), 0);
  const overdue  = records.filter(isOverdue).length;
  const staleN   = records.filter(isStale).length;
  const priority = sortByUrgency(records.filter(r => !['won','lost'].includes(r.status))).slice(0, 8);

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Active Pipeline</div>
        <div class="kpi-val">${records.filter(r => !['won','lost'].includes(r.status)).length}</div>
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
        <div class="kpi-label">Quoted (Won)</div>
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
          <thead><tr><th>Name</th><th>Service</th><th>Stage</th><th>Timeline</th><th>Action</th></tr></thead>
          <tbody>${priority.map(r => buildRow(r, false)).join('')}</tbody>
        </table></div>`
    }`;
  bindRowEvents(root);
}

// ── Records view ───────────────────────────────────────────────
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
  let list   = sortByUrgency(_records);
  const q    = recSearch.trim().toLowerCase();
  if (q)         list = list.filter(r => (r.name||'').toLowerCase().includes(q) || (r.phone||'').toLowerCase().includes(q) || (r.email||'').toLowerCase().includes(q));
  if (recFilter) list = list.filter(r => r.status === recFilter);
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><p>${_records.length === 0 ? 'No records yet.' : 'No records match.'}</p></div>`;
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table class="data">
    <thead><tr><th>Name</th><th>Phone</th><th>Service</th><th>Stage</th><th>Timeline</th><th>Added</th><th>Action</th></tr></thead>
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
    stale   ? '<span class="badge badge-stale">Stale</span>'   : '',
    overdue ? '<span class="badge badge-overdue">Overdue</span>' : '',
  ].join('');
  const tlShort = (r.timeline || '')
    .replace(' (within 30 days)', '').replace('6+ months / planning', '6+ mo.').replace('Just exploring', 'Exploring');
  const tlBadge = r.timeline ? `<span class="pill pill-timeline">${esc(tlShort)}</span>` : '';

  return `
    <tr class="lead-row ${overdue ? 'row-overdue' : stale ? 'row-stale' : ''}" data-id="${r.id}">
      <td><strong>${esc(r.name||'—')}</strong><div class="cell-sub">${flags}</div></td>
      ${full ? `<td class="muted">${esc(r.phone||'—')}</td>` : ''}
      <td class="muted">${esc(r.service||'—')}</td>
      <td>${stageDots(r.status||'new')}</td>
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
  if (s === 'won')  return `<span class="badge badge-won">Won</span> <button class="qa-btn" data-id="${r.id}" data-qa="createjob" style="margin-left:4px;font-size:11px">Create Job</button>`;
  if (s === 'lost') return `<button class="qa-btn" data-id="${r.id}" data-qa="nurture">Re-engage</button>`;
  return '';
}

function bindRowEvents(root) {
  root.querySelectorAll('.lead-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const r = _records.find(x => x.id === tr.dataset.id);
      if (r) openRecordModal(r);
    });
  });
  root.querySelectorAll('[data-qa]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const r = _records.find(x => x.id === btn.dataset.id);
      if (!r) return;
      const qa = btn.dataset.qa;
      if      (qa === 'advance') handleAdvance(r);
      else if (qa === 'lost')    openLostModal(r);
      else if (qa === 'nurture') {
        await STORE.update(r.id, { status: 'contacted', lastMovedAt: Date.now() });
        await STORE.addActivity(r.id, { type: 'status', text: 'Re-engaged from Lost → Contacted', byName: 'You' });
        toast('Re-engaged — moved to Contacted', 'success');
      }
      else if (qa === 'createjob') {
        if (window.JOBS) window.JOBS.openFor(r);
        else { setView('jobs'); setTimeout(() => window.JOBS?.openFor(r), 300); }
      }
    });
  });
}

// ── Pipeline advancement ───────────────────────────────────────
async function handleAdvance(r) {
  const s = r.status;
  if (s === 'new' || s === 'nurture') {
    await STORE.update(r.id, { status: 'contacted', lastMovedAt: Date.now() });
    await STORE.addActivity(r.id, { type: 'status', text: `Moved to ${STATUS_LABELS.contacted}`, byName: 'You' });
    toast('Moved to Contacted', 'success');
    return;
  }
  if (s === 'contacted') { openQuoteGateModal(r); return; }
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
  modal.querySelector('#gate-confirm').addEventListener('click', async () => {
    const date = modal.querySelector('#gate-date').value;
    if (!date) { toast('Follow-up date is required', 'error'); return; }
    const note = modal.querySelector('#gate-note').value.trim();
    await STORE.update(r.id, { status: 'quoted', followUpDate: date, lastMovedAt: Date.now() });
    if (note) await STORE.addActivity(r.id, { type: 'note', text: note, byName: 'You' });
    await STORE.addActivity(r.id, { type: 'status', text: `Quoted · Follow-up set: ${date}`, byName: 'You' });
    toast('Moved to Quoted', 'success');
    closeModal();
  });
}

function openWonGateModal(r) {
  const modal = openModal({
    title: `Job Won — ${esc(r.name)}`,
    body: `
      <p class="modal-hint" style="margin-bottom:12px">You secured this job! Enter the quoted amount you gave the client. A job will be created automatically so you can track materials, photos, and invoice.</p>
      <label class="field-label">Quoted Amount ($) *
        <input type="number" id="won-val" placeholder="0" min="0" />
      </label>`,
    footer: `<button class="btn" id="won-cancel">Cancel</button>
             <button class="btn btn-primary" id="won-confirm">Won — Start Job ✓</button>`,
  });
  modal.querySelector('#won-val').focus();
  modal.querySelector('#won-cancel').addEventListener('click', closeModal);
  modal.querySelector('#won-confirm').addEventListener('click', async () => {
    const raw = modal.querySelector('#won-val').value;
    if (!raw) { toast('Quoted amount is required', 'error'); return; }
    const val = parseFloat(raw) || 0;
    const btn = modal.querySelector('#won-confirm');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await STORE.update(r.id, { status: 'won', dealValue: val, lastMovedAt: Date.now() });
      await STORE.addActivity(r.id, { type: 'status', text: `Won · $${val.toLocaleString()} quoted`, byName: 'You' });
      toast(`Job won — $${val.toLocaleString()} quoted. Opening job…`, 'success');
      closeModal();
      // Auto-navigate to Jobs tab and open the create-job modal pre-filled
      const wonRecord = Object.assign({}, r, { dealValue: val });
      setTimeout(function() {
        if (typeof setView === 'function') setView('jobs');
        setTimeout(function() {
          if (window.JOBS && typeof window.JOBS.openFor === 'function') {
            window.JOBS.openFor({
              id:      wonRecord.id,
              name:    wonRecord.name,
              phone:   wonRecord.phone,
              email:   wonRecord.email,
              service: wonRecord.service,
            });
          }
        }, 250);
      }, 150);
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = 'Won — Start Job ✓';
    }
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
    footer: `<button class="btn" id="lost-cancel">Cancel</button>
             <button class="btn btn-warn" id="lost-nurture">Nurture Further</button>
             <button class="btn btn-danger" id="lost-disq">Disqualify</button>`,
  });
  modal.querySelector('#lost-cancel').addEventListener('click', closeModal);
  modal.querySelector('#lost-nurture').addEventListener('click', async () => {
    const reason = modal.querySelector('#lost-reason').value.trim();
    await STORE.update(r.id, { status: 'nurture', lastMovedAt: Date.now() });
    if (reason) await STORE.addActivity(r.id, { type: 'note', text: `Lost reason: ${reason}`, byName: 'You' });
    await STORE.addActivity(r.id, { type: 'status', text: 'Moved to Nurture', byName: 'You' });
    toast('Moved to Nurture', 'info');
    closeModal();
  });
  modal.querySelector('#lost-disq').addEventListener('click', async () => {
    const reason = modal.querySelector('#lost-reason').value.trim();
    const record = _records.find(x => x.id === r.id);
    if (record) {
      await STORE.addAudit({ ...record, status: 'lost', disqualifyReason: reason });
      await STORE.remove(r.id);
    }
    toast('Disqualified — saved to Audit Log', 'warn');
    closeModal();
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
  modal.querySelector('#add-confirm').addEventListener('click', async () => {
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
    await STORE.add(record);
    await STORE.addActivity(record.id, { type: 'note', text: 'Record created manually', byName: 'You' });
    toast(`${type === 'lead' ? 'Lead' : 'Contact'} added`, 'success');
    closeModal();
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

  modal.querySelector('#log-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = modal.querySelector('#log-input');
    const text  = input.value.trim();
    if (!text) return;
    await STORE.addActivity(r.id, { type: 'note', text, byName: 'You' });
    input.value = '';
    toast('Activity logged', 'success');
    closeModal();
    // Reopen with fresh data from cache after snapshot updates
  });

  modal.querySelector('#rd-delete').addEventListener('click', async () => {
    if (!confirm(`Delete ${r.name}? They'll be saved to the Audit Log.`)) return;
    const record = _records.find(x => x.id === r.id);
    if (record) {
      await STORE.addAudit({ ...record, status: 'lost' });
      await STORE.remove(r.id);
    }
    toast('Deleted — saved to Audit Log', 'warn');
    closeModal();
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
      }
      else if (qa === 'createjob') {
        if (window.JOBS) window.JOBS.openFor(r);
        else { setView('jobs'); setTimeout(() => window.JOBS?.openFor(r), 300); }
      }
    });
  });
}

// ── Audit Log ──────────────────────────────────────────────────
async function renderAudit(root) {
  root.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
  const archived = await STORE.getAudit();

  // Flatten activities from ALL active records + archived records
  const allRecords = [..._records, ...archived];
  const allActivities = [];
  allRecords.forEach(r => {
    (r.activities || []).forEach(a => {
      allActivities.push({
        ...a,
        recordName:    r.name    || '—',
        recordService: r.service || '',
        isArchived:    !!r.archivedAt,
      });
    });
  });
  allActivities.sort((a, b) => (b.at || 0) - (a.at || 0));

  const feedHtml = allActivities.length === 0
    ? '<div class="empty-state"><p>No activity logged yet.</p></div>'
    : `<div class="audit-feed">${allActivities.map(a => `
        <div class="audit-entry">
          <div class="audit-dot audit-dot-${a.type === 'status' ? 'status' : 'note'}"></div>
          <div class="audit-entry-body">
            <div class="audit-entry-text">${esc(a.text)}</div>
            <div class="audit-entry-meta muted small">
              <span class="audit-record-name">${esc(a.recordName)}</span>
              ${a.recordService ? `<span>· ${esc(a.recordService)}</span>` : ''}
              ${a.isArchived ? '<span class="audit-archived-tag">Archived</span>' : ''}
              <span>· ${esc(a.byName || 'You')}</span>
              <span title="${a.at ? new Date(a.at).toLocaleString() : ''}">· ${formatRelative(a.at)}</span>
            </div>
          </div>
        </div>`).join('')}
      </div>`;

  const archivedHtml = archived.length === 0
    ? '<p class="muted small" style="padding:12px 0">No disqualified or deleted records.</p>'
    : `<div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Name</th><th>Phone</th><th>Service</th><th>Stage at Removal</th><th>Reason</th><th>Archived</th><th>Action</th>
        </tr></thead>
        <tbody>${archived.map(r => `
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

  root.innerHTML = `
    <h3 class="section-title">Activity Feed</h3>
    <p class="muted small" style="margin-bottom:12px">${allActivities.length} event${allActivities.length !== 1 ? 's' : ''} across ${allRecords.length} record${allRecords.length !== 1 ? 's' : ''} — newest first.</p>
    ${feedHtml}
    <h3 class="section-title" style="margin-top:32px">Archived Records</h3>
    <p class="muted small" style="margin-bottom:12px">Disqualified and deleted records. Any can be re-activated back to New.</p>
    ${archivedHtml}`;

  root.querySelectorAll('[data-audit-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await STORE.reactivate(btn.dataset.auditId);
      toast('Re-activated — moved to New', 'success');
      renderAudit(root);
    });
  });
}

// ── Seed demo data ─────────────────────────────────────────────
async function seedIfEmpty() {
  const snap = await window.fbDb.collection('sgc_records').limit(1).get();
  if (!snap.empty) return;
  const now = Date.now();
  const day = 86400000;
  const seeds = [
    { type: 'lead',    name: 'Marcus Johnson',    phone: '(555) 201-4433', email: 'marcus@email.com',  service: 'Kitchen Remodel',    timeline: 'ASAP (within 30 days)', status: 'new',       createdAt: now - 60*60*1000, lastMovedAt: now - 60*60*1000 },
    { type: 'lead',    name: 'Sarah Okafor',       phone: '(555) 887-3321', email: 'sarah@email.com',   service: 'Bathroom Renovation', timeline: 'Within 1 month',        status: 'contacted', createdAt: now - 2*day,      lastMovedAt: now - 2*day },
    { type: 'contact', name: 'Derek & Kim Walton', phone: '(555) 543-9900', email: 'dwalton@email.com', service: 'Home Addition',       timeline: '1-3 months',            status: 'quoted',    followUpDate: new Date(now - 2*day).toISOString().split('T')[0], createdAt: now - 9*day, lastMovedAt: now - 9*day },
    { type: 'lead',    name: 'Tanya Brooks',        phone: '(555) 112-7654', email: 'tanya@email.com',   service: 'Exterior / Outdoor',  timeline: '3-6 months',            status: 'won',       dealValue: 28500, createdAt: now - 30*day, lastMovedAt: now - 14*day },
    { type: 'contact', name: 'Ray Mendoza',         phone: '(555) 660-4411', email: 'ray@email.com',     service: 'Light Commercial',    timeline: 'Just exploring',        status: 'nurture',   createdAt: now - 20*day, lastMovedAt: now - 20*day },
  ];
  const batch = window.fbDb.batch();
  seeds.forEach(seed => {
    const r = { id: uid(), activities: [{ type: 'note', text: 'Demo record', byName: 'System', at: Date.now() }], ...seed };
    batch.set(window.fbDb.collection('sgc_records').doc(r.id), r);
  });
  await batch.commit();
}

// ── Realtime listener ──────────────────────────────────────────
function startListeners() {
  if (_unsubRecords) { _unsubRecords(); _unsubRecords = null; }
  _unsubRecords = window.fbDb
    .collection('sgc_records')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      _records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateNavBadges();
      setView(currentView);
    }, err => {
      console.error('Firestore listener error:', err);
      toast('Firestore error — check console', 'error');
    });
}

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Show a loading state while Firebase warms up
  document.getElementById('view-root').innerHTML =
    '<div class="empty-state"><p>Connecting to database…</p></div>';

  try {
    await seedIfEmpty();
  } catch (e) {
    console.warn('Seed check skipped (likely config not filled in):', e.message);
  }

  startListeners();
});
