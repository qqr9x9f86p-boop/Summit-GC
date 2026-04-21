/* ============================================================
 * calendar.js — Monthly calendar for M.A.Y.A CRM
 * Exposes: window.CALENDAR
 * ============================================================ */

window.CALENDAR = (function () {

  const db = () => window.fbDb;
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();

  function esc(s) {
    return String(s??'').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ── US Holidays ──────────────────────────────────────────────
  function nthWeekday(year, month, dow, n) {
    if (n > 0) {
      const d = new Date(year, month, 1);
      while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
      d.setDate(d.getDate() + (n - 1) * 7);
      return d.getDate();
    }
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
    return d.getDate();
  }

  function buildHolidays(year) {
    const h = {};
    const add = (m, d, name) => {
      h[`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = name;
    };
    add(1,  1,  "New Year's Day");
    add(1,  nthWeekday(year, 0, 1, 3),  "MLK Day");
    add(2,  nthWeekday(year, 1, 1, 3),  "Presidents Day");
    add(5,  nthWeekday(year, 4, 1, -1), "Memorial Day");
    add(6,  19, "Juneteenth");
    add(7,  4,  "Independence Day");
    add(9,  nthWeekday(year, 8, 1, 1),  "Labor Day");
    add(10, 31, "Halloween");
    add(11, 11, "Veterans Day");
    add(11, nthWeekday(year, 10, 4, 4), "Thanksgiving");
    add(12, 24, "Christmas Eve");
    add(12, 25, "Christmas Day");
    add(12, 31, "New Year's Eve");
    return h;
  }

  // ── State ─────────────────────────────────────────────────────
  let _root = null;
  let _year  = new Date().getFullYear();
  let _month = new Date().getMonth();
  let _selected = new Date().toISOString().split('T')[0];
  let _events = [];   // from calendar_events collection
  let _auto   = [];   // derived from sgc_records + jobs
  let _unsub  = null;

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const TYPE_COLOR = {
    call:      '#b8864e',
    callback:  '#f59e0b',
    event:     '#6366f1',
    crm:       '#16a34a',
    job:       '#0ea5e9',
    holiday:   '#dc2626',
  };

  // ── Mount ─────────────────────────────────────────────────────
  function mount(rootEl) {
    _root = rootEl;
    _selected = new Date().toISOString().split('T')[0];
    if (_unsub) _unsub();
    _unsub = db().collection('calendar_events').orderBy('date').onSnapshot(snap => {
      _events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (_root?.querySelector('#cal-grid')) { renderGrid(); renderSidebar(); }
    }, () => {});
    loadAuto();
    renderShell();
  }

  async function loadAuto() {
    _auto = [];
    try {
      const [recordsSnap, jobsSnap] = await Promise.all([
        db().collection('sgc_records').get(),
        db().collection('jobs').get(),
      ]);
      recordsSnap.docs.forEach(d => {
        const r = d.data();
        if (r.followUpDate) _auto.push({
          date: r.followUpDate,
          title: `Follow-up: ${r.name||'Lead'}`,
          type: 'crm', _auto: true,
        });
      });
      jobsSnap.docs.forEach(d => {
        const r = d.data();
        if (r.scheduledDate) _auto.push({
          date: r.scheduledDate,
          title: `Job: ${r.clientName||'Job'}${r.label ? ' — ' + r.label : ''}`,
          type: 'job', _auto: true,
        });
      });
    } catch { /* non-fatal */ }
    if (_root?.querySelector('#cal-grid')) { renderGrid(); renderSidebar(); }
  }

  // ── Shell ──────────────────────────────────────────────────────
  function renderShell() {
    _root.innerHTML = `
      <div class="cal-layout">
        <div class="cal-main">
          <div class="cal-header">
            <button class="icon-btn" id="cal-prev">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <span class="cal-month-label" id="cal-month-label"></span>
            <button class="icon-btn" id="cal-next">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <button class="btn btn-sm" id="cal-today-btn" style="margin-left:10px">Today</button>
            <button class="btn btn-primary btn-sm" style="margin-left:auto" id="cal-add-btn">+ Add Event</button>
          </div>
          <div class="cal-dow-row">${DAYS.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
          <div class="cal-grid" id="cal-grid"></div>
        </div>
        <div class="cal-sidebar" id="cal-sidebar"></div>
      </div>`;

    _root.querySelector('#cal-prev').addEventListener('click', () => {
      _month--; if (_month < 0) { _month = 11; _year--; }
      renderGrid(); renderSidebar();
    });
    _root.querySelector('#cal-next').addEventListener('click', () => {
      _month++; if (_month > 11) { _month = 0; _year++; }
      renderGrid(); renderSidebar();
    });
    _root.querySelector('#cal-today-btn').addEventListener('click', () => {
      _year = new Date().getFullYear(); _month = new Date().getMonth();
      _selected = new Date().toISOString().split('T')[0];
      renderGrid(); renderSidebar();
    });
    _root.querySelector('#cal-add-btn').addEventListener('click', () => openAddModal(_selected));
    renderGrid();
    renderSidebar();
  }

  // ── Grid ──────────────────────────────────────────────────────
  function renderGrid() {
    const grid = _root?.querySelector('#cal-grid');
    const lbl  = _root?.querySelector('#cal-month-label');
    if (!grid) return;
    if (lbl) lbl.textContent = `${MONTHS[_month]} ${_year}`;

    const today    = new Date().toISOString().split('T')[0];
    const holidays = { ...buildHolidays(_year), ...buildHolidays(_year + 1) };

    const byDate = {};
    const push = (date, ev) => { (byDate[date] = byDate[date]||[]).push(ev); };
    [..._events, ..._auto].forEach(e => push(e.date, e));
    Object.entries(holidays).forEach(([date, name]) => push(date, { date, title: name, type: 'holiday', _auto: true }));

    const firstDow   = new Date(_year, _month, 1).getDay();
    const daysInMo   = new Date(_year, _month + 1, 0).getDate();
    const prevDays   = new Date(_year, _month, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMo) / 7) * 7;

    let html = '';
    for (let i = 0; i < totalCells; i++) {
      let day, dateStr, inMonth;
      if (i < firstDow) {
        day = prevDays - firstDow + i + 1;
        const pm = _month === 0 ? 12 : _month, py = _month === 0 ? _year - 1 : _year;
        dateStr = `${py}-${String(pm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        inMonth = false;
      } else if (i < firstDow + daysInMo) {
        day = i - firstDow + 1;
        dateStr = `${_year}-${String(_month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        inMonth = true;
      } else {
        day = i - firstDow - daysInMo + 1;
        const nm = _month === 11 ? 1 : _month + 2, ny = _month === 11 ? _year + 1 : _year;
        dateStr = `${ny}-${String(nm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        inMonth = false;
      }

      const isToday  = dateStr === today;
      const isSel    = dateStr === _selected;
      const dayEvs   = byDate[dateStr] || [];
      const visible  = dayEvs.slice(0, 3);
      const overflow = dayEvs.length - 3;

      html += `<div class="cal-day${inMonth?'':' other-month'}${isToday?' today':''}${isSel?' selected':''}" data-date="${dateStr}">
        <div class="cal-day-num">${isToday ? `<span class="cal-today-num">${day}</span>` : day}</div>
        ${visible.map(e =>
          `<div class="cal-chip" style="background:${TYPE_COLOR[e.type]||'#6366f1'}1a;border-left:2px solid ${TYPE_COLOR[e.type]||'#6366f1'}" title="${esc(e.title)}">${esc(e.title)}</div>`
        ).join('')}
        ${overflow > 0 ? `<div class="cal-chip-more">+${overflow} more</div>` : ''}
      </div>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day').forEach(cell => {
      cell.addEventListener('click', () => {
        _selected = cell.dataset.date;
        grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        renderSidebar();
      });
      cell.addEventListener('dblclick', e => { e.stopPropagation(); openAddModal(cell.dataset.date); });
    });
  }

  // ── Sidebar ───────────────────────────────────────────────────
  function renderSidebar() {
    const sb = _root?.querySelector('#cal-sidebar');
    if (!sb) return;

    const today    = new Date().toISOString().split('T')[0];
    const selDate  = _selected || today;
    const holidays = { ...buildHolidays(_year), ...buildHolidays(_year + 1) };

    const onDay = (date) => {
      const evs = [..._events.filter(e => e.date === date), ..._auto.filter(e => e.date === date)];
      if (holidays[date]) evs.unshift({ date, title: holidays[date], type: 'holiday', _auto: true });
      return evs;
    };

    const dayLabel = (ds) => {
      if (ds === today) return 'Today';
      const [y,m,d] = ds.split('-');
      return new Date(y, m-1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const evChip = (e) => `
      <div class="cal-sb-ev" style="border-left:3px solid ${TYPE_COLOR[e.type]||'#6366f1'}">
        <div class="cal-sb-ev-title">${esc(e.title)}</div>
        ${e.notes ? `<div class="muted small">${esc(e.notes)}</div>` : ''}
        ${!e._auto ? `<button class="cal-sb-del" data-id="${e.id}" title="Remove">×</button>` : ''}
      </div>`;

    const upcoming = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const evs = onDay(ds);
      if (evs.length) upcoming.push({ date: ds, evs });
    }

    const selEvs = onDay(selDate);

    sb.innerHTML = `
      <div class="cal-sb-head">${dayLabel(selDate)}</div>
      <div class="cal-sb-evlist">
        ${selEvs.length
          ? selEvs.map(evChip).join('')
          : '<div class="muted small" style="padding:6px 0">No events. Double-click a day to add.</div>'}
      </div>
      <button class="btn btn-sm" id="sb-add-btn" style="width:100%;margin-top:8px">+ Add Event</button>

      <div class="cal-sb-head" style="margin-top:20px">Upcoming (14 days)</div>
      <div class="cal-sb-upcoming">
        ${upcoming.length
          ? upcoming.map(u => `
            <div class="cal-sb-upcoming-row">
              <div class="cal-sb-upcoming-date muted small">${dayLabel(u.date)}</div>
              ${u.evs.map(e => `<div class="cal-sb-ev-mini" style="border-left:2px solid ${TYPE_COLOR[e.type]||'#6366f1'}">${esc(e.title)}</div>`).join('')}
            </div>`).join('')
          : '<div class="muted small" style="padding:6px 0">Nothing in next 14 days.</div>'}
      </div>

      <div class="cal-sb-legend">
        ${Object.entries({ call:'Call', callback:'Callback', event:'Custom Event', crm:'CRM Follow-up', job:'Job Scheduled' }).map(([t, l]) =>
          `<div class="cal-legend-row"><span class="cal-legend-dot" style="background:${TYPE_COLOR[t]}"></span>${l}</div>`
        ).join('')}
      </div>`;

    sb.querySelector('#sb-add-btn').addEventListener('click', () => openAddModal(selDate));
    sb.querySelectorAll('.cal-sb-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await db().collection('calendar_events').doc(btn.dataset.id).delete();
      });
    });
  }

  // ── Add event modal ───────────────────────────────────────────
  function openAddModal(date) {
    const [y,m,d] = date.split('-');
    const display = new Date(y, m-1, d).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    const modal = openModal({
      title: 'Add Event',
      body: `
        <p class="muted small" style="margin-bottom:12px">${esc(display)}</p>
        <label class="field-label">Title *<input type="text" id="cev-title" placeholder="Call, site visit, follow-up…"/></label>
        <label class="field-label">Type
          <select id="cev-type" style="margin-top:4px;width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font:inherit;font-size:13px;background:var(--surface)">
            <option value="call">Call</option>
            <option value="callback">Callback</option>
            <option value="event">Custom Event</option>
          </select>
        </label>
        <label class="field-label">Notes<textarea id="cev-notes" style="min-height:56px" placeholder="Optional…"></textarea></label>`,
      footer: `<button class="btn" id="cev-cancel">Cancel</button><button class="btn btn-primary" id="cev-save">Add</button>`,
    });
    setTimeout(() => modal.querySelector('#cev-title')?.focus(), 50);
    modal.querySelector('#cev-cancel').addEventListener('click', closeModal);
    modal.querySelector('#cev-save').addEventListener('click', async () => {
      const title = modal.querySelector('#cev-title').value.trim();
      if (!title) { toast('Title is required', 'error'); return; }
      try {
        await db().collection('calendar_events').add({
          title,
          date,
          type:  modal.querySelector('#cev-type').value,
          notes: modal.querySelector('#cev-notes').value.trim() || null,
          createdAt: ts(),
        });
        closeModal();
        toast('Event added', 'success');
        loadAuto();
      } catch (e) { toast('Failed: ' + e.message, 'error'); }
    });
  }

  return { mount };
})();
