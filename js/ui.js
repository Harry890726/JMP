'use strict';
/* Window manager, popup menus, dialogs and platform launch dialogs. */

const WM = {
  z: 10, wins: [], active: null, cascade: 0,
  create({ title, kind = 'report', w = 640, h = 480, x, y, icon = '', onClose, onFocus, table }) {
    const ws = $('#workspace');
    const wr = ws.getBoundingClientRect();
    w = Math.min(w, Math.max(320, wr.width - 20)); h = Math.min(h, Math.max(240, wr.height - 20));
    if (x === undefined) { x = 20 + (this.cascade % 8) * 28; y = 14 + (this.cascade % 8) * 26; this.cascade++; }
    const win = el(`<div class="win ${kind}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <div class="win-title"><span class="win-icon">${icon}</span><span class="win-text"></span>
        <div class="win-btns"><button data-b="min" title="Minimize">&#8211;</button><button data-b="max" title="Maximize">&#9633;</button><button data-b="close" title="Close">&#10005;</button></div></div>
      <div class="win-body"></div><div class="win-resize"></div></div>`);
    ws.appendChild(win);
    const obj = {
      el: win, body: $('.win-body', win), kind, table, onClose, onFocus, title,
      setTitle(t) { this.title = t; $('.win-text', win).textContent = t; WM.refreshList(); },
      close() {
        if (this.onClose && this.onClose() === false) return;
        win.remove(); WM.wins = WM.wins.filter(w => w !== obj); if (WM.active === obj) WM.active = null; WM.refreshList();
      },
      focus() { WM.focus(obj); },
      minimize() { win.classList.add('minimized'); WM.refreshList(); },
    };
    obj.setTitle(title);
    this.wins.push(obj);
    win.addEventListener('pointerdown', () => this.focus(obj), true);
    $('.win-btns', win).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.b === 'close') obj.close();
      else if (b.dataset.b === 'min') obj.minimize();
      else win.classList.toggle('maximized');
    });
    $('.win-title', win).addEventListener('dblclick', e => { if (!e.target.closest('button')) win.classList.toggle('maximized'); });
    this.drag($('.win-title', win), win, 'move');
    this.drag($('.win-resize', win), win, 'resize');
    this.focus(obj);
    return obj;
  },
  drag(handle, win, mode) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button') || win.classList.contains('maximized')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop, ow = win.offsetWidth, oh = win.offsetHeight;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (mode === 'move') { win.style.left = Math.max(-ow + 80, ox + dx) + 'px'; win.style.top = Math.max(0, oy + dy) + 'px'; }
        else { win.style.width = Math.max(260, ow + dx) + 'px'; win.style.height = Math.max(160, oh + dy) + 'px'; }
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
  },
  focus(obj) {
    obj.el.classList.remove('minimized');
    if (this.active !== obj) {
      this.wins.forEach(w => w.el.classList.remove('active'));
      obj.el.classList.add('active');
      obj.el.style.zIndex = ++this.z;
      this.active = obj;
      if (obj.onFocus) obj.onFocus();
      this.refreshList();
    }
  },
  refreshList() {
    const list = $('#winlist'); if (!list) return;
    const tables = App.tables;
    let html = '';
    for (const t of tables) {
      const tw = this.wins.find(w => w.kind === 'table' && w.table === t);
      html += `<div class="wl-item wl-table ${tw && tw === this.active ? 'on' : ''}" data-win="${tw ? this.wins.indexOf(tw) : -1}">${ICONS.table}<span>${esc(t.name)}</span></div>`;
      for (const w of this.wins.filter(w => w.kind !== 'table' && w.table === t))
        html += `<div class="wl-item wl-sub ${w === this.active ? 'on' : ''} ${w.el.classList.contains('minimized') ? 'min' : ''}" data-win="${this.wins.indexOf(w)}">${ICONS.report}<span>${esc(w.title.replace(t.name + ' - ', ''))}</span></div>`;
    }
    for (const w of this.wins.filter(w => !w.table))
      html += `<div class="wl-item ${w === this.active ? 'on' : ''}" data-win="${this.wins.indexOf(w)}">${ICONS.home}<span>${esc(w.title)}</span></div>`;
    list.innerHTML = html || '<div class="wl-empty">No open windows</div>';
  },
  closeAll(pred = () => true) { [...this.wins].filter(pred).forEach(w => w.close()); },
  arrange(mode) {
    const ws = $('#workspace').getBoundingClientRect();
    const vis = this.wins.filter(w => !w.el.classList.contains('minimized'));
    vis.forEach((w, i) => {
      w.el.classList.remove('maximized');
      if (mode === 'cascade') Object.assign(w.el.style, { left: 20 + i * 28 + 'px', top: 14 + i * 26 + 'px' });
      else {
        const cols = Math.ceil(Math.sqrt(vis.length)), rows = Math.ceil(vis.length / cols);
        const cw = ws.width / cols, ch = ws.height / rows;
        Object.assign(w.el.style, { left: (i % cols) * cw + 'px', top: Math.floor(i / cols) * ch + 'px', width: cw - 4 + 'px', height: ch - 4 + 'px' });
      }
    });
  },
};

const ICONS = {
  table: '<svg class="ic" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" fill="#fff" stroke="#3a6fb5"/><path d="M1.5 5.5h13M5.5 2.5v11M10 2.5v11M1.5 8.5h13M1.5 11h13" stroke="#3a6fb5" stroke-width=".8"/></svg>',
  report: '<svg class="ic" viewBox="0 0 16 16"><rect x="2.5" y="1.5" width="11" height="13" fill="#fff" stroke="#777"/><rect x="4.5" y="9" width="1.8" height="4" fill="#2f6bc6"/><rect x="7.2" y="6" width="1.8" height="7" fill="#d9412b"/><rect x="9.9" y="7.5" width="1.8" height="5.5" fill="#2e9a3a"/></svg>',
  home: '<svg class="ic" viewBox="0 0 16 16"><path d="M2 8 L8 2.5 L14 8 M4 7v6.5h8V7" fill="none" stroke="#555" stroke-width="1.3"/></svg>',
};

const UI = {
  // ---------------- popup menus ----------------
  closeMenus(level = 0) { $$('.popmenu').forEach(m => { if (+m.dataset.level >= level) m.remove(); }); if (level === 0) $$('#menubar .mb.open').forEach(m => m.classList.remove('open')); },
  menu(items, x, y, level = 0, altX) {
    if (typeof items === 'function') items = items();
    UI.closeMenus(level);
    const m = document.createElement('div');
    m.className = 'popmenu'; m.dataset.level = level;
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { m.appendChild(el('<div class="msep"></div>')); continue; }
      const dis = typeof it.disabled === 'function' ? it.disabled() : it.disabled;
      const chk = typeof it.checked === 'function' ? it.checked() : it.checked;
      const d = el(`<div class="mi ${dis ? 'dis' : ''} ${it.submenu ? 'sub' : ''}"><span class="mchk">${chk ? '&#10003;' : ''}</span><span class="mlabel">${esc(it.label)}</span><span class="mkey">${esc(it.key || '')}</span><span class="marr">${it.submenu ? '&#9656;' : ''}</span></div>`);
      d.addEventListener('mouseenter', () => {
        UI.closeMenus(level + 1);
        $$('.mi.hl', m).forEach(x => x.classList.remove('hl'));
        d.classList.add('hl');
        if (it.submenu && !dis) { const r = d.getBoundingClientRect(); UI.menu(it.submenu, r.right - 2, r.top - 3, level + 1, r.left); }
      });
      d.addEventListener('click', e => {
        e.stopPropagation();
        if (dis || it.submenu) return;
        UI.closeMenus(0);
        if (it.action) setTimeout(() => it.action(), 0);
      });
      m.appendChild(d);
    }
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    if (x + r.width > innerWidth) x = Math.max(0, altX !== undefined ? altX - r.width + 2 : innerWidth - r.width - 4);
    if (y + r.height > innerHeight) y = Math.max(0, innerHeight - r.height - 4);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    return m;
  },

  // ---------------- dialogs ----------------
  dialog({ title, content, buttons = [{ label: 'OK', primary: true }], width = 420, onOpen, cls = '' }) {
    return new Promise(resolve => {
      const ov = el(`<div class="overlay"><div class="dlg ${cls}" style="width:${width}px"><div class="dlg-title"><span>${esc(title)}</span><button class="dlg-x">&#10005;</button></div><div class="dlg-body"></div><div class="dlg-btns"></div></div></div>`);
      const body = $('.dlg-body', ov);
      if (typeof content === 'string') body.innerHTML = content; else if (content) body.appendChild(content);
      const close = v => { ov.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const btns = $('.dlg-btns', ov);
      buttons.forEach(b => {
        const bt = el(`<button class="btn ${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`);
        bt.onclick = () => {
          const v = b.onClick ? b.onClick(body) : (b.value !== undefined ? b.value : b.label);
          if (v === false) return;
          close(v);
        };
        btns.appendChild(bt);
      });
      $('.dlg-x', ov).onclick = () => close(null);
      const key = e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
          const p = buttons.findIndex(b => b.primary); if (p >= 0) { e.preventDefault(); btns.children[p].click(); }
        }
      };
      document.addEventListener('keydown', key, true);
      document.body.appendChild(ov);
      WM.drag($('.dlg-title', ov), $('.dlg', ov), 'move');
      if (onOpen) onOpen(body, close);
      const f = $('input,select,textarea', body); if (f) setTimeout(() => f.focus(), 0);
    });
  },
  alert(msg, title = 'Alert') { return UI.dialog({ title, content: `<div class="msg">${msg}</div>`, buttons: [{ label: 'OK', primary: true }] }); },
  confirm(msg, title = 'Confirm') { return UI.dialog({ title, content: `<div class="msg">${msg}</div>`, buttons: [{ label: 'OK', primary: true, value: true }, { label: 'Cancel', value: false }] }); },
  fieldHTML(f) {
    const v = f.value ?? '';
    let input;
    if (f.type === 'select') input = `<select name="${f.key}">${f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
    else if (f.type === 'check') return `<label class="fchk"><input type="checkbox" name="${f.key}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    else if (f.type === 'checks') return `<div class="fgroup"><div class="flabel">${esc(f.label)}</div>${f.options.map(o => `<label class="fchk"><input type="checkbox" name="${f.key}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.key}" rows="${f.rows || 4}" spellcheck="false">${esc(v)}</textarea>`;
    else if (f.type === 'info') return `<div class="finfo">${f.html}</div>`;
    else input = `<input name="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" step="any" value="${esc(v)}">`;
    return `<label class="frow"><span class="flabel">${esc(f.label)}</span>${input}</label>`;
  },
  readFields(body, fields) {
    const out = {};
    for (const f of fields) {
      if (!f.key) continue;
      if (f.type === 'checks') { out[f.key] = $$(`[name="${f.key}"]`, body).filter(i => i.checked).map(i => i.value); continue; }
      const i = $(`[name="${f.key}"]`, body); if (!i) continue;
      out[f.key] = f.type === 'check' ? i.checked : f.type === 'number' ? (i.value === '' ? NaN : Number(i.value)) : i.value;
    }
    return out;
  },
  prompt(title, fields, { width = 380, okLabel = 'OK' } = {}) {
    return UI.dialog({
      title, width, content: `<div class="form">${fields.map(UI.fieldHTML).join('')}</div>`,
      buttons: [{ label: okLabel, primary: true, onClick: b => UI.readFields(b, fields) }, { label: 'Cancel', value: null }],
    });
  },

  // ---------------- launch dialog ----------------
  _recall: {},
  launch({ title, table, roles, params = [], recallKey, help }) {
    const t = table;
    const colLi = ci => `<li data-ci="${ci}" draggable="true">${typeIcon(t.columns[ci].modelingType)}<span>${esc(t.columns[ci].name)}</span></li>`;
    const content = el(`<div class="launch">
      <div class="lcol"><div class="lh">Select Columns</div><div class="lsub">${t.columns.length} Columns</div>
        <ul class="lcols">${t.columns.map((c, i) => colLi(i)).join('')}</ul></div>
      <div class="lroles"><div class="lh">Cast Selected Columns into Roles</div>
        ${roles.map(r => `<div class="lrole"><button class="rbtn" data-role="${r.key}">${esc(r.label)}</button><ul class="rbox" data-role="${r.key}" data-ph="${esc(r.hint || (r.required ? 'required' : 'optional'))}"></ul></div>`).join('')}
      </div>
      <div class="lact"><div class="lh">Action</div><button class="btn primary" data-a="ok">OK</button><button class="btn" data-a="cancel">Cancel</button><div style="height:14px"></div>
        <button class="btn" data-a="remove">Remove</button><button class="btn" data-a="recall">Recall</button>${help ? '<button class="btn" data-a="help">Help</button>' : ''}</div>
      ${params.length ? `<div class="lparams form">${params.map(UI.fieldHTML).join('')}</div>` : ''}
      ${help ? `<div class="lhelp" hidden>${help}</div>` : ''}
    </div>`);
    const list = $('.lcols', content);
    let anchor = null;
    list.addEventListener('click', e => {
      const li = e.target.closest('li'); if (!li) return;
      const all = $$('li', list);
      if (e.shiftKey && anchor) { const a = all.indexOf(anchor), b = all.indexOf(li); all.forEach((x, i) => x.classList.toggle('sel', i >= Math.min(a, b) && i <= Math.max(a, b))); }
      else if (e.ctrlKey || e.metaKey) li.classList.toggle('sel');
      else { all.forEach(x => x.classList.remove('sel')); li.classList.add('sel'); }
      if (!e.shiftKey) anchor = li;
    });
    const boxes = () => $$('.rbox', content);
    const roleOf = k => roles.find(r => r.key === k);
    const addTo = (key, cis) => {
      const box = $(`.rbox[data-role="${key}"]`, content); const role = roleOf(key);
      for (const ci of cis) {
        if ($$('li', box).some(l => +l.dataset.ci === ci)) continue;
        if (role.max && $$('li', box).length >= role.max) { if (role.max === 1) box.innerHTML = ''; else break; }
        if (role.types && !role.types.includes(t.columns[ci].modelingType)) {
          status(`${t.columns[ci].name} has modeling type ${t.columns[ci].modelingType}; ${role.label} expects ${role.types.join('/')}.`);
        }
        box.insertAdjacentHTML('beforeend', colLi(ci));
      }
    };
    list.addEventListener('dblclick', e => {
      const li = e.target.closest('li'); if (!li) return;
      const r = roles.find(r => !r.max || $$('li', $(`.rbox[data-role="${r.key}"]`, content)).length < r.max) || roles[0];
      addTo(r.key, [+li.dataset.ci]);
    });
    content.addEventListener('dragstart', e => { const li = e.target.closest('li[data-ci]'); if (!li) return; const sel = li.classList.contains('sel') ? $$('li.sel', list).map(l => +l.dataset.ci) : [+li.dataset.ci]; e.dataTransfer.setData('text/plain', 'cols:' + sel.join(',')); });
    boxes().forEach(b => {
      b.addEventListener('dragover', e => { e.preventDefault(); b.classList.add('over'); });
      b.addEventListener('dragleave', () => b.classList.remove('over'));
      b.addEventListener('drop', e => { e.preventDefault(); b.classList.remove('over'); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('cols:')) addTo(b.dataset.role, d.slice(5).split(',').map(Number)); });
      b.addEventListener('click', e => { const li = e.target.closest('li'); if (li) li.classList.toggle('sel'); });
      b.addEventListener('dblclick', e => { const li = e.target.closest('li'); if (li) li.remove(); });
    });
    $$('.rbtn', content).forEach(b => b.addEventListener('click', () => {
      const sel = $$('li.sel', list).map(l => +l.dataset.ci); addTo(b.dataset.role, sel);
      $$('li.sel', list).forEach(l => l.classList.remove('sel'));
    }));
    const recall = () => {
      const r = UI._recall[recallKey || title]; if (!r) return;
      boxes().forEach(b => b.innerHTML = '');
      for (const [k, names] of Object.entries(r)) addTo(k, names.map(n => t.colIndex(n)).filter(i => i >= 0));
    };
    return UI.dialog({
      title, width: params.length ? 640 : 620, cls: 'launchdlg', content, buttons: [],
      onOpen: (body, close) => {
        $('.lact', body).addEventListener('click', e => {
          const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
          if (a === 'cancel') close(null);
          else if (a === 'remove') $$('.rbox li.sel', body).forEach(l => l.remove());
          else if (a === 'recall') recall();
          else if (a === 'help') { const h = $('.lhelp', body); h.hidden = !h.hidden; }
          else if (a === 'ok') {
            const res = {};
            for (const r of roles) res[r.key] = $$(`.rbox[data-role="${r.key}"] li`, body).map(l => +l.dataset.ci);
            const miss = roles.find(r => r.required && !res[r.key].length);
            if (miss) { UI.alert(`Please specify at least one column for <b>${esc(miss.label)}</b>.`, 'Missing role'); return; }
            UI._recall[recallKey || title] = Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.map(ci => t.columns[ci].name)]));
            close({ roles: res, params: UI.readFields(body, params) });
          }
        });
        // preselect columns that are selected in the data table
        if (t.selCols.size) { const sel = [...t.selCols]; $$('li', list).forEach(l => l.classList.toggle('sel', sel.includes(+l.dataset.ci))); }
      },
    });
  },
};

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.popmenu') && !e.target.closest('#menubar .mb') && !e.target.closest('.hot')) UI.closeMenus(0);
});
