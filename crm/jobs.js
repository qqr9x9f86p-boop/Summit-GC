/* ============================================================
 * jobs.js — Job tracking module for M.A.Y.A CRM
 * Exposes: window.JOBS
 *
 * Flow: CRM Lead → Quoted → WON (contract accepted) → Job Created
 * Job tracks: status, materials (w/ unit pricing), files/photos,
 *             activity log, invoice, multiple jobs per client
 * ============================================================ */

window.JOBS = (function () {

  const db      = () => window.fbDb;
  const storage = () => window.fbStorage;
  const ts      = () => firebase.firestore.FieldValue.serverTimestamp();

  // ── Constants ──────────────────────────────────────────────────
  const JOB_STATUSES = {
    not_started: 'Not Started',
    scheduled:   'Scheduled',
    in_progress: 'In Progress',
    waiting:     'Waiting / On Hold',
    completed:   'Completed',
  };
  const STATUS_CLASSES = {
    not_started: 'badge-muted',
    scheduled:   'badge-accent',
    in_progress: 'badge-warn',
    waiting:     'badge-purple',
    completed:   'badge-success',
  };
  const INV_LABELS  = { draft: 'Draft', sent: 'Sent', paid: 'Paid' };
  const INV_CLASSES = { draft: 'badge-muted', sent: 'badge-accent', paid: 'badge-success' };
  const STATUS_ORDER = ['not_started', 'scheduled', 'in_progress', 'waiting', 'completed'];
  const FILE_TYPES = ['Photo', 'Permit', 'Receipt', 'Document', 'Note / Sticky'];
  const FILE_ICONS = {
    Photo:           '🖼',
    Permit:          '📋',
    Receipt:         '🧾',
    Document:        '📄',
    'Note / Sticky': '📌',
  };
  const SOURCES = [
    'Word of Mouth', 'Repeat Client', 'Google Search', 'Social Media',
    'Door Hanger / Flyer', 'Yard Sign', 'Website Quote Form', 'Referral', 'Networking',
  ];
  const UNIT_PRESETS = [
    { label: 'Each / Unit',      value: 'each' },
    { label: 'Sq Ft',            value: 'sq ft' },
    { label: 'Linear Ft',        value: 'linear ft' },
    { label: 'Board Ft',         value: 'board ft' },
    { label: '80 lb bag',        value: '80lb bag' },
    { label: '60 lb bag',        value: '60lb bag' },
    { label: '50 lb bag',        value: '50lb bag' },
    { label: 'Lb',               value: 'lb' },
    { label: 'Gallon',           value: 'gal' },
    { label: 'Tube / Cartridge', value: 'tube' },
    { label: 'Sheet',            value: 'sheet' },
    { label: 'Bundle',           value: 'bundle' },
    { label: 'Roll',             value: 'roll' },
    { label: 'Box',              value: 'box' },
    { label: 'Hour',             value: 'hr' },
    { label: 'Day',              value: 'day' },
    { label: 'Ton',              value: 'ton' },
    { label: 'Cubic Yard',       value: 'cu yd' },
    { label: 'Custom…',          value: '__custom' },
  ];

  // ── Module state ───────────────────────────────────────────────
  let _root = null, _headerEl = null, _unsub = null;
  let _jobs = [];
  let _searchQuery = '', _statusFilter = '';

  // ── Helpers ────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt$(n) {
    if (n == null) return '—';
    return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function today() { return new Date().toISOString().split('T')[0]; }
  function isImg(name, mime) {
    return /\.(jpe?g|png|gif|webp|heic|svg)$/i.test(name || '') || (mime || '').startsWith('image/');
  }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function unitSelectHtml(id) {
    return `<select id="${id}" style="flex:1;min-width:110px;max-width:170px;margin-top:0;padding:7px 9px;font-size:12px;border:1px solid var(--border-strong,#d1d5db);border-radius:var(--radius-sm,6px);background:var(--surface,#fff);font-family:inherit">
      ${UNIT_PRESETS.map(u => `<option value="${u.value}">${u.label}</option>`).join('')}
    </select>`;
  }

  // ── Mount ──────────────────────────────────────────────────────
  function mount(rootEl, opts) {
    opts = opts || {};
    if (_unsub) { _unsub(); _unsub = null; }
    _root     = rootEl;
    _headerEl = opts.headerActionsEl || null;
    _jobs     = [];
    _searchQuery = ''; _statusFilter = '';
    injectHeader();
    renderShell();
    startListener();
  }

  function injectHeader() {
    if (!_headerEl) return;
    _headerEl.innerHTML = '';
    var exp = document.createElement('button');
    exp.className = 'btn btn-sm'; exp.textContent = 'Export CSV';
    exp.addEventListener('click', exportCsv);
    _headerEl.appendChild(exp);
    var nb = document.createElement('button');
    nb.className = 'btn btn-primary btn-sm';
    nb.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> New Job';
    nb.addEventListener('click', function() { openCreateModal(); });
    _headerEl.appendChild(nb);
  }

  function renderShell() {
    _root.innerHTML =
      '<div class="toolbar">' +
        '<input type="search" id="jobs-search" placeholder="Search client, label, service or address…" autocomplete="off"/>' +
        '<select id="jobs-status-filter" class="select-sm">' +
          '<option value="">Active jobs (not completed)</option>' +
          STATUS_ORDER.map(function(s) { return '<option value="' + s + '">' + JOB_STATUSES[s] + '</option>'; }).join('') +
          '<option value="all">All Jobs</option>' +
        '</select>' +
      '</div>' +
      '<div id="jobs-list-wrap"><div class="empty-state"><p>Loading…</p></div></div>';
    _root.querySelector('#jobs-search').addEventListener('input', function(e) {
      _searchQuery = e.target.value.trim().toLowerCase(); renderList();
    });
    _root.querySelector('#jobs-status-filter').addEventListener('change', function(e) {
      _statusFilter = e.target.value; renderList();
    });
  }

  function startListener() {
    _unsub = db().collection('jobs').orderBy('createdAt', 'desc').limit(500)
      .onSnapshot(function(snap) {
        _jobs = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
        renderList();
      }, function(err) {
        var w = _root && _root.querySelector('#jobs-list-wrap');
        if (w) w.innerHTML = '<div class="empty-state"><p>Could not load jobs: ' + esc(err.message) + '</p></div>';
      });
  }

  // ── Sort ───────────────────────────────────────────────────────
  function urgencySort(a, b) {
    var t = today();
    var aDone = a.status === 'completed', bDone = b.status === 'completed';
    if (aDone && !bDone) return 1; if (bDone && !aDone) return -1;
    var aOvr = a.scheduledDate && a.scheduledDate < t && !aDone;
    var bOvr = b.scheduledDate && b.scheduledDate < t && !bDone;
    if (aOvr && !bOvr) return -1; if (bOvr && !aOvr) return 1;
    var ai = STATUS_ORDER.indexOf(a.status || 'not_started');
    var bi = STATUS_ORDER.indexOf(b.status || 'not_started');
    if (ai !== bi) return ai - bi;
    if (a.scheduledDate && b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
    if (a.scheduledDate) return -1; if (b.scheduledDate) return 1;
    return 0;
  }

  // ── List view ──────────────────────────────────────────────────
  function renderList() {
    var wrap = _root && _root.querySelector('#jobs-list-wrap');
    if (!wrap) return;
    var list = _jobs.slice();
    if (_statusFilter === 'all') { /* show all */ }
    else if (!_statusFilter) { list = list.filter(function(j) { return j.status !== 'completed'; }); }
    else { list = list.filter(function(j) { return j.status === _statusFilter; }); }
    if (_searchQuery) {
      var q = _searchQuery;
      list = list.filter(function(j) {
        return (j.clientName || '').toLowerCase().indexOf(q) !== -1 ||
               (j.service    || '').toLowerCase().indexOf(q) !== -1 ||
               (j.address    || '').toLowerCase().indexOf(q) !== -1 ||
               (j.label      || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    list.sort(urgencySort);

    var active  = _jobs.filter(function(j) { return j.status !== 'completed'; }).length;
    var done    = _jobs.filter(function(j) { return j.status === 'completed'; });
    var revenue = done.reduce(function(s, j) { return s + (j.invoiceTotal || j.estimateValue || 0); }, 0);
    var overdue = _jobs.filter(function(j) { return j.scheduledDate && j.scheduledDate < today() && j.status !== 'completed'; }).length;
    var clientCts = {};
    _jobs.filter(function(j) { return j.status !== 'completed'; }).forEach(function(j) {
      var k = (j.clientName || '').trim().toLowerCase();
      if (k) clientCts[k] = (clientCts[k] || 0) + 1;
    });
    var multiC = Object.values(clientCts).filter(function(n) { return n > 1; }).length;

    var kpi = '<div class="jobs-kpi-strip"><div class="jobs-kpi-row">' +
      '<div class="jobs-kpi-item"><div class="jobs-kpi-num">' + active + '</div><div class="jobs-kpi-sub">Active Jobs</div></div>' +
      '<div class="jobs-kpi-item"><div class="jobs-kpi-num">' + done.length + '</div><div class="jobs-kpi-sub">Completed</div></div>' +
      '<div class="jobs-kpi-item"><div class="jobs-kpi-num">$' + Math.round(revenue).toLocaleString() + '</div><div class="jobs-kpi-sub">Revenue (closed)</div></div>' +
      (overdue > 0 ? '<div class="jobs-kpi-item"><div class="jobs-kpi-num text-danger">' + overdue + '</div><div class="jobs-kpi-sub">Overdue</div></div>' : '') +
      (multiC > 0 ? '<div class="jobs-kpi-item"><div class="jobs-kpi-num" style="color:var(--accent)">' + multiC + '</div><div class="jobs-kpi-sub">Multi-job Clients</div></div>' : '') +
      '</div></div>';

    if (!list.length) {
      wrap.innerHTML = kpi + '<div class="empty-state"><p>' + (_jobs.length ? 'No jobs match filters.' : 'No jobs yet. Win a CRM lead or click New Job.') + '</p></div>';
      return;
    }

    var t = today();
    var lastSt = null;
    var rows = list.map(function(j) {
      var st      = j.status || 'not_started';
      var overdue = j.scheduledDate && j.scheduledDate < t && st !== 'completed';
      var cKey    = (j.clientName || '').trim().toLowerCase();
      var jobCnt  = cKey ? _jobs.filter(function(x) { return (x.clientName || '').trim().toLowerCase() === cKey; }).length : 1;
      var hdr = '';
      if (st !== lastSt) { lastSt = st; hdr = '<tr class="jobs-group-header"><td colspan="8">' + JOB_STATUSES[st] + '</td></tr>'; }
      return hdr +
        '<tr class="job-row" data-id="' + j.id + '">' +
          '<td><strong>' + esc(j.clientName || '—') + '</strong>' +
            (jobCnt > 1 ? '<span class="jobs-multi-badge">' + jobCnt + ' jobs</span>' : '') +
            (j.label ? '<br><span class="job-label-tag">' + esc(j.label) + '</span>' : '') +
          '</td>' +
          '<td>' + esc(j.service || '—') + '</td>' +
          '<td class="muted small">' + esc(j.address || '—') + '</td>' +
          '<td><span class="badge ' + STATUS_CLASSES[st] + '">' + JOB_STATUSES[st] + '</span></td>' +
          '<td class="' + (overdue ? 'overdue-cell' : 'muted small') + '">' + (j.scheduledDate ? (overdue ? '⚠ ' : '') + j.scheduledDate : '—') + '</td>' +
          '<td>' + (st === 'completed' && (j.invoiceTotal || j.estimateValue)
            ? '<strong>' + fmt$(j.invoiceTotal || j.estimateValue) + '</strong><span style="color:var(--success);font-size:10px;margin-left:4px">✓</span>'
            : (j.estimateValue ? fmt$(j.estimateValue) : '<span class="muted small">—</span>')) + '</td>' +
          '<td>' + (j.invoiceNumber
            ? '<span class="badge ' + INV_CLASSES[j.invoiceStatus || 'draft'] + '">' + INV_LABELS[j.invoiceStatus || 'draft'] + '</span>'
            : '<span class="muted small">—</span>') + '</td>' +
          '<td class="muted small">' + ((j.fileCount || 0) > 0 ? '<span style="font-size:11px">📎 ' + j.fileCount + '</span>' : '') + '</td>' +
        '</tr>';
    }).join('');

    wrap.innerHTML = kpi +
      '<div class="table-wrap"><table class="data">' +
        '<thead><tr>' +
          '<th>Client</th><th>Service</th><th>Address</th>' +
          '<th>Status</th><th>Scheduled</th><th>Value</th><th>Invoice</th><th>Files</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<div class="crm-count muted small">' + list.length + ' job' + (list.length === 1 ? '' : 's') + '</div>';

    wrap.querySelectorAll('.job-row').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var job = _jobs.find(function(x) { return x.id === tr.dataset.id; });
        if (job) openDetail(job);
      });
    });
  }

  // ── Create Job Modal ───────────────────────────────────────────
  function openCreateModal(record) {
    var pre = record || {};
    var modal = openModal({
      title: pre.name ? 'Start Job — ' + esc(pre.name) : 'New Job',
      body:
        '<label class="field-label">Job Label / Project Name' +
          '<input type="text" id="jc-label" placeholder="e.g. Kitchen Remodel, Gate Repair Phase 2…"/>' +
        '</label>' +
        '<div class="grid-2">' +
          '<label class="field-label">Client Name *<input type="text" id="jc-name" value="' + esc(pre.name || '') + '"/></label>' +
          '<label class="field-label">Service / Work Type<input type="text" id="jc-service" value="' + esc(pre.service || '') + '" placeholder="e.g. Concrete, Carpentry…"/></label>' +
          '<label class="field-label">Phone<input type="tel" id="jc-phone" value="' + esc(pre.phone || '') + '"/></label>' +
          '<label class="field-label">Email<input type="email" id="jc-email" value="' + esc(pre.email || '') + '"/></label>' +
        '</div>' +
        '<label class="field-label">Job Site Address<input type="text" id="jc-address"/></label>' +
        '<div class="grid-2">' +
          '<label class="field-label">Scheduled Start Date<input type="date" id="jc-date"/></label>' +
          '<label class="field-label">$ Quoted / Estimate<input type="number" id="jc-value" placeholder="0" min="0" step="0.01"/></label>' +
        '</div>' +
        '<label class="field-label">Lead Source' +
          '<select id="jc-source" style="margin-top:4px;width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;font-size:13px;background:var(--surface)">' +
            '<option value="">—</option>' +
            SOURCES.map(function(s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') +
          '</select>' +
        '</label>' +
        '<label class="field-label" style="margin-top:6px">Notes / Access Info' +
          '<textarea id="jc-notes" placeholder="Gate code, key location, parking, contact on site, special instructions…" style="min-height:76px"></textarea>' +
        '</label>' +
        '<div style="display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:10px 12px;background:#f9fafb;border:1px solid var(--border);border-radius:var(--radius-sm)">' +
          '<input type="checkbox" id="jc-quick" style="width:auto;margin:0;flex-shrink:0;margin-top:2px"/>' +
          '<div>' +
            '<label for="jc-quick" style="margin:0;font-size:13px;color:var(--text);font-weight:600;cursor:pointer">Quick job — mark complete immediately</label>' +
            '<div class="muted small" style="margin-top:2px">For small jobs you already finished. Creates in Completed status.</div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn" id="jc-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="jc-save">Create Job</button>',
    });
    if (!pre.name) setTimeout(function() { var n = modal.querySelector('#jc-name'); if (n) n.focus(); }, 50);
    modal.querySelector('#jc-cancel').addEventListener('click', closeModal);
    modal.querySelector('#jc-save').addEventListener('click', function() {
      var name = modal.querySelector('#jc-name').value.trim();
      if (!name) { toast('Client name is required', 'error'); return; }
      var quick = modal.querySelector('#jc-quick').checked;
      var btn   = modal.querySelector('#jc-save');
      btn.disabled = true; btn.textContent = 'Creating…';
      db().collection('jobs').add({
        label:         modal.querySelector('#jc-label').value.trim()    || null,
        clientName:    name,
        clientPhone:   modal.querySelector('#jc-phone').value.trim()   || null,
        clientEmail:   modal.querySelector('#jc-email').value.trim()   || null,
        service:       modal.querySelector('#jc-service').value.trim() || '',
        address:       modal.querySelector('#jc-address').value.trim() || null,
        scheduledDate: modal.querySelector('#jc-date').value           || null,
        estimateValue: parseFloat(modal.querySelector('#jc-value').value) || null,
        notes:         modal.querySelector('#jc-notes').value.trim()   || null,
        source:        modal.querySelector('#jc-source').value         || null,
        crmRecordId:   pre.id || null,
        status:        quick ? 'completed' : 'not_started',
        fileCount:     0,
        createdAt:     ts(),
        updatedAt:     ts(),
      }).then(function(ref) {
        db().collection('jobs').doc(ref.id).collection('activities').add({
          type: 'note',
          text: 'Job created' + (pre.name ? ' from CRM — contract won with ' + pre.name : ''),
          at: ts(), byName: 'You',
        });
        toast(quick ? 'Quick job created & completed' : 'Job created', 'success');
        closeModal();
        if (!quick) {
          db().collection('jobs').doc(ref.id).get().then(function(snap) {
            if (snap.exists) openDetail(Object.assign({ id: snap.id }, snap.data()));
          });
        }
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Create Job'; });
    });
  }

  // ── Job Detail Modal ───────────────────────────────────────────
  function openDetail(job) {
    var stIdx = STATUS_ORDER.indexOf(job.status || 'not_started');
    var stepperHtml = STATUS_ORDER.map(function(s, i) {
      var done = i < stIdx, active = i === stIdx;
      return '<button class="job-step ' + (done ? 'done' : active ? 'active' : '') + '" data-status="' + s + '" data-idx="' + i + '">' +
        '<div class="job-step-circle">' + (done ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : (i + 1)) + '</div>' +
        '<div class="job-step-label">' + JOB_STATUSES[s] + '</div>' +
        '</button>' + (i < STATUS_ORDER.length - 1 ? '<div class="job-step-line' + (i < stIdx ? ' done' : '') + '"></div>' : '');
    }).join('');

    var modal = openModal({
      title: (job.label ? esc(job.label) + ' — ' : '') + esc(job.clientName || 'Job'),
      body:
        '<div class="job-stepper" id="jd-stepper">' + stepperHtml + '</div>' +
        '<div class="job-tabs" id="jd-tabs">' +
          '<button class="job-tab active" data-tab="overview">Overview</button>' +
          '<button class="job-tab" data-tab="materials">Materials</button>' +
          '<button class="job-tab" data-tab="invoice">Invoice</button>' +
          '<button class="job-tab" data-tab="files">Files &amp; Photos</button>' +
          '<button class="job-tab" data-tab="activity">Activity</button>' +
        '</div>' +
        '<div id="jd-tab-body" style="min-height:200px"></div>',
      footer:
        '<button class="btn btn-danger btn-sm" id="jd-del">Delete</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" id="jd-all-jobs">All Jobs for Client</button>' +
        '<button class="btn btn-sm" id="jd-add-job">+ New Job</button>' +
        '<button class="btn btn-sm" id="jd-edit">Edit</button>' +
        '<button class="btn btn-sm" id="jd-close">Close</button>',
    });

    var _matUnsub = null, _actUnsub = null;

    modalOnClose(function() {
      if (_matUnsub) { _matUnsub(); _matUnsub = null; }
      if (_actUnsub) { _actUnsub(); _actUnsub = null; }
    });

    // ── Stepper ────────────────────────────────────────────────
    modal.querySelector('#jd-stepper').addEventListener('click', function(e) {
      var btn = e.target.closest('.job-step');
      if (!btn || btn.classList.contains('active')) return;
      var newSt  = btn.dataset.status;
      var newIdx = parseInt(btn.dataset.idx);
      db().collection('jobs').doc(job.id).update({ status: newSt, updatedAt: ts() }).then(function() {
        modal.querySelectorAll('.job-step').forEach(function(b, i) {
          b.className = 'job-step' + (i < newIdx ? ' done' : i === newIdx ? ' active' : '');
          b.querySelector('.job-step-circle').innerHTML = i < newIdx
            ? '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
            : String(i + 1);
        });
        modal.querySelectorAll('.job-step-line').forEach(function(ln, i) { ln.classList.toggle('done', i < newIdx); });
        job.status = newSt;
        db().collection('jobs').doc(job.id).collection('activities').add({
          type: 'update', text: 'Status → ' + JOB_STATUSES[newSt], at: ts(), byName: 'You',
        });
        toast('Status: ' + JOB_STATUSES[newSt], 'success');
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    });

    // ── Tab switching ──────────────────────────────────────────
    function switchTab(tab) {
      modal.querySelectorAll('.job-tab').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
      var body = modal.querySelector('#jd-tab-body');
      if (_matUnsub) { _matUnsub(); _matUnsub = null; }
      if (_actUnsub) { _actUnsub(); _actUnsub = null; }
      if      (tab === 'overview')  renderOverview(body, job);
      else if (tab === 'materials') renderMaterials(body, job);
      else if (tab === 'invoice')   renderInvoice(body, job);
      else if (tab === 'files')     renderFiles(body, job);
      else if (tab === 'activity')  renderActivity(body, job);
    }
    modal.querySelector('#jd-tabs').addEventListener('click', function(e) {
      var btn = e.target.closest('.job-tab'); if (btn) switchTab(btn.dataset.tab);
    });

    // ── Footer buttons ────────────────────────────────────────
    modal.querySelector('#jd-close').addEventListener('click', closeModal);
    modal.querySelector('#jd-edit').addEventListener('click', function() { closeModal(); openEditModal(job); });
    modal.querySelector('#jd-add-job').addEventListener('click', function() {
      closeModal();
      openCreateModal({ name: job.clientName, phone: job.clientPhone, email: job.clientEmail, service: job.service, id: job.crmRecordId });
    });
    modal.querySelector('#jd-all-jobs').addEventListener('click', function() { openClientJobsModal(job.clientName); });
    modal.querySelector('#jd-del').addEventListener('click', function() {
      var c = openModal({
        title: 'Delete Job?',
        body: '<p style="margin:0;color:var(--text-soft)">Delete <strong>' + esc(job.clientName || 'this job') + (job.label ? ' — ' + esc(job.label) : '') + '</strong>? Cannot be undone.</p>',
        footer: '<div style="flex:1"></div><button class="btn" id="dc">Cancel</button><button class="btn btn-danger" id="dok">Delete</button>',
      });
      c.querySelector('#dc').addEventListener('click', closeModal);
      c.querySelector('#dok').addEventListener('click', function() {
        db().collection('jobs').doc(job.id).delete()
          .then(function() { toast('Deleted', 'success'); closeModal(); })
          .catch(function(e) { toast('Failed: ' + e.message, 'error'); });
      });
    });

    switchTab('overview');

    // ========================================================
    // TAB: OVERVIEW
    // ========================================================
    function renderOverview(body, j) {
      var t = today();
      var overdue = j.scheduledDate && j.scheduledDate < t && j.status !== 'completed';
      body.innerHTML =
        '<div style="padding-top:14px">' +
          (j.label ? '<div class="job-label-display">' + esc(j.label) + '</div>' : '') +
          '<div class="grid-2" style="gap:12px 20px;margin-bottom:16px">' +
            '<div><div class="muted small">Client</div><strong>' + esc(j.clientName || '—') + '</strong></div>' +
            '<div><div class="muted small">Service</div><div>' + esc(j.service || '—') + '</div></div>' +
            '<div><div class="muted small">Phone</div><div>' + (j.clientPhone ? '<a href="tel:' + esc(j.clientPhone) + '">' + esc(j.clientPhone) + '</a>' : '—') + '</div></div>' +
            '<div><div class="muted small">Email</div><div>' + (j.clientEmail ? '<a href="mailto:' + esc(j.clientEmail) + '">' + esc(j.clientEmail) + '</a>' : '—') + '</div></div>' +
            '<div style="grid-column:1/-1"><div class="muted small">Address</div><div>' + esc(j.address || '—') + '</div></div>' +
            '<div><div class="muted small">Scheduled</div><div class="' + (overdue ? 'text-danger' : '') + '">' + (j.scheduledDate ? (overdue ? '⚠ Overdue · ' : '') + j.scheduledDate : '—') + '</div></div>' +
            '<div><div class="muted small">Quoted Price</div><strong style="' + (j.estimateValue ? '' : 'color:var(--muted)') + '">' + (j.estimateValue ? fmt$(j.estimateValue) : 'Not set') + '</strong></div>' +
            (j.invoiceTotal != null ? '<div><div class="muted small">Final Invoice</div><strong style="color:var(--success)">' + fmt$(j.invoiceTotal) + '</strong></div>' : '') +
            (j.source ? '<div><div class="muted small">Source</div><div>' + esc(j.source) + '</div></div>' : '') +
          '</div>' +
          '<div class="job-section-head">Notes &amp; Access Info</div>' +
          '<textarea id="jd-notes" style="width:100%;min-height:90px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;font-size:13px;background:var(--surface);resize:vertical">' + esc(j.notes || '') + '</textarea>' +
          '<div id="jd-notes-st" class="muted small" style="min-height:14px;margin-top:2px"></div>' +
          (j.crmRecordId ? '<div class="muted small" style="margin-top:8px;padding:6px 10px;background:#f0fdf4;border-radius:var(--radius-sm)">🔗 Created from CRM lead</div>' : '') +
        '</div>';

      var _nt = null;
      var nEl = body.querySelector('#jd-notes');
      var nSt = body.querySelector('#jd-notes-st');
      nEl.addEventListener('input', function() {
        clearTimeout(_nt); nSt.textContent = '';
        _nt = setTimeout(function() {
          db().collection('jobs').doc(j.id).update({ notes: nEl.value.trim() || null, updatedAt: ts() })
            .then(function() {
              j.notes = nEl.value.trim() || null;
              nSt.textContent = 'Saved ✓';
              setTimeout(function() { if (nSt) nSt.textContent = ''; }, 1500);
            }).catch(function() { nSt.textContent = 'Save failed'; });
        }, 600);
      });
    }

    // ========================================================
    // TAB: MATERIALS
    // ========================================================
    function renderMaterials(body, j) {
      body.innerHTML =
        '<div style="padding-top:14px">' +
          '<div class="job-section-head">Add Material or Supply</div>' +
          '<div class="mat-hint">Enter material name, quantity, unit (e.g. "80lb bag", "sq ft"), and cost per unit. Totals auto-calculate.</div>' +
          '<div class="mat-add-row" style="align-items:flex-start;flex-wrap:wrap">' +
            '<input type="text" id="mat-name" placeholder="Material (e.g. Concrete, 2×4 Lumber, Nails…)" style="flex:2;min-width:160px"/>' +
            '<input type="number" id="mat-qty" placeholder="Qty" min="0" step="any" style="max-width:72px"/>' +
            unitSelectHtml('mat-unit') +
            '<input type="text" id="mat-unit-custom" placeholder="Custom unit" style="display:none;max-width:120px"/>' +
            '<input type="number" id="mat-cost" placeholder="$ per unit" min="0" step="0.01" style="max-width:110px"/>' +
            '<button class="btn btn-primary btn-sm" id="mat-add-btn" style="white-space:nowrap">+ Add Material</button>' +
          '</div>' +
          '<div id="mat-list-wrap" style="margin-top:14px"><div class="muted small">Loading materials…</div></div>' +
        '</div>';

      var unitEl = body.querySelector('#mat-unit');
      var custEl = body.querySelector('#mat-unit-custom');
      unitEl.addEventListener('change', function() {
        var custom = unitEl.value === '__custom';
        custEl.style.display = custom ? '' : 'none';
        if (custom) custEl.focus();
      });

      body.querySelector('#mat-add-btn').addEventListener('click', function() {
        var name = body.querySelector('#mat-name').value.trim();
        var qty  = parseFloat(body.querySelector('#mat-qty').value);
        var unit = unitEl.value === '__custom' ? custEl.value.trim() : unitEl.value;
        var cost = parseFloat(body.querySelector('#mat-cost').value) || 0;
        if (!name)       { toast('Material name required', 'error'); return; }
        if (!qty || qty <= 0) { toast('Quantity must be > 0', 'error'); return; }
        var total = parseFloat((qty * cost).toFixed(2));
        db().collection('jobs').doc(j.id).collection('materials').add({
          name: name, qty: qty, unit: unit || 'each', unitCost: cost, totalCost: total, addedAt: ts(),
        }).then(function() {
          body.querySelector('#mat-name').value = '';
          body.querySelector('#mat-qty').value  = '';
          body.querySelector('#mat-cost').value = '';
          toast('Material added', 'success');
        }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
      });

      _matUnsub = db().collection('jobs').doc(j.id).collection('materials')
        .orderBy('addedAt', 'asc').onSnapshot(function(snap) {
          var mats = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
          updateMatList(body, j, mats);
        });
    }

    function updateMatList(body, j, mats) {
      var wrap = body && body.querySelector('#mat-list-wrap');
      if (!wrap) return;
      var total  = mats.reduce(function(s, m) { return s + (m.totalCost || 0); }, 0);
      var est    = j.estimateValue || 0;
      var margin = est - total;

      var tableHtml = mats.length
        ? '<div class="table-wrap" style="margin-bottom:12px"><table class="materials-table">' +
            '<thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>$ / Unit</th><th>Total</th><th></th></tr></thead>' +
            '<tbody>' + mats.map(function(m) {
              return '<tr>' +
                '<td><strong>' + esc(m.name || '—') + '</strong></td>' +
                '<td>' + (m.qty != null ? m.qty : '—') + '</td>' +
                '<td class="muted small">' + esc(m.unit || '') + '</td>' +
                '<td>' + (m.unitCost != null ? fmt$(m.unitCost) : '—') + '</td>' +
                '<td><strong>' + fmt$(m.totalCost) + '</strong></td>' +
                '<td><button class="mat-delete-btn" data-mid="' + m.id + '">×</button></td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div>'
        : '<div class="muted small" style="padding:8px 0">No materials added yet.</div>';

      wrap.innerHTML = tableHtml +
        '<div class="mat-total-bar">' +
          '<div class="mat-total-item"><span class="mat-total-label">Materials Total</span><span class="mat-total-val">' + fmt$(total) + '</span></div>' +
          (est
            ? '<div class="mat-total-item"><span class="mat-total-label">Quoted Price</span><span class="mat-total-val">' + fmt$(est) + '</span></div>' +
              '<div class="mat-total-item"><span class="mat-total-label">Est. Margin</span><span class="mat-total-val ' + (margin >= 0 ? 'positive' : 'negative') + '">' + fmt$(margin) + '</span></div>'
            : '') +
        '</div>';

      wrap.querySelectorAll('.mat-delete-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          btn.disabled = true;
          db().collection('jobs').doc(j.id).collection('materials').doc(btn.dataset.mid).delete()
            .catch(function() { toast('Delete failed', 'error'); btn.disabled = false; });
        });
      });
    }

    // ========================================================
    // TAB: INVOICE
    // ========================================================
    function renderInvoice(body, j) {
      if (!j.invoiceNumber) {
        body.innerHTML =
          '<div style="padding-top:14px">' +
            '<div style="text-align:center;padding:32px 20px;border:2px dashed var(--border);border-radius:var(--radius);margin-top:4px">' +
              '<div style="font-size:40px;margin-bottom:10px">📄</div>' +
              '<div style="font-weight:700;font-size:15px;margin-bottom:4px">No Invoice Yet</div>' +
              '<div class="muted small" style="margin-bottom:18px">Generate an invoice number to track materials + labor totals for this job.</div>' +
              '<button class="btn btn-primary" id="inv-gen">Generate Invoice #</button>' +
            '</div>' +
          '</div>';
        body.querySelector('#inv-gen').addEventListener('click', function() {
          var btn = body.querySelector('#inv-gen');
          btn.disabled = true; btn.textContent = 'Generating…';
          genInvoiceNumber().then(function(num) {
            var td = today();
            return db().collection('jobs').doc(j.id).update({
              invoiceNumber: num, invoiceDate: td, invoiceStatus: 'draft',
              invoiceLaborLines: [], invoiceTaxRate: 0, updatedAt: ts(),
            }).then(function() {
              Object.assign(j, { invoiceNumber: num, invoiceDate: td, invoiceStatus: 'draft', invoiceLaborLines: [], invoiceTaxRate: 0 });
              toast(num + ' generated', 'success');
              renderInvoice(body, j);
            });
          }).catch(function(e) { toast('Failed: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Generate Invoice #'; });
        });
        return;
      }

      var status = j.invoiceStatus || 'draft';
      var lines  = j.invoiceLaborLines || [];
      var _matTot = 0;

      body.innerHTML =
        '<div style="padding-top:14px">' +
          '<div class="inv-header">' +
            '<div>' +
              '<div class="inv-number">' + esc(j.invoiceNumber) + '</div>' +
              '<div class="muted small">Issued ' + esc(j.invoiceDate || '—') + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<span class="badge ' + INV_CLASSES[status] + '" id="inv-badge">' + INV_LABELS[status] + '</span>' +
              (j.invoicePaidDate ? '<span class="muted small">Paid ' + esc(j.invoicePaidDate) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="grid-2" style="margin:10px 0">' +
            '<label class="field-label" style="margin-bottom:0">Due Date<input type="date" id="inv-due" value="' + esc(j.invoiceDueDate || '') + '" style="margin-top:4px"/></label>' +
            '<label class="field-label" style="margin-bottom:0">Tax Rate (%)<input type="number" id="inv-tax" value="' + (j.invoiceTaxRate || 0) + '" min="0" max="100" step="0.01" style="margin-top:4px"/></label>' +
          '</div>' +
          '<div class="job-section-head" style="font-size:11px">Materials (from Materials tab)</div>' +
          '<div id="inv-mat-row" class="muted small">Loading…</div>' +
          '<div class="job-section-head" style="font-size:11px;margin-top:14px">Labor &amp; Service Lines</div>' +
          '<div id="inv-labor-list">' + buildLaborHtml(lines) + '</div>' +
          '<div class="mat-add-row" style="margin-top:8px">' +
            '<input type="text" id="inv-ld" placeholder="Description (labor, disposal, markup…)"/>' +
            '<input type="number" id="inv-lq" placeholder="Qty" min="0" step="any" style="max-width:72px"/>' +
            '<input type="number" id="inv-lr" placeholder="$ Rate" min="0" step="0.01" style="max-width:110px"/>' +
            '<button class="btn btn-primary btn-sm" id="inv-ladd">+ Add Line</button>' +
          '</div>' +
          '<label class="field-label" style="margin-top:12px">Invoice Notes' +
            '<textarea id="inv-notes" style="margin-top:4px;min-height:52px">' + esc(j.invoiceNotes || '') + '</textarea>' +
          '</label>' +
          '<div id="inv-totals" style="margin-top:12px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap" id="inv-acts">' +
            (status === 'draft' ? '<button class="btn btn-sm" id="inv-send">Mark Sent</button>' : '') +
            (status === 'sent'  ? '<button class="btn btn-primary btn-sm" id="inv-paid">Mark Paid</button>' : '') +
            '<div style="flex:1"></div>' +
            '<button class="btn btn-primary btn-sm" id="inv-save">Save Invoice</button>' +
          '</div>' +
        '</div>';

      function recalc() {
        var el  = body && body.querySelector('#inv-totals');
        if (!el) return;
        var tax = parseFloat((body.querySelector('#inv-tax') || {}).value || 0) || 0;
        var lab = (j.invoiceLaborLines || []).reduce(function(s, l) { return s + (l.amount || 0); }, 0);
        var sub = _matTot + lab;
        var ta  = sub * tax / 100;
        var tot = sub + ta;
        el.innerHTML =
          '<div class="mat-total-bar">' +
            '<div class="mat-total-item"><span class="mat-total-label">Materials</span><span class="mat-total-val">' + fmt$(_matTot) + '</span></div>' +
            '<div class="mat-total-item"><span class="mat-total-label">Labor / Services</span><span class="mat-total-val">' + fmt$(lab) + '</span></div>' +
            '<div class="mat-total-item"><span class="mat-total-label">Subtotal</span><span class="mat-total-val">' + fmt$(sub) + '</span></div>' +
            (tax > 0 ? '<div class="mat-total-item"><span class="mat-total-label">Tax (' + tax + '%)</span><span class="mat-total-val">' + fmt$(ta) + '</span></div>' : '') +
            '<div class="mat-total-item inv-total-line"><span class="mat-total-label" style="font-weight:800">TOTAL</span><span class="mat-total-val inv-grand-total">' + fmt$(tot) + '</span></div>' +
          '</div>';
      }

      db().collection('jobs').doc(j.id).collection('materials').get().then(function(snap) {
        _matTot = snap.docs.reduce(function(s, d) { return s + (d.data().totalCost || 0); }, 0);
        var mr = body && body.querySelector('#inv-mat-row');
        if (mr) mr.innerHTML = '<div class="mat-total-bar" style="margin-bottom:0"><div class="mat-total-item"><span class="mat-total-label">Materials</span><span class="mat-total-val">' + fmt$(_matTot) + '</span></div></div>';
        recalc();
      }).catch(function() {});

      body.querySelector('#inv-tax').addEventListener('input', recalc);

      body.querySelector('#inv-ladd').addEventListener('click', function() {
        var desc = body.querySelector('#inv-ld').value.trim();
        var qty  = parseFloat(body.querySelector('#inv-lq').value) || 1;
        var rate = parseFloat(body.querySelector('#inv-lr').value) || 0;
        if (!desc) { toast('Description required', 'error'); return; }
        var newLines = (j.invoiceLaborLines || []).concat([{ desc: desc, qty: qty, rate: rate, amount: parseFloat((qty * rate).toFixed(2)) }]);
        db().collection('jobs').doc(j.id).update({ invoiceLaborLines: newLines, updatedAt: ts() }).then(function() {
          j.invoiceLaborLines = newLines;
          var lw = body.querySelector('#inv-labor-list'); if (lw) lw.innerHTML = buildLaborHtml(newLines);
          ['#inv-ld','#inv-lq','#inv-lr'].forEach(function(s) { var e = body.querySelector(s); if (e) e.value = ''; });
          recalc();
        }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
      });

      body.addEventListener('click', function(e) {
        var li = e.target.dataset && e.target.dataset.laborIdx;
        if (li != null) {
          var newLines = (j.invoiceLaborLines || []).slice();
          newLines.splice(parseInt(li, 10), 1);
          db().collection('jobs').doc(j.id).update({ invoiceLaborLines: newLines, updatedAt: ts() }).then(function() {
            j.invoiceLaborLines = newLines;
            var lw = body.querySelector('#inv-labor-list'); if (lw) lw.innerHTML = buildLaborHtml(newLines);
            recalc();
          }).catch(function() { toast('Failed', 'error'); });
        }
        if (e.target.id === 'inv-send') {
          db().collection('jobs').doc(j.id).update({ invoiceStatus: 'sent', updatedAt: ts() }).then(function() {
            j.invoiceStatus = 'sent';
            var b = body.querySelector('#inv-badge'); if (b) { b.className = 'badge badge-accent'; b.textContent = 'Sent'; }
            var a = body.querySelector('#inv-acts');
            if (a) a.innerHTML = '<button class="btn btn-primary btn-sm" id="inv-paid">Mark Paid</button><div style="flex:1"></div><button class="btn btn-primary btn-sm" id="inv-save">Save Invoice</button>';
            toast('Marked sent', 'success');
          }).catch(function() { toast('Failed', 'error'); });
        }
        if (e.target.id === 'inv-paid') {
          var td = today();
          db().collection('jobs').doc(j.id).update({ invoiceStatus: 'paid', invoicePaidDate: td, updatedAt: ts() }).then(function() {
            j.invoiceStatus = 'paid'; j.invoicePaidDate = td;
            var b = body.querySelector('#inv-badge'); if (b) { b.className = 'badge badge-success'; b.textContent = 'Paid'; }
            var a = body.querySelector('#inv-acts');
            if (a) a.innerHTML = '<span class="muted small">Paid ' + td + '</span><div style="flex:1"></div><button class="btn btn-primary btn-sm" id="inv-save">Save Invoice</button>';
            toast('Marked paid — revenue locked in!', 'success');
          }).catch(function() { toast('Failed', 'error'); });
        }
        if (e.target.id === 'inv-save') {
          var tax   = parseFloat((body.querySelector('#inv-tax') || {}).value || 0) || 0;
          var due   = (body.querySelector('#inv-due') || {}).value || null;
          var notes = ((body.querySelector('#inv-notes') || {}).value || '').trim() || null;
          e.target.disabled = true;
          var lab = (j.invoiceLaborLines || []).reduce(function(s, l) { return s + (l.amount || 0); }, 0);
          var sub = _matTot + lab;
          var tot = parseFloat((sub + sub * tax / 100).toFixed(2));
          db().collection('jobs').doc(j.id).update({
            invoiceTaxRate: tax, invoiceDueDate: due, invoiceNotes: notes, invoiceTotal: tot, updatedAt: ts(),
          }).then(function() {
            Object.assign(j, { invoiceTaxRate: tax, invoiceDueDate: due, invoiceNotes: notes, invoiceTotal: tot });
            recalc();
            toast('Invoice saved', 'success');
          }).catch(function(err) { toast('Save failed: ' + err.message, 'error'); })
          .then(function() { if (e.target) e.target.disabled = false; });
        }
      });
    }

    // ========================================================
    // TAB: FILES & PHOTOS
    // ========================================================
    function renderFiles(body, j) {
      body.innerHTML =
        '<div style="padding-top:14px">' +
          '<div class="job-section-head">Files &amp; Photos</div>' +
          '<div class="muted small" style="margin-bottom:14px">Upload site photos, permits, receipts, gate codes, sticky notes — anything related to this job.</div>' +
          '<div class="files-upload-bar">' +
            '<select id="file-type-sel" class="select-sm">' +
              FILE_TYPES.map(function(t) { return '<option value="' + esc(t) + '">' + FILE_ICONS[t] + ' ' + esc(t) + '</option>'; }).join('') +
            '</select>' +
            '<label class="btn btn-sm files-upload-label" style="cursor:pointer">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Choose Files' +
              '<input type="file" id="file-input" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.txt,.heic" style="display:none"/>' +
            '</label>' +
            '<span id="file-status" class="muted small"></span>' +
          '</div>' +
          '<div id="files-grid" style="margin-top:16px"><div class="muted small">Loading files…</div></div>' +
        '</div>';

      loadFiles(body, j);

      body.querySelector('#file-input').addEventListener('change', function(e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;
        var ftype  = body.querySelector('#file-type-sel').value;
        var status = body.querySelector('#file-status');
        var label  = body.querySelector('.files-upload-label');
        label.style.opacity = '0.5';
        var ok = 0;
        var chain = Promise.resolve();
        files.forEach(function(file) {
          chain = chain.then(function() {
            status.textContent = 'Uploading ' + (ok + 1) + '/' + files.length + '…';
            var safe = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            var path = 'jobs/' + j.id + '/files/' + safe;
            var ref  = storage().ref(path);
            return ref.put(file).then(function() {
              return ref.getDownloadURL();
            }).then(function(url) {
              return db().collection('jobs').doc(j.id).collection('files').add({
                name: file.name, storagePath: path, url: url, type: ftype,
                mimeType: file.type || '', size: file.size || 0, uploadedAt: ts(),
              });
            }).then(function() { ok++; })
            .catch(function(err) { toast('Upload failed: ' + file.name + ' — ' + err.message, 'error'); });
          });
        });
        chain.then(function() {
          return db().collection('jobs').doc(j.id).collection('files').get();
        }).then(function(all) {
          return db().collection('jobs').doc(j.id).update({ fileCount: all.size, updatedAt: ts() }).then(function() {
            j.fileCount = all.size;
          });
        }).then(function() {
          if (ok > 0) {
            db().collection('jobs').doc(j.id).collection('activities').add({
              type: 'note', text: ok + ' file' + (ok > 1 ? 's' : '') + ' uploaded (' + ftype + ')', at: ts(), byName: 'You',
            });
          }
          status.textContent = ok + ' uploaded';
          setTimeout(function() { if (status) status.textContent = ''; }, 3000);
          label.style.opacity = '';
          e.target.value = '';
          loadFiles(body, j);
        }).catch(function(err) {
          toast('Error: ' + err.message, 'error');
          label.style.opacity = '';
        });
      });
    }

    function loadFiles(body, j) {
      db().collection('jobs').doc(j.id).collection('files')
        .orderBy('uploadedAt', 'desc').get()
        .then(function(snap) {
          var grid = body && body.querySelector('#files-grid');
          if (!grid) return;
          if (snap.empty) {
            grid.innerHTML =
              '<div style="text-align:center;padding:32px;border:2px dashed var(--border);border-radius:var(--radius)">' +
                '<div style="font-size:32px;margin-bottom:8px">📁</div>' +
                '<div class="muted small">No files yet. Upload photos, permits, receipts above.</div>' +
              '</div>';
            return;
          }
          var files  = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
          var byType = {};
          files.forEach(function(f) {
            if (!byType[f.type]) byType[f.type] = [];
            byType[f.type].push(f);
          });
          var html = '';
          Object.keys(byType).forEach(function(type) {
            var items = byType[type];
            html += '<div class="files-group-head">' + (FILE_ICONS[type] || '📁') + ' ' + esc(type) + ' <span class="muted small">(' + items.length + ')</span></div>' +
              '<div class="files-grid">' + items.map(function(f) {
                var img = isImg(f.name, f.mimeType);
                return '<div class="file-card" data-fid="' + f.id + '" data-url="' + esc(f.url) + '" data-name="' + esc(f.name) + '">' +
                  (img
                    ? '<div class="file-thumb" style="background-image:url(\'' + esc(f.url) + '\')" title="Click to enlarge"></div>'
                    : '<div class="file-thumb file-thumb-doc">' + (FILE_ICONS[f.type] || '📄') + '</div>') +
                  '<div class="file-meta">' +
                    '<div class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
                    (f.size ? '<div class="file-size muted small">' + fmtSize(f.size) + '</div>' : '') +
                  '</div>' +
                  '<div class="file-actions">' +
                    '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" class="btn btn-sm" style="font-size:11px;padding:4px 8px">Open</a>' +
                    '<button class="btn btn-sm btn-danger file-del" data-fid="' + f.id + '" data-path="' + esc(f.storagePath || '') + '" data-name="' + esc(f.name) + '" style="font-size:11px;padding:4px 8px">Del</button>' +
                  '</div>' +
                '</div>';
              }).join('') + '</div>';
          });
          grid.innerHTML = html;

          grid.querySelectorAll('.file-thumb').forEach(function(thumb) {
            var card = thumb.closest('.file-card');
            if (thumb.style.backgroundImage) {
              thumb.style.cursor = 'zoom-in';
              thumb.addEventListener('click', function() { openLightbox(card.dataset.url, card.dataset.name); });
            }
          });

          grid.querySelectorAll('.file-del').forEach(function(btn) {
            btn.addEventListener('click', function(ev) {
              ev.stopPropagation();
              if (!confirm('Delete "' + (btn.dataset.name || 'this file') + '"?')) return;
              btn.disabled = true;
              var delStorage = btn.dataset.path
                ? storage().ref(btn.dataset.path).delete().catch(function() {})
                : Promise.resolve();
              delStorage.then(function() {
                return db().collection('jobs').doc(j.id).collection('files').doc(btn.dataset.fid).delete();
              }).then(function() {
                return db().collection('jobs').doc(j.id).collection('files').get();
              }).then(function(rem) {
                return db().collection('jobs').doc(j.id).update({ fileCount: rem.size, updatedAt: ts() }).then(function() {
                  j.fileCount = rem.size;
                });
              }).then(function() {
                toast('File deleted', 'success');
                loadFiles(body, j);
              }).catch(function(err) { toast('Delete failed: ' + err.message, 'error'); btn.disabled = false; });
            });
          });
        })
        .catch(function(err) {
          var grid = body && body.querySelector('#files-grid');
          if (grid) grid.innerHTML = '<div class="muted small text-danger">Failed to load files: ' + esc(err.message) + '</div>';
        });
    }

    // ========================================================
    // TAB: ACTIVITY
    // ========================================================
    function renderActivity(body, j) {
      var TYPE_LABELS = { note: 'Note', call: 'Call', update: 'Update', issue: 'Issue' };
      var TCOL = { note: '', call: '#b8864e', update: 'var(--accent)', issue: 'var(--danger)' };
      body.innerHTML =
        '<div style="padding-top:14px">' +
          '<div class="job-section-head">Activity Log</div>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px">' +
            '<select id="act-type" class="select-sm" style="flex-shrink:0">' +
              '<option value="note">Note</option>' +
              '<option value="call">Call</option>' +
              '<option value="update">Update</option>' +
              '<option value="issue">Issue</option>' +
            '</select>' +
            '<input type="text" id="act-text" placeholder="Log a note, call, update… press Enter" style="flex:1;margin-top:0"/>' +
          '</div>' +
          '<div id="act-list"><div class="muted small">Loading activity…</div></div>' +
        '</div>';

      var input = body.querySelector('#act-text');
      var sel   = body.querySelector('#act-type');
      input.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        var text = input.value.trim(); if (!text) return;
        input.disabled = true;
        db().collection('jobs').doc(j.id).collection('activities').add({ type: sel.value, text: text, at: ts(), byName: 'You' })
          .then(function() { input.value = ''; })
          .catch(function() { toast('Failed to log', 'error'); })
          .then(function() { input.disabled = false; input.focus(); });
      });

      _actUnsub = db().collection('jobs').doc(j.id).collection('activities')
        .orderBy('at', 'desc').limit(100).onSnapshot(function(snap) {
          var el = body && body.querySelector('#act-list');
          if (!el) return;
          if (snap.empty) { el.innerHTML = '<div class="muted small">No activity yet.</div>'; return; }
          el.innerHTML = snap.docs.map(function(d) {
            var a  = d.data();
            var at = a.at && a.at.toDate ? a.at.toDate().toLocaleString() : '';
            return '<div class="activity-item">' +
              '<div class="activity-dot" style="' + (TCOL[a.type] ? 'background:' + TCOL[a.type] : '') + '"></div>' +
              '<div>' +
                '<div class="activity-text">' +
                  '<span class="badge badge-muted" style="font-size:10px;margin-right:4px">' + (TYPE_LABELS[a.type] || a.type) + '</span>' + esc(a.text || '') +
                '</div>' +
                '<div class="activity-meta muted small">' + esc(a.byName || 'You') + (at ? ' · ' + at : '') + '</div>' +
              '</div>' +
            '</div>';
          }).join('');
        });
    }
  } // end openDetail

  // ── Lightbox ───────────────────────────────────────────────────
  function openLightbox(url, name) {
    var lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px';
    lb.innerHTML =
      '<button style="position:absolute;top:16px;right:20px;background:none;border:0;color:#fff;font-size:32px;cursor:pointer;line-height:1">×</button>' +
      '<img src="' + esc(url) + '" style="max-width:90vw;max-height:80vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6)" alt="' + esc(name) + '"/>' +
      '<div style="color:rgba(255,255,255,.7);font-size:12px">' + esc(name) + '</div>' +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener" download style="color:#f59e0b;font-size:12px;font-weight:600">Download ↓</a>';
    document.body.appendChild(lb);
    lb.querySelector('button').addEventListener('click', function() { lb.remove(); });
    lb.addEventListener('click', function(e) { if (e.target === lb) lb.remove(); });
    var onEsc = function(e) { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
  }

  // ── All Jobs for Client Modal ──────────────────────────────────
  function openClientJobsModal(clientName) {
    if (!clientName) return;
    var clientJobs = _jobs
      .filter(function(j) { return (j.clientName || '').toLowerCase() === clientName.toLowerCase(); })
      .sort(urgencySort);

    var totalVal = clientJobs.reduce(function(s, j) { return s + (j.invoiceTotal || j.estimateValue || 0); }, 0);
    var rows = clientJobs.map(function(j) {
      return '<tr class="job-row" data-id="' + j.id + '">' +
        '<td>' + (j.label ? '<strong>' + esc(j.label) + '</strong><br><span class="muted small">' + esc(j.service || '') + '</span>' : esc(j.service || '—')) + '</td>' +
        '<td><span class="badge ' + STATUS_CLASSES[j.status || 'not_started'] + '">' + JOB_STATUSES[j.status || 'not_started'] + '</span></td>' +
        '<td class="muted small">' + (j.scheduledDate || '—') + '</td>' +
        '<td>' + (j.estimateValue ? fmt$(j.estimateValue) : '<span class="muted small">—</span>') + '</td>' +
        '<td>' + (j.invoiceNumber ? '<span class="badge ' + INV_CLASSES[j.invoiceStatus || 'draft'] + '">' + INV_LABELS[j.invoiceStatus || 'draft'] + '</span>' : '<span class="muted small">—</span>') + '</td>' +
        '<td class="muted small">' + ((j.fileCount || 0) > 0 ? '📎 ' + j.fileCount : '') + '</td>' +
      '</tr>';
    }).join('');

    var modal = openModal({
      title: 'All Jobs — ' + esc(clientName),
      body:
        '<div style="display:flex;gap:16px;margin-bottom:14px;align-items:center">' +
          '<div class="jobs-kpi-item"><div class="jobs-kpi-num">' + clientJobs.length + '</div><div class="jobs-kpi-sub">Total Jobs</div></div>' +
          '<div class="jobs-kpi-item"><div class="jobs-kpi-num">$' + Math.round(totalVal).toLocaleString() + '</div><div class="jobs-kpi-sub">Total Value</div></div>' +
          '<div class="jobs-kpi-item"><div class="jobs-kpi-num">' + clientJobs.filter(function(j) { return j.status !== 'completed'; }).length + '</div><div class="jobs-kpi-sub">Active</div></div>' +
        '</div>' +
        '<div class="table-wrap"><table class="data">' +
          '<thead><tr><th>Label / Service</th><th>Status</th><th>Scheduled</th><th>Value</th><th>Invoice</th><th>Files</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        '<div style="margin-top:14px">' +
          '<button class="btn btn-primary" id="cj-add">+ Add Another Job for ' + esc(clientName) + '</button>' +
        '</div>',
      footer: '<div style="flex:1"></div><button class="btn" id="cj-close">Close</button>',
    });
    modal.querySelector('#cj-close').addEventListener('click', closeModal);
    modal.querySelector('#cj-add').addEventListener('click', function() {
      closeModal();
      openCreateModal({ name: clientName });
    });
    modal.querySelectorAll('.job-row').forEach(function(tr) {
      tr.addEventListener('click', function() {
        var job = _jobs.find(function(x) { return x.id === tr.dataset.id; });
        if (job) { closeModal(); openDetail(job); }
      });
    });
  }

  // ── Edit Job Modal ─────────────────────────────────────────────
  function openEditModal(job) {
    var modal = openModal({
      title: 'Edit — ' + esc(job.clientName || 'Job'),
      body:
        '<label class="field-label">Job Label<input type="text" id="je-label" value="' + esc(job.label || '') + '"/></label>' +
        '<div class="grid-2">' +
          '<label class="field-label">Client Name<input type="text" id="je-name" value="' + esc(job.clientName || '') + '"/></label>' +
          '<label class="field-label">Service<input type="text" id="je-service" value="' + esc(job.service || '') + '"/></label>' +
          '<label class="field-label">Phone<input type="tel" id="je-phone" value="' + esc(job.clientPhone || '') + '"/></label>' +
          '<label class="field-label">Email<input type="email" id="je-email" value="' + esc(job.clientEmail || '') + '"/></label>' +
        '</div>' +
        '<label class="field-label">Address<input type="text" id="je-address" value="' + esc(job.address || '') + '"/></label>' +
        '<div class="grid-2">' +
          '<label class="field-label">Scheduled Date<input type="date" id="je-date" value="' + esc(job.scheduledDate || '') + '"/></label>' +
          '<label class="field-label">$ Estimate<input type="number" id="je-value" value="' + (job.estimateValue || '') + '" min="0" step="0.01"/></label>' +
        '</div>' +
        '<label class="field-label">Status' +
          '<select id="je-status" style="margin-top:4px;width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;font-size:13px;background:var(--surface)">' +
            STATUS_ORDER.map(function(s) { return '<option value="' + s + '"' + ((job.status || 'not_started') === s ? ' selected' : '') + '>' + JOB_STATUSES[s] + '</option>'; }).join('') +
          '</select>' +
        '</label>',
      footer: '<button class="btn" id="je-cancel">Cancel</button><button class="btn btn-primary" id="je-save">Save Changes</button>',
    });
    modal.querySelector('#je-cancel').addEventListener('click', closeModal);
    modal.querySelector('#je-save').addEventListener('click', function() {
      var u = {
        label:         modal.querySelector('#je-label').value.trim()    || null,
        clientName:    modal.querySelector('#je-name').value.trim()    || job.clientName,
        service:       modal.querySelector('#je-service').value.trim() || null,
        clientPhone:   modal.querySelector('#je-phone').value.trim()   || null,
        clientEmail:   modal.querySelector('#je-email').value.trim()   || null,
        address:       modal.querySelector('#je-address').value.trim() || null,
        scheduledDate: modal.querySelector('#je-date').value           || null,
        estimateValue: parseFloat(modal.querySelector('#je-value').value) || null,
        status:        modal.querySelector('#je-status').value,
        updatedAt:     ts(),
      };
      db().collection('jobs').doc(job.id).update(u).then(function() {
        Object.assign(job, u);
        toast('Saved', 'success'); closeModal();
      }).catch(function(e) { toast('Failed: ' + e.message, 'error'); });
    });
  }

  // ── Invoice helpers ────────────────────────────────────────────
  function buildLaborHtml(lines) {
    if (!lines.length) return '<div class="muted small" style="padding:4px 0">No labor lines yet. Add below.</div>';
    return '<table class="materials-table"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>' +
      '<tbody>' + lines.map(function(l, i) {
        return '<tr>' +
          '<td>' + esc(l.desc || '—') + '</td>' +
          '<td>' + l.qty + '</td>' +
          '<td>' + fmt$(l.rate) + '</td>' +
          '<td><strong>' + fmt$(l.amount) + '</strong></td>' +
          '<td><button class="mat-delete-btn" data-labor-idx="' + i + '">×</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function genInvoiceNumber() {
    return db().collection('jobs').where('invoiceNumber', '>=', 'SGC-').orderBy('invoiceNumber', 'desc').limit(1).get()
      .then(function(snap) {
        var next = 1001;
        snap.docs.forEach(function(d) {
          var n = parseInt((d.data().invoiceNumber || '').replace(/\D/g, ''), 10);
          if (!isNaN(n) && n >= next) next = n + 1;
        });
        return 'SGC-' + next;
      });
  }

  // ── CSV Export ─────────────────────────────────────────────────
  function exportCsv() {
    var hdr = ['ID','Label','Client','Phone','Email','Address','Service',
               'Status','Scheduled','Estimate','Invoice Total','Invoice #','Invoice Status','Source','Notes'];
    var rows = _jobs.map(function(j) {
      return [
        j.id, j.label || '', j.clientName || '', j.clientPhone || '', j.clientEmail || '',
        j.address || '', j.service || '', j.status || '', j.scheduledDate || '',
        j.estimateValue != null ? j.estimateValue : '', j.invoiceTotal != null ? j.invoiceTotal : '',
        j.invoiceNumber || '', j.invoiceStatus || '', j.source || '', (j.notes || '').replace(/\n/g, ' '),
      ];
    });
    var csv  = [hdr].concat(rows).map(function(r) {
      return r.map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'jobs-' + today() + '.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    mount:    mount,
    getJobs:  function() { return _jobs; },
    openFor:  function(record) { openCreateModal(record); },
  };

})();
