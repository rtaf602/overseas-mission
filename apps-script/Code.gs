/**
 * ภารกิจต่างประเทศ ฝูง.602 – backend (Google Apps Script)
 * ------------------------------------------------------------
 * วางไฟล์นี้ใน Apps Script ของไฟล์ "รวมภารกิจต่างประเทศ ปีงบ70_ต้นทาง"
 * (Extensions > Apps Script) แล้วรัน setup() หนึ่งครั้ง จากนั้น Deploy เป็น Web app
 *
 * - ข้อมูลจริงเก็บในไฟล์ "ต้นทาง" (แท็บ missions, logs, snapshots)
 * - ไฟล์ "แสดงผล" ถูกวาดใหม่จากข้อมูลต้นทางหลังทุกการแก้ไข (อ่านอย่างเดียว)
 * - กด "บันทึกฉบับ" แล้วเก็บไฟล์ Excel ในโฟลเดอร์ Backup ไว้ 20 ไฟล์ล่าสุด
 */

const CFG = {
  SOURCE_ID: '1-UUsKGb9GCHs0PkdQK9t9TfIU7NY9L8xSBG9zRbx9rE',      // รวมภารกิจต่างประเทศ ปีงบ70_ต้นทาง
  DISPLAY_ID: '1TuvHy3uBUfKisQM6LfbwDW1F1s2du9D6NiDg1lQTkds',     // รวมภารกิจต่างประเทศ_แสดงผล
  BACKUP_FOLDER_ID: '1TCrfUJcOVO5Tu61eKnV3w_AYxYwHywp7',          // รวมภารกิจต่างประเทศ Backup
  DEFAULT_CODE: 'operation.slide',   // รหัสเปิดใช้งานเริ่มต้น (เปลี่ยนได้ด้วย setAccessCode)
  KEEP_BACKUPS: 20,
  KEEP_SNAPS: 20,
  SESSION_SEC: 3600,                 // ใส่รหัสแล้วใช้ได้ 1 ชั่วโมง
  LOG_DAYS: 365,
  TZ: 'Asia/Bangkok',
  TITLE: 'ภารกิจต่างประเทศ ฝูง.602 บน.6 ปีงบประมาณ 70',
  DISPLAY_SHEET: '70',
  BACKUP_TAG: 'ภารกิจต่างประเทศปี'   // ชื่อไฟล์ Backup ที่ระบบสร้าง มีคำนี้อยู่
};

const M_COLS = ['id', 'order', 'no', 'callsign', 'mission', 'route', 'aircraft', 'stby_aircraft', 'pax', 'owner', 'dates', 'start', 'end',
  'status', 'note', 'ranges', 'dateTbc', 'tbcColor', 'fmt', 'updatedAt', 'updatedByName', 'extra'];
const M_NUM = { order: 1, no: 1 };
const M_JSON = { ranges: 1, fmt: 1 };
const M_BOOL = { dateTbc: 1 };
const LOG_HEAD = ['at', 'time', 'by', 'action', 'mission', 'detail', 'json'];
const SNAP_HEAD = ['id', 'at', 'label', 'by', 'data'];

/* =========================== HTTP =========================== */

function doGet() {
  return json_({ ok: true, app: 'overseas-mission', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[req.action];
    if (!fn) throw err_('bad_action', 'ไม่รู้จักคำสั่ง ' + req.action);
    const sess = req.action === 'login' ? null : auth_(req.token);
    return json_(fn(req, sess) || { ok: true });
  } catch (x) {
    return json_({ error: { code: (x && x.code) || 'server', message: (x && x.message) || String(x) } });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message) { const e = new Error(message); e.code = code; return e; }

/* =========================== API =========================== */

const API = {
  login: function (r) {
    const name = String(r.name || '').trim().slice(0, 60);
    if (!name) throw err_('no_name', 'กรุณาใส่ชื่อผู้ใช้งาน');
    const want = PropertiesService.getScriptProperties().getProperty('CODE_HASH') || sha256_(CFG.DEFAULT_CODE);
    if (sha256_(String(r.code || '').trim()) !== want) { Utilities.sleep(700); throw err_('bad_code', 'รหัสไม่ถูกต้อง'); }
    const token = Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('tok:' + token, JSON.stringify({ name: name }), CFG.SESSION_SEC);
    return { token: token, name: name, exp: Date.now() + CFG.SESSION_SEC * 1000 };
  },

  // ส่งข้อมูลกลับเฉพาะเมื่อมีการเปลี่ยนแปลงหลังเวอร์ชันที่หน้าเว็บถืออยู่
  sync: function (r) {
    const v = ver_(), out = { ver: v, snapAt: Number(prop_('SNAP_AT') || 0) };
    if (Number(r.ver) !== v) out.missions = readMissions_();
    return out;
  },

  write: function (r, s) {
    return withLock_(function () {
      const map = {};
      readMissions_().forEach(function (m) { map[m.id] = m; });
      const logs = [];
      let changed = false;
      (r.ops || []).forEach(function (o) {
        if (o.op === 'log') { logs.push(logRow_(o.data || {}, s.name)); return; }
        const id = String(o.id || '');
        if (!/^[A-Za-z0-9_\-]{1,60}$/.test(id)) throw err_('bad_id', 'รหัสภารกิจไม่ถูกต้อง');
        if (o.op === 'delete') delete map[id];
        else if (o.op === 'update') { if (map[id]) map[id] = merge_(map[id], o.data || {}); }
        else map[id] = Object.assign({}, o.data || {}, { id: id });
        if (map[id] && o.op !== 'delete') map[id].updatedByName = s.name;
        changed = true;
      });
      if (changed) writeMissions_(objValues_(map));
      if (logs.length) appendLogs_(logs);
      const v = changed ? bump_() : ver_();
      return { ok: true, ver: v, missions: changed ? readMissions_() : undefined };
    });
  },

  save: function (r, s) {
    return withLock_(function () {
      const at = String(r.at || new Date().toISOString());
      const snap = { id: 'v' + Date.now(), at: at, label: String(r.label || '').slice(0, 120), by: s.name };
      snapAppend_(snap, readMissions_());
      snapPrune_();
      let file = null;
      if (r.xlsx) file = backupExcel_(String(r.filename || ('backup_' + Date.now())) + '.xlsx', r.xlsx);
      PropertiesService.getScriptProperties().setProperty('SNAP_AT', String(Date.now()));
      return { ok: true, snap: snap, backup: file };
    });
  },

  listSnaps: function () {
    return { list: snapList_() };
  },

  listLogs: function (r) {
    return { list: logsList_(Math.min(1000, Number(r.limit) || 200)) };
  },

  render: function () {
    const l = LockService.getScriptLock();
    if (!l.tryLock(1000)) { setDirty_(true); return { ok: false, queued: true }; }
    try { renderDisplay_(); } finally { l.releaseLock(); }
    return { ok: true };
  }
};

/* =========================== helpers =========================== */

function auth_(token) {
  const raw = token && CacheService.getScriptCache().get('tok:' + token);
  if (!raw) throw err_('auth', 'หมดเวลาใช้งาน กรุณาใส่รหัสใหม่');
  return JSON.parse(raw);
}
function sha256_(t) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, t, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function withLock_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(20000)) throw err_('busy', 'ระบบกำลังทำงาน ลองใหม่อีกครั้ง');
  try { return fn(); } finally { l.releaseLock(); }
}
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function ver_() { return Number(prop_('VER') || '1'); }
function bump_() {
  const v = ver_() + 1;
  PropertiesService.getScriptProperties().setProperty('VER', String(v));
  setDirty_(true);
  return v;
}
function setDirty_(on) { PropertiesService.getScriptProperties().setProperty('DISPLAY_DIRTY', on ? '1' : '0'); }
function objValues_(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
function isObj_(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge_(a, b) {
  const o = Object.assign({}, a);
  Object.keys(b).forEach(function (k) { o[k] = isObj_(b[k]) && isObj_(o[k]) ? merge_(o[k], b[k]) : b[k]; });
  return o;
}

function src_() { return SpreadsheetApp.openById(CFG.SOURCE_ID); }
function sheet_(name, header) {
  const ss = src_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#D6DCE4');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@');
  }
  return sh;
}
function rewrite_(sh, rows) {
  const w = rows[0].length, old = sh.getLastRow();
  if (old > rows.length) sh.getRange(rows.length + 1, 1, old - rows.length, Math.max(w, sh.getLastColumn())).clearContent();
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  sh.getRange(1, 1, rows.length, w).setNumberFormat('@').setValues(rows);
}

/* =========================== missions (แท็บ missions ในไฟล์ต้นทาง) =========================== */

function readMissions_() {
  const cache = CacheService.getScriptCache(), key = 'missions:' + ver_();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const vals = sheet_('missions', M_COLS).getDataRange().getValues();
  const head = vals[0].map(String), out = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i], o = {};
    head.forEach(function (k, j) {
      let v = row[j];
      if (k === 'extra') return;
      if (M_NUM[k]) { if (v === '' || v == null) return; v = Number(v); }
      else if (M_JSON[k]) { try { v = v ? JSON.parse(v) : (k === 'fmt' ? {} : []); } catch (x) { v = k === 'fmt' ? {} : []; } }
      else if (M_BOOL[k]) v = v === true || String(v).toLowerCase() === 'true';
      else v = v == null ? '' : String(v);
      o[k] = v;
    });
    const ix = head.indexOf('extra');
    if (ix >= 0 && row[ix]) { try { Object.assign(o, JSON.parse(row[ix])); } catch (x) { } }
    if (o.id) out.push(o);
  }
  try { cache.put(key, JSON.stringify(out), 600); } catch (x) { /* too large to cache */ }
  return out;
}

function writeMissions_(list) {
  list.sort(function (a, b) { return (Number(a.order) || 1e6) - (Number(b.order) || 1e6) || String(a.id).localeCompare(String(b.id)); });
  const rows = [M_COLS].concat(list.map(function (m) {
    const extra = {};
    Object.keys(m).forEach(function (k) { if (M_COLS.indexOf(k) < 0) extra[k] = m[k]; });
    return M_COLS.map(function (k) {
      if (k === 'extra') return Object.keys(extra).length ? JSON.stringify(extra) : '';
      const v = m[k];
      if (M_JSON[k]) return v == null ? '' : JSON.stringify(v);
      if (M_BOOL[k]) return v ? 'TRUE' : 'FALSE';
      return v == null ? '' : String(v);
    });
  }));
  rewrite_(sheet_('missions', M_COLS), rows);
}

/* =========================== logs =========================== */

function logRow_(d, name) {
  const at = Date.now();
  const e = Object.assign({}, d, { byName: name, at: new Date(at).toISOString() });
  delete e.by;
  const detail = [d.field || '', d.from != null ? String(d.from) : '', d.to != null ? '→ ' + String(d.to) : '', d.label || ''].filter(String).join(' ');
  return [String(at), Utilities.formatDate(new Date(at), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'), name, String(d.action || ''), String(d.mission || ''), detail.slice(0, 500), JSON.stringify(e).slice(0, 4000)];
}
function appendLogs_(rows) {
  const sh = sheet_('logs', LOG_HEAD);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length).setNumberFormat('@').setValues(rows);
}
function logsList_(n) {
  const sh = sheet_('logs', LOG_HEAD);
  const last = sh.getLastRow(); if (last < 2) return [];
  const from = Math.max(2, last - n + 1);
  return sh.getRange(from, 1, last - from + 1, LOG_HEAD.length).getValues().reverse().map(function (r, i) {
    let o = {}; try { o = JSON.parse(r[6]); } catch (x) { o = { action: String(r[3]), byName: String(r[2]) }; }
    o.id = 'l' + r[0] + '_' + i;
    return o;
  });
}
function pruneLogs() {
  const sh = sheet_('logs', LOG_HEAD);
  const last = sh.getLastRow(); if (last < 2) return;
  const lim = Date.now() - CFG.LOG_DAYS * 864e5;
  const col = sh.getRange(2, 1, last - 1, 1).getValues();
  let n = 0; while (n < col.length && Number(col[n][0]) < lim) n++;
  if (n) sh.deleteRows(2, n);
}

/* =========================== snapshots (ฉบับที่บันทึก) =========================== */

const CHUNK = 45000;
function snapSheet_() { return sheet_('snapshots', SNAP_HEAD); }
function snapAppend_(meta, rows) {
  const sh = snapSheet_();
  const js = JSON.stringify(rows), parts = [];
  for (let i = 0; i < js.length; i += CHUNK) parts.push(js.slice(i, i + CHUNK));
  const row = [meta.id, meta.at, meta.label, meta.by].concat(parts);
  if (sh.getMaxColumns() < row.length) sh.insertColumnsAfter(sh.getMaxColumns(), row.length - sh.getMaxColumns());
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}
function snapRows_() {
  const sh = snapSheet_(); const last = sh.getLastRow(); if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, Math.max(5, sh.getLastColumn())).getValues()
    .map(function (r, i) { return { row: i + 2, r: r }; })
    .sort(function (a, b) { return String(b.r[1]).localeCompare(String(a.r[1])); });
}
function snapList_() {
  return snapRows_().slice(0, CFG.KEEP_SNAPS).map(function (x) {
    let rows = []; try { rows = JSON.parse(x.r.slice(4).join('')); } catch (e) { }
    return { id: String(x.r[0]), at: String(x.r[1]), label: String(x.r[2]), byName: String(x.r[3]), rows: rows };
  });
}
function snapPrune_() {
  const sh = snapSheet_();
  snapRows_().slice(CFG.KEEP_SNAPS).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; })
    .forEach(function (r) { sh.deleteRow(r); });
}

/* =========================== Excel backup =========================== */

function backupExcel_(filename, b64) {
  const folder = DriveApp.getFolderById(CFG.BACKUP_FOLDER_ID);
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), MimeType.MICROSOFT_EXCEL, filename);
  const f = folder.createFile(blob);
  const mine = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const x = it.next(); if (x.getName().indexOf(CFG.BACKUP_TAG) >= 0 && /\.xlsx$/i.test(x.getName())) mine.push(x); }
  mine.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  mine.slice(CFG.KEEP_BACKUPS).forEach(function (x) { x.setTrashed(true); });
  return { name: f.getName(), url: f.getUrl() };
}

/* =========================== ไฟล์ "แสดงผล" =========================== */

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const PCOLS = [['no', 4.7], ['callsign', 14], ['mission', 19.9], ['route', 30.3], ['aircraft', 9], ['stby_aircraft', 9.6], ['pax', 9], ['owner', 11.5], ['dates', 14], ['status', 15.7]];
const PHEAD = ['NO', 'CALLSIGN', 'MISSION', 'เส้นทางบิน', 'AIRCRAFT', 'STBY AIRCRAFT', 'PAX', 'ผู้รับผิดชอบ', 'วันปฏิบัติภารกิจ', 'ผลความก้าวหน้า'];
const TBC = '(รอยืนยัน)';

function group_(s) { s = String(s || ''); return s.indexOf('ยกเลิก') >= 0 ? 'cancelled' : s.indexOf('เลื่อน') >= 0 ? 'moved' : s.indexOf('เรียบร้อย') >= 0 ? 'done' : 'pending'; }
function yy_(d) { return ('0' + ((d.getUTCFullYear() + 543) % 100)).slice(-2); }
function pd_(s) { return s ? new Date(s + 'T00:00:00Z') : null; }
function thaiRange_(a, b) {
  const s = pd_(a), e = pd_(b || a); if (!s || isNaN(s)) return '';
  if (!e || isNaN(e) || +e <= +s) return s.getUTCDate() + ' ' + TH_M[s.getUTCMonth()] + yy_(s);
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()) return s.getUTCDate() + ' - ' + e.getUTCDate() + ' ' + TH_M[e.getUTCMonth()] + yy_(e);
  return s.getUTCDate() + ' ' + TH_M[s.getUTCMonth()] + (s.getUTCFullYear() !== e.getUTCFullYear() ? yy_(s) : '') + ' - ' + e.getUTCDate() + ' ' + TH_M[e.getUTCMonth()] + yy_(e);
}
function rangesOf_(r) {
  if (Array.isArray(r.ranges) && r.ranges.length) return r.ranges.filter(function (x) { return x && x.s; });
  return r.start ? [{ s: r.start, e: r.end || r.start }] : [];
}
function datesOf_(r) {
  const gen = rangesOf_(r).map(function (x) { return thaiRange_(x.s, x.e); }).join(' หรือ\n');
  return Array.isArray(r.ranges) && r.ranges.length ? gen : (r.dates || gen || '');
}
function dateParts_(r) {
  const p = datesOf_(r).split('\n').filter(String).map(function (t) { return { t: t }; });
  if (r.dateTbc) p.push({ t: TBC, tbc: true });
  if (r.note) String(r.note).split('\n').forEach(function (t) { p.push({ t: t }); });
  return p;
}
// TH SarabunPSK ไม่มีใน Google Sheets จึงใช้ Sarabun ที่ขนาดประมาณ 75% ซึ่งดูเท่ากัน
function gsz_(pt) { return Math.max(6, Math.round((Number(pt) || 14) * 0.75)); }

function renderIfDirty() {
  if (prop_('DISPLAY_DIRTY') !== '1') return;
  const l = LockService.getScriptLock();
  if (!l.tryLock(5000)) return;
  try { renderDisplay_(); } finally { l.releaseLock(); }
}
function renderNow() { const l = LockService.getScriptLock(); if (!l.tryLock(20000)) return; try { renderDisplay_(); } finally { l.releaseLock(); } }

function renderDisplay_() {
  setDirty_(false);
  const list = readMissions_().slice().sort(function (a, b) { return (Number(a.order) || Number(a.no) || 1e6) - (Number(b.order) || Number(b.no) || 1e6) || String(a.id).localeCompare(String(b.id)); });
  const C = PCOLS.length, R = list.length + 5;
  const ss = SpreadsheetApp.openById(CFG.DISPLAY_ID);
  let sh = ss.getSheetByName(CFG.DISPLAY_SHEET);
  if (!sh) { const first = ss.getSheets()[0]; if (ss.getSheets().length === 1 && first.getLastRow() === 0) sh = first.setName(CFG.DISPLAY_SHEET); else sh = ss.insertSheet(CFG.DISPLAY_SHEET, 0); }
  if (sh.getMaxRows() < R) sh.insertRowsAfter(sh.getMaxRows(), R - sh.getMaxRows());
  if (sh.getMaxColumns() < C) sh.insertColumnsAfter(sh.getMaxColumns(), C - sh.getMaxColumns());
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart(); all.clear(); all.setBorder(false, false, false, false, false, false);
  sh.setHiddenGridlines(true);

  const vals = [], bgs = [], fcs = [], fws = [], fss = [], szs = [], heights = [];
  function pushRow(v, bg, fc, fw, fs, sz) { vals.push(v); bgs.push(bg); fcs.push(fc); fws.push(fw); fss.push(fs); szs.push(sz); }
  const blank = function (x) { return PCOLS.map(function () { return x; }); };
  pushRow([CFG.TITLE].concat(blank('').slice(1)), blank(null), blank('#000000'), blank('bold'), blank('normal'), blank(gsz_(16))); heights.push(30);
  pushRow(blank(''), blank(null), blank('#000000'), blank('normal'), blank('normal'), blank(gsz_(14))); heights.push(8);
  pushRow(PHEAD.slice(), blank('#A6A6A6'), blank('#000000'), blank('bold'), blank('normal'), blank(gsz_(14))); heights.push(40);
  const rich = [];
  list.forEach(function (r, idx) {
    const pos = idx + 1, even = pos % 2 === 0, rowN = vals.length + 1;
    const v = [], bg = [], fc = [], fw = [], fs = [], sz = [];
    let lines = 1;
    PCOLS.forEach(function (pc, ci) {
      const f = pc[0], m = (r.fmt && r.fmt[f]) || {};
      let val = f === 'no' ? String(pos) : f === 'dates' ? dateParts_(r).map(function (p) { return p.t; }).join('\n') : String(r[f] == null ? '' : r[f]);
      const g = group_(r.status);
      const col = m.c ? '#' + m.c : (f === 'status' && (g === 'cancelled' || g === 'moved') ? '#FF0000' : f === 'status' && g === 'done' ? '#00B050' : '#000000');
      v.push(val); fc.push(col); bg.push(m.bg ? '#' + m.bg : (even ? '#D9D9D9' : null));
      fw.push(m.b === true ? 'bold' : 'normal'); fs.push(m.i ? 'italic' : 'normal'); sz.push(gsz_(m.sz || 14));
      const ln = val.split('\n').reduce(function (n, part) { return n + Math.max(1, Math.ceil(part.length * ((m.sz || 14) / 14) / (pc[1] * 0.95))); }, 0);
      lines = Math.max(lines, ln);
      if (f === 'dates' && r.dateTbc) rich.push({ r: rowN, c: ci + 1, parts: dateParts_(r), col: col, tbc: '#' + (r.tbcColor || 'FF0000') });
    });
    pushRow(v, bg, fc, fw, fs, sz); heights.push(Math.max(24, Math.round(lines * 19)));
  });
  pushRow(blank(''), blank(null), blank('#000000'), blank('normal'), blank('normal'), blank(gsz_(12))); heights.push(8);
  const now = new Date();
  pushRow(['ไฟล์นี้สร้างอัตโนมัติจากไฟล์ต้นทาง · อัปเดต ' + Utilities.formatDate(now, CFG.TZ, 'dd/MM/') + String(Number(Utilities.formatDate(now, CFG.TZ, 'yyyy')) + 543).slice(-2) + ' ' + Utilities.formatDate(now, CFG.TZ, 'HH:mm') + ' น. · แก้ไขผ่านหน้าเว็บเท่านั้น'].concat(blank('').slice(1)),
    blank(null), blank('#888888'), blank('normal'), blank('italic'), blank(gsz_(12))); heights.push(22);

  const n = vals.length;
  const rg = sh.getRange(1, 1, n, C);
  rg.setNumberFormat('@').setValues(vals).setBackgrounds(bgs).setFontColors(fcs).setFontWeights(fws).setFontStyles(fss).setFontSizes(szs)
    .setFontFamily('Sarabun').setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
  sh.getRange(1, 1, 1, C).merge();
  sh.getRange(n, 1, 1, C).merge().setHorizontalAlignment('left').setWrap(false);
  rich.forEach(function (x) {
    let text = '', pos = 0; const b = [];
    x.parts.forEach(function (p, k) { const t = (k ? '\n' : '') + p.t; if (p.tbc) b.push([pos + (k ? 1 : 0), pos + t.length]); text += t; pos += t.length; });
    const rb = SpreadsheetApp.newRichTextValue().setText(text);
    b.forEach(function (s) { rb.setTextStyle(s[0], s[1], SpreadsheetApp.newTextStyle().setForegroundColor(x.tbc).build()); });
    sh.getRange(x.r, x.c).setRichTextValue(rb.build());
  });
  if (list.length) sh.getRange(3, 1, list.length + 1, C).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  else sh.getRange(3, 1, 1, C).setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  PCOLS.forEach(function (pc, i) { sh.setColumnWidth(i + 1, Math.round(pc[1] * 7.5 + 5)); });
  heights.forEach(function (h, i) { sh.setRowHeight(i + 1, h); });
  if (sh.getMaxRows() > n + 2) sh.deleteRows(n + 3, sh.getMaxRows() - n - 2);
  if (sh.getMaxColumns() > C) sh.deleteColumns(C + 1, sh.getMaxColumns() - C);
  const pr = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!pr.length) sh.protect().setDescription('สร้างอัตโนมัติจากไฟล์ต้นทาง แก้ไขผ่านหน้าเว็บเท่านั้น').setWarningOnly(true);
  SpreadsheetApp.flush();
}

/* =========================== one-time setup =========================== */

/** รันครั้งเดียวหลังวางโค้ด: สร้างแท็บ ตั้งรหัสเริ่มต้น ตั้งตัวตั้งเวลา และวาดไฟล์แสดงผล */
function setup() {
  sheet_('missions', M_COLS); sheet_('logs', LOG_HEAD); snapSheet_();
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CODE_HASH')) p.setProperty('CODE_HASH', sha256_(CFG.DEFAULT_CODE));
  if (!p.getProperty('VER')) p.setProperty('VER', '1');
  // ติดตั้งครั้งแรก: นำข้อมูลจาก Seed.gs (ถ้าเพิ่มไฟล์นั้นไว้) ลงไฟล์ต้นทางที่ยังว่าง
  if (typeof SEED !== 'undefined' && !readMissions_().length) {
    writeMissions_(SEED.missions || []);
    appendLogs_([logRow_({ action: 'import', label: 'นำเข้าข้อมูลเริ่มต้น ' + (SEED.missions || []).length + ' ภารกิจ' }, 'ระบบ')]);
    Logger.log('นำเข้าข้อมูลเริ่มต้น ' + (SEED.missions || []).length + ' ภารกิจ');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('renderIfDirty').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('pruneLogs').timeBased().atHour(2).everyDays(1).inTimezone(CFG.TZ).create();
  DriveApp.getFolderById(CFG.BACKUP_FOLDER_ID).getName(); // ขอสิทธิ์ Drive ตอนนี้
  bump_();
  renderDisplay_();
  Logger.log('ตั้งค่าเสร็จแล้ว');
}

/** เปลี่ยนรหัสเปิดใช้งาน: แก้ข้อความใน NEW_CODE แล้วรันฟังก์ชันนี้ */
function setAccessCode() {
  const NEW_CODE = 'operation.slide';
  PropertiesService.getScriptProperties().setProperty('CODE_HASH', sha256_(NEW_CODE));
  Logger.log('เปลี่ยนรหัสแล้ว');
}
