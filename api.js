// Connects the page to the Google Apps Script web app (URL in config.js).
// It gives the page the same small data interface it uses elsewhere:
// db.collection(...).onSnapshot / add, db.doc(...).set / update / delete, user, downloads.
(function () {
  'use strict';
  const CONF = window.OM_CONFIG || {};
  const POLL_MS = 5000;

  // The login of this browser (ระบบ Login กลาง ฝูง.602, repo eadmin, window.App). The page gets from the login system a
  // pass for this web (CONF.webCode) and sends it with every request; the Apps Script of this web asks the login system
  // whether it may go on, and as what (Admin / Editor edit, Viewer looks only). The session itself never goes there.
  const AUTH = window.App || null;
  function SESS() { const s = AUTH && AUTH.session(); return s ? s.token : ''; }
  let PASS = '', PASS_OF = '';
  function PASSV() { return PASS_OF && PASS_OF === SESS() ? PASS : ''; }
  async function getPass() {
    const s = SESS(); if (!s) return '';
    if (PASS_OF === s && PASS) return PASS;
    const r = await AUTH.enterWeb(CONF.webCode || '');
    PASS = r.pass || ''; PASS_OF = s; return PASS;
  }
  // who this is, from the Apps Script (which asked the login system): name = column ชื่อ-สกุล, role in this web, main admin or not
  let ME = null;
  function setMe(m) {
    if (!m) return;
    const next = { name: String(m.name || ''), role: String(m.role || ''), super: m.super === true };
    next.edit = next.role === 'Admin' || next.role === 'Editor';
    if (JSON.stringify(next) === JSON.stringify(ME)) return;
    ME = next; window.dispatchEvent(new Event('app-me'));
  }
  const say = (name, detail) => setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail })), 0);

  async function api(action, payload) {
    if (!CONF.apiUrl) throw { code: 'no_api', message: 'ยังไม่ได้ตั้งค่า apiUrl ในไฟล์ config.js' };
    let res, j;
    try {
      res = await fetch(CONF.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, pass: PASSV() }, payload || {})) });
    } catch (e) { throw { code: 'network', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต' }; }
    try { j = await res.json(); } catch (e) { throw { code: 'network', message: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' }; }
    if (j && j.error) {
      const c = j.error.code;
      // the login is over (its hour, the password changed, another device): the page asks the login system itself
      if (c === 'auth') say('app-auth-lost');
      // this account has no access to this web, or the web is closed, or config.js and the Apps Script disagree
      else if (c === 'no_web' || c === 'web_closed' || c === 'wrong_web') say('app-denied', j.error.message);
      // the Role in this web became Viewer
      else if (c === 'forbidden' && ME && ME.edit) { setMe({ name: ME.name, role: 'Viewer', super: ME.super }); say('app-toast', j.error.message); }
      throw j.error;
    }
    return j;
  }

  // ---------- local copy of the data ----------
  const D = { ver: 0, snapAt: -1, missions: [], versions: [], logs: [], settings: [], files: null };
  let curFy = null; // ปีงบที่ตารางกำลังแสดง (ตั้งโดยหน้าเว็บ)
  const subs = { missions: [], versions: [], logs: [], settings: [] };
  const snap = (list) => ({ docs: list.map((o) => { const { id, ...rest } = o; return { id, exists: true, data: () => rest }; }), get size() { return list.length; }, get empty() { return !list.length; } });
  const emit = (c) => subs[c].forEach((s) => { try { s.next(snap(D[c])); } catch (_) {} });
  const fail = (c, e) => subs[c].forEach((s) => { try { s.err && s.err(e); } catch (_) {} });

  // missions from every fiscal year's file, each tagged with _fy
  function setMissions(byFy, ver) {
    const all = [];
    Object.keys(byFy || {}).forEach((fy) => (byFy[fy] || []).forEach((m) => all.push({ ...m, _fy: Number(fy) })));
    D.missions = all; if (ver) D.ver = ver; emit('missions');
  }
  function setFiles(f) {
    const same = JSON.stringify(f) === JSON.stringify(D.files);
    D.files = f; if (!same) window.dispatchEvent(new Event('app-files'));
  }
  async function loadSnaps() { if (curFy == null) return; try { const r = await api('listSnaps', { fy: curFy }); D.versions = (r.list || []).map((v) => ({ ...v, by: '' })); emit('versions'); } catch (_) {} }
  async function loadLogs() { if (!subs.logs.length) return; if (curFy == null) return; try { const r = await api('listLogs', { fy: curFy, limit: 200 }); D.logs = (r.list || []).map((l) => ({ ...l, by: '' })); emit('logs'); } catch (_) {} }

  let syncing = false, pending = 0, timer = null;
  async function sync() {
    if (!PASSV() || syncing || pending) return;
    syncing = true;
    try {
      const r = await api('sync', { ver: D.ver });
      setMe(r.me);
      if (r.files) setFiles(r.files);
      if (r.missions && !pending) { D.settings = r.holidays ? [{ id: 'holidays', map: r.holidays }] : []; emit('settings'); setMissions(r.missions, r.ver); loadLogs(); }
      if (r.snapAt !== D.snapAt) { D.snapAt = r.snapAt; loadSnaps(); }
    } catch (e) { if (e && e.code !== 'auth' && !D.ver) fail('missions', e); }
    finally { syncing = false; }
  }
  function kick() { clearTimeout(timer); sync().finally(() => { timer = setTimeout(loop, POLL_MS); }); }
  function loop() { if (document.hidden) { timer = setTimeout(loop, POLL_MS); return; } kick(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && PASSV()) kick(); });

  // ---------- writes: one burst of actions goes to the server as one batch ----------
  let Q = [], Qp = null, renderT = null;
  function enqueue(op) { Q.push(op); if (!Qp) Qp = new Promise((r) => setTimeout(r, 60)).then(flush); return Qp; }
  async function flush() {
    const ops = Q; Q = []; Qp = null; if (!ops.length) return;
    pending++;
    try {
      const r = await api('write', { ops, fy: curFy });
      // missions may have moved to another fiscal year (by their dates): fetch the server copy now
      if (r.moved && r.moved.length) window.dispatchEvent(new CustomEvent('app-moved', { detail: r.moved }));
      setTimeout(kick, 0);
      clearTimeout(renderT); renderT = setTimeout(() => api('render').catch(() => {}), 4000);
      if (subs.logs.length) loadLogs();
      return r;
    } finally { pending--; }
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const k in b) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  const fyOfId = (id) => { const m = D.missions.find((x) => x.id === id); return m ? m._fy : curFy; };
  function applyLocal(op) {
    const i = D.missions.findIndex((m) => m.id === op.id);
    if (op.op === 'delete') { if (i >= 0) D.missions.splice(i, 1); }
    else if (op.op === 'update') { if (i >= 0) D.missions[i] = merge(D.missions[i], op.data); }
    else { const o = { ...op.data, id: op.id, _fy: op.fy }; if (i >= 0) D.missions[i] = o; else D.missions.push(o); }
    D.missions = D.missions.slice(); emit('missions');
  }
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function docRef(path) {
    const [c, id] = path.split('/');
    return {
      id,
      async set(data) {
        if (c === 'settings' && id === 'holidays') {
          D.settings = [{ id: 'holidays', map: data.map || {} }]; emit('settings');
          await Qp; await api('setHolidays', { map: data.map || {} }); setTimeout(kick, 0); return;
        }
        if (c !== 'missions') return; const d = clone(data); const fy = d._fy || curFy; delete d._fy; const op = { op: 'set', id, fy, data: d }; applyLocal(op); await enqueue(op); },
      async update(data) { if (c !== 'missions') return; const d = clone(data); delete d._fy; const op = { op: 'update', id, fy: fyOfId(id), data: d }; applyLocal(op); await enqueue(op); },
      async delete() { if (c !== 'missions') return; const op = { op: 'delete', id, fy: fyOfId(id) }; applyLocal(op); await enqueue(op); },
    };
  }
  function blobToB64(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  function coll(c) {
    const q = {
      orderBy() { return q; }, limit() { return q; },
      doc(id) { return docRef(c + '/' + (id || uid())); },
      onSnapshot(next, err) {
        const s = { next, err }; subs[c].push(s);
        if (c === 'logs') loadLogs();
        else if (D.ver || c === 'versions' || c === 'settings') setTimeout(() => next(snap(D[c])), 0);
        return () => { subs[c] = subs[c].filter((x) => x !== s); };
      },
      async add(data) {
        if (c === 'logs') { await enqueue({ op: 'log', fy: curFy, data: clone(data) }); return { id: '' }; }
        if (c === 'versions') {
          const meta = { at: data.at, label: data.label };
          let xlsx = '', filename = '';
          try { if (window.__om) { xlsx = await blobToB64(window.__om.buildXLSX(data.rows || [], meta)); filename = window.__om.baseName(meta); } } catch (_) {}
          await Qp; // send pending edits first
          const r = await api('save', { fy: curFy, label: data.label, at: data.at, xlsx, filename });
          D.snapAt = -1; loadSnaps();
          return { id: r.snap && r.snap.id };
        }
        return { id: '' };
      },
    };
    return q;
  }

  const db = { collection: coll, doc: docRef };
  const user = { id: async () => '', can: async () => !!(ME && ME.edit), me: async () => null, profiles: async () => ({}) };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
  window.claude = { use: async (n) => ({ db, user, downloads })[n] || null };

  window.APP_AUTH = {
    // the pass for this web, then who this is (sync answers with me); the first data comes with it
    async start() {
      PASS_OF = '';
      await getPass();
      D.ver = 0; D.snapAt = -1; clearTimeout(timer);
      await sync();
      clearTimeout(timer); timer = setTimeout(loop, POLL_MS);
      return ME;
    },
    // after the login was found over: a fresh pass (the login system sends the browser to the login page if it is really over)
    async renew() { PASS_OF = ''; await getPass(); kick(); },
    me: () => ME,
    // EXPORT TO PDF / EXCEL: into the history of the fiscal year shown, with the name of the account (Admin / Editor)
    exported(kind, filename) { return api('exported', { kind, filename, fy: curFy }).catch(() => {}); },
  };

  // fiscal-year files: which years have links, which year the table shows, pasting next year's links
  window.APP_FILES = {
    files: () => D.files,
    fy: () => curFy,
    setFy(fy) { if (fy === curFy) return; curFy = fy; D.versions = []; emit('versions'); D.snapAt = -1; loadSnaps(); loadLogs(); },
    async set(fy, src, disp, admin) {
      const r = await api('setFiles', { fy, src, disp, admin });
      setFiles(r.files); D.ver = 0; kick();
      return r;
    },
  };
  timer = setTimeout(loop, POLL_MS);
})();
