// Connects the page to the Google Apps Script web app (URL in config.js).
// It gives the page the same small data interface it uses elsewhere:
// db.collection(...).onSnapshot / add, db.doc(...).set / update / delete, user, downloads.
(function () {
  'use strict';
  const CONF = window.OM_CONFIG || {};
  const POLL_MS = 5000;
  let TOKEN = '', EXP = 0;
  try { const t = JSON.parse(localStorage.getItem('om_tok') || 'null'); if (t && t.exp > Date.now()) { TOKEN = t.token; EXP = t.exp; } } catch (_) {}

  function clearToken() { TOKEN = ''; EXP = 0; try { localStorage.removeItem('om_tok'); } catch (_) {} }

  async function api(action, payload) {
    if (!CONF.apiUrl) throw { code: 'no_api', message: 'ยังไม่ได้ตั้งค่า apiUrl ในไฟล์ config.js' };
    let res, j;
    try {
      res = await fetch(CONF.apiUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ action, token: TOKEN }, payload || {})) });
    } catch (e) { throw { code: 'network', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต' }; }
    try { j = await res.json(); } catch (e) { throw { code: 'network', message: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' }; }
    if (j && j.error) {
      if (j.error.code === 'auth') { clearToken(); window.dispatchEvent(new Event('app-auth-lost')); }
      throw j.error;
    }
    return j;
  }

  // ---------- local copy of the data ----------
  const D = { ver: 0, snapAt: -1, missions: [], versions: [], logs: [] };
  const subs = { missions: [], versions: [], logs: [] };
  const snap = (list) => ({ docs: list.map((o) => { const { id, ...rest } = o; return { id, exists: true, data: () => rest }; }), get size() { return list.length; }, get empty() { return !list.length; } });
  const emit = (c) => subs[c].forEach((s) => { try { s.next(snap(D[c])); } catch (_) {} });
  const fail = (c, e) => subs[c].forEach((s) => { try { s.err && s.err(e); } catch (_) {} });

  function setMissions(list, ver) { D.missions = list || []; if (ver) D.ver = ver; emit('missions'); }
  async function loadSnaps() { try { const r = await api('listSnaps'); D.versions = (r.list || []).map((v) => ({ ...v, by: '' })); emit('versions'); } catch (_) {} }
  async function loadLogs() { if (!subs.logs.length) return; try { const r = await api('listLogs', { limit: 200 }); D.logs = (r.list || []).map((l) => ({ ...l, by: '' })); emit('logs'); } catch (_) {} }

  let syncing = false, pending = 0, timer = null;
  async function sync() {
    if (!TOKEN || syncing || pending) return;
    syncing = true;
    try {
      const r = await api('sync', { ver: D.ver });
      if (r.missions && !pending) { setMissions(r.missions, r.ver); loadLogs(); }
      if (r.snapAt !== D.snapAt) { D.snapAt = r.snapAt; loadSnaps(); }
    } catch (e) { if (e && e.code !== 'auth' && !D.ver) fail('missions', e); }
    finally { syncing = false; }
  }
  function kick() { clearTimeout(timer); sync().finally(() => { timer = setTimeout(loop, POLL_MS); }); }
  function loop() { if (document.hidden) { timer = setTimeout(loop, POLL_MS); return; } kick(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && TOKEN) kick(); });

  // ---------- writes: one burst of actions goes to the server as one batch ----------
  let Q = [], Qp = null, renderT = null;
  function enqueue(op) { Q.push(op); if (!Qp) Qp = new Promise((r) => setTimeout(r, 60)).then(flush); return Qp; }
  async function flush() {
    const ops = Q; Q = []; Qp = null; if (!ops.length) return;
    pending++;
    try {
      const r = await api('write', { ops });
      if (r.missions && !Q.length) setMissions(r.missions, r.ver);
      else if (r.ver) D.ver = r.ver;
      clearTimeout(renderT); renderT = setTimeout(() => api('render').catch(() => {}), 4000);
      if (subs.logs.length) loadLogs();
      return r;
    } finally { pending--; }
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => { const o = { ...(a || {}) }; for (const k in b) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  function applyLocal(op) {
    const i = D.missions.findIndex((m) => m.id === op.id);
    if (op.op === 'delete') { if (i >= 0) D.missions.splice(i, 1); }
    else if (op.op === 'update') { if (i >= 0) D.missions[i] = merge(D.missions[i], op.data); }
    else { const o = { ...op.data, id: op.id }; if (i >= 0) D.missions[i] = o; else D.missions.push(o); }
    D.missions = D.missions.slice(); emit('missions');
  }
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function docRef(path) {
    const [c, id] = path.split('/');
    return {
      id,
      async set(data) { if (c !== 'missions') return; const op = { op: 'set', id, data: clone(data) }; applyLocal(op); await enqueue(op); },
      async update(data) { if (c !== 'missions') return; const op = { op: 'update', id, data: clone(data) }; applyLocal(op); await enqueue(op); },
      async delete() { if (c !== 'missions') return; const op = { op: 'delete', id }; applyLocal(op); await enqueue(op); },
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
        else if (D.ver || c === 'versions') setTimeout(() => next(snap(D[c])), 0);
        return () => { subs[c] = subs[c].filter((x) => x !== s); };
      },
      async add(data) {
        if (c === 'logs') { await enqueue({ op: 'log', data: clone(data) }); return { id: '' }; }
        if (c === 'versions') {
          const meta = { at: data.at, label: data.label };
          let xlsx = '', filename = '';
          try { if (window.__om) { xlsx = await blobToB64(window.__om.buildXLSX(data.rows || D.missions, meta)); filename = window.__om.baseName(meta); } } catch (_) {}
          await Qp; // send pending edits first
          const r = await api('save', { label: data.label, at: data.at, xlsx, filename });
          D.snapAt = -1; loadSnaps();
          return { id: r.snap && r.snap.id };
        }
        return { id: '' };
      },
    };
    return q;
  }

  const db = { collection: coll, doc: docRef };
  const user = { id: async () => '', can: async () => true, me: async () => null, profiles: async () => ({}) };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
  window.claude = { use: async (n) => ({ db, user, downloads })[n] || null };

  window.APP_AUTH = {
    async login(name, code) {
      const r = await api('login', { name, code });
      TOKEN = r.token; EXP = r.exp;
      try { localStorage.setItem('om_tok', JSON.stringify({ token: TOKEN, exp: EXP })); } catch (_) {}
      D.ver = 0; D.snapAt = -1; kick();
      return r;
    },
    logout() { clearToken(); },
    valid() { return !!TOKEN && EXP > Date.now(); },
  };
  if (TOKEN) kick(); else timer = setTimeout(loop, POLL_MS);
})();
