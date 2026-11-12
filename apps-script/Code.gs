/**
 * ภารกิจต่างประเทศ ฝูง.602 – backend (Google Apps Script)
 * ------------------------------------------------------------
 * วางไฟล์นี้ใน Apps Script ของไฟล์ "รวมภารกิจต่างประเทศ ปีงบ70_ต้นทาง"
 * (Extensions > Apps Script) แล้วรัน setup() หนึ่งครั้ง จากนั้น Deploy เป็น Web app
 *
 * - แต่ละปีงบมีไฟล์ "ต้นทาง" ของตัวเอง (แท็บ missions, logs, snapshots) และไฟล์ "แสดงผล" (แท็บชื่อเลขปีงบ)
 * - ไฟล์ปีงบถัดไปวางลิงก์จากหน้าเว็บได้ (ปุ่ม "ไฟล์ข้อมูล": เฉพาะ Admin หลักของระบบ Login + รหัส admin) ไม่ต้องแก้โค้ด
 * - ภารกิจถูกจัดเข้าปีงบตามวันปฏิบัติภารกิจเอง (ดู placeFys_)
 * - ใครเข้าได้และทำอะไรได้ ตัดสินโดยระบบ Login กลางของ ฝูง.602 (repo eadmin) ทุกคำขอ ดูหัวข้อ "auth" ด้านล่าง
 * - รหัส admin (วางลิงก์ปีงบใหม่) ไม่อยู่ในไฟล์นี้: ตั้งด้วยฟังก์ชัน setCodes() ใน Apps Script
 * - ไฟล์ "แสดงผล" ถูกวาดใหม่จากข้อมูลต้นทางหลังทุกการแก้ไข (อ่านอย่างเดียว)
 * - กด "บันทึกฉบับ" แล้วเก็บไฟล์ Excel ในโฟลเดอร์ Backup ไว้ 20 ไฟล์ล่าสุด
 */

/* ====================== ตั้งรหัส (ทำก่อน setup) ====================== */

/**
 * ตั้ง/เปลี่ยนรหัส admin: พิมพ์รหัสในเครื่องหมาย '' ด้านล่าง แล้วกด Run ฟังก์ชันนี้
 * ระบบเก็บรหัสไว้ฝั่ง Google (Script Properties) แล้ว ให้ลบรหัสออกจากโค้ดและกดบันทึก
 * อย่า commit รหัสลง GitHub
 *  - ADMIN_CODE: รหัส admin สำหรับวางลิงก์ไฟล์ปีงบใหม่เท่านั้น ใช้ได้เฉพาะบัญชี Admin หลักของระบบ Login
 * (รหัสเปิดใช้งานหน้าเว็บเดิมไม่มีแล้ว: เข้าใช้งานด้วยระบบ Login กลาง)
 */
function setCodes() {
  const ADMIN_CODE = '';
  const p = PropertiesService.getScriptProperties();
  if (ADMIN_CODE) { p.setProperty('ADMIN_HASH', sha256_(ADMIN_CODE)); Logger.log('ตั้งรหัส admin แล้ว'); }
  else Logger.log('ยังไม่ได้ใส่รหัสใน setCodes');
  Logger.log('อย่าลืมลบรหัสออกจากโค้ดแล้วกดบันทึก');
}

const CFG = {
  FIRST_FY: 70,                                                   // ปีงบแรกที่ใช้ระบบ
  SOURCE_ID: '1-UUsKGb9GCHs0PkdQK9t9TfIU7NY9L8xSBG9zRbx9rE',      // รวมภารกิจต่างประเทศ ปีงบ70_ต้นทาง
  DISPLAY_ID: '1TuvHy3uBUfKisQM6LfbwDW1F1s2du9D6NiDg1lQTkds',     // รวมภารกิจต่างประเทศ_แสดงผล (ปีงบ70)
  BACKUP_FOLDER_ID: '1TCrfUJcOVO5Tu61eKnV3w_AYxYwHywp7',          // รวมภารกิจต่างประเทศ Backup
  KEEP_BACKUPS: 20,
  KEEP_SNAPS: 20,
  // ระบบ Login กลาง: ที่อยู่ระบบหลังบ้านของระบบ Login (ค่าเดียวกับ backendUrl ในไฟล์ eadmin/docs/assets/config.js)
  // กรอกในหน้า Apps Script แล้ว Run setup ครั้งเดียว ระบบจำไว้เอง (ช่องนี้ว่างไว้ได้ในโค้ดบน GitHub)
  LOGIN_URL: '',
  WEB_CODE: 'WEB10',                 // รหัสเว็บนี้ในรายชื่อเว็บของหน้า Admin (ต้องตรงกับ webCode ใน config.js)
  CHECK_SEC: 60,                     // อ่านอย่างเดียว: ถามระบบ Login ซ้ำทุก 60 วินาที / การแก้ไขทุกครั้งถามใหม่เสมอ
  LOG_DAYS: 0,                       // 0 = เก็บประวัติการแก้ไขไว้ตลอด (แต่ละปีงบมีไฟล์ของตัวเองอยู่แล้ว)
  TZ: 'Asia/Bangkok',
  TITLE: 'ภารกิจต่างประเทศ ฝูง.602 บน.6 ปีงบประมาณ ',
  BACKUP_TAG: 'ภารกิจต่างประเทศปี'   // ชื่อไฟล์ Backup ที่ระบบสร้าง มีคำนี้อยู่
};

const M_COLS = ['id', 'order', 'no', 'callsign', 'mission', 'route', 'aircraft', 'stby_aircraft', 'pax', 'owner', 'dates', 'start', 'end',
  'status', 'note', 'ranges', 'dateTbc', 'tbcColor', 'fmt', 'wantFy', 'updatedAt', 'updatedByName', 'extra'];
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
    const fn = Object.prototype.hasOwnProperty.call(API, req.action) ? API[req.action] : null;
    if (!fn) throw err_('bad_action', 'ไม่รู้จักคำสั่ง ' + req.action);
    const sess = auth_(req.pass, !!FRESH[req.action]);
    if (EDIT[req.action] && !sess.edit) throw err_('forbidden', 'บัญชีนี้มีสิทธิ์ดูอย่างเดียว (Viewer) แก้ไขแผนและส่งออกไฟล์ไม่ได้');
    return json_(fn(req, sess) || { ok: true });
  } catch (x) {
    return json_({ error: { code: (x && x.code) || 'server', message: (x && x.message) || String(x) } });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, message) { const e = new Error(message); e.code = code; return e; }

/* =========================== API =========================== */

// Editor and Admin only: these change the plan, keep a version, redraw the display file, or log a file given out
const EDIT = { write: 1, save: 1, setHolidays: 1, render: 1, setFiles: 1, exported: 1 };
// these ask the login system afresh, not from the copy kept for CFG.CHECK_SEC
const FRESH = { write: 1, save: 1, setHolidays: 1, setFiles: 1, exported: 1 };

const API = {

  // ส่งข้อมูลกลับเฉพาะเมื่อมีการเปลี่ยนแปลงหลังเวอร์ชันที่หน้าเว็บถืออยู่
  // ไฟล์ทุกปีงบ + ภารกิจของทุกปีงบ (ไทม์ไลน์แสดงคร่อมปีงบได้)
  sync: function (r, s) {
    if (r.hello) claimOwner_(s);
    const v = ver_(), files = files_();
    // me: the name (column ชื่อ-สกุล), the Role in this web and whether this is the main admin, from the login system
    const out = { ver: v, snapAt: Number(prop_('SNAP_AT') || 0), files: files, me: { name: s.name, role: s.role, super: s.super, owner: s.owner, ownerOld: s.ownerOld } };
    if (Number(r.ver) !== v) {
      out.missions = {};
      Object.keys(files).forEach(function (fy) { try { out.missions[fy] = readMissions_(fy); } catch (x) { out.missions[fy] = []; } });
      out.holidays = readHolidays_();
    }
    return out;
  },

  // ทุกการแก้ภารกิจ: รวมสำเนาทุกปีงบของภารกิจนั้น แก้ แล้ววางใหม่ให้ตรงปีงบตามวันปฏิบัติภารกิจ
  write: function (r, s) {
    return withLock_(function () {
      const st = allMaps_(), logs = {}, moved = [];
      (r.ops || []).forEach(function (o) {
        if (o.op === 'log') { const fy = fyArg_(o.fy || r.fy); (logs[fy] = logs[fy] || []).push(logRow_(o.data || {}, s.name)); return; }
        const id = String(o.id || '');
        if (!/^[A-Za-z0-9_\-]{1,60}$/.test(id)) throw err_('bad_id', 'รหัสภารกิจไม่ถูกต้อง');
        const had = fysOf_(st, id), cur = had.length ? st.maps[had[0]][id] : null;
        // an Editor: only the missions this account is responsible for (ผู้รับผิดชอบ), adds new ones as its own, deletes none
        if (!s.admin) {
          if (o.op === 'delete') throw err_('not_owner', 'Editor ลบภารกิจไม่ได้ ให้ติดต่อ Admin ของเว็บนี้');
          if (cur && !isMine_(cur.owner, s)) throw err_('not_owner', 'แก้ไขได้เฉพาะภารกิจที่ท่านเป็นผู้รับผิดชอบ (' + (cur.owner || 'ยังไม่ระบุผู้รับผิดชอบ') + ')');
          const want = o.data && Object.prototype.hasOwnProperty.call(o.data, 'owner') ? o.data.owner : null;
          if (want !== null && !isMine_(want, s)) throw err_('not_owner', 'เปลี่ยนผู้รับผิดชอบเป็นคนอื่นไม่ได้ ให้ติดต่อ Admin ของเว็บนี้');
          if (!cur || want !== null || o.op !== 'update') o.data = Object.assign({}, o.data || {}, { owner: s.owner });
        }
        if (o.op === 'delete') { had.forEach(function (fy) { delete st.maps[fy][id]; st.dirty[fy] = 1; }); return; }
        let row;
        if (o.op === 'update') { if (!cur) return; row = merge_(cur, o.data || {}); }
        else row = Object.assign({}, o.data || {}, { id: id });
        row.updatedByName = s.name;
        const home = had.length ? had : [fyArg_(o.fy || r.fy)];
        const res = place_(st, row, home);
        if ((res.from.length ? res.from : home).join() !== res.to.join() || row.wantFy) moved.push({ id: id, mission: row.mission || '', from: res.from, to: res.to, want: row.wantFy || '' });
      });
      moved.forEach(function (m) {
        const lg = logRow_({ action: 'move', mid: m.id, mission: m.mission, from: m.from.join(', '), to: m.to.join(', '), label: m.want ? 'รอย้ายไปปีงบ ' + m.want : '' }, s.name);
        m.to.concat(m.from).filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (fy) { (logs[fy] = logs[fy] || []).push(lg); });
      });
      saveMaps_(st);
      Object.keys(logs).forEach(function (fy) { appendLogs_(fy, logs[fy]); });
      const changed = Object.keys(st.dirty).length > 0;
      return { ok: true, ver: changed ? bump_() : ver_(), moved: moved };
    });
  },

  save: function (r, s) {
    return withLock_(function () {
      const fy = fyArg_(r.fy);
      const at = String(r.at || new Date().toISOString());
      const snap = { id: 'v' + Date.now(), at: at, label: String(r.label || '').slice(0, 120), by: s.name };
      snapAppend_(fy, snap, readMissions_(fy));
      snapPrune_(fy);
      let file = null;
      if (r.xlsx) file = backupExcel_(String(r.filename || ('backup_' + Date.now())) + '.xlsx', r.xlsx);
      PropertiesService.getScriptProperties().setProperty('SNAP_AT', String(Date.now()));
      return { ok: true, snap: snap, backup: file };
    });
  },

  listSnaps: function (r) {
    return { list: snapList_(fyArg_(r.fy)) };
  },

  // a PDF or Excel file was made in the page: into the history of that fiscal year with the name of the account
  exported: function (r, s) {
    const kind = r.kind === 'pdf' ? 'EXPORT TO PDF' : r.kind === 'xlsx' ? 'EXPORT TO EXCEL' : '';
    if (!kind) throw err_('bad_request', 'ไม่รู้จักชนิดไฟล์');
    const fy = fyArg_(r.fy);
    appendLogs_(fy, [logRow_({ action: 'export', field: kind, label: String(r.filename || '').slice(0, 120) }, s.name)]);
    return { ok: true };
  },

  listLogs: function (r) {
    return { list: logsList_(fyArg_(r.fy), Math.min(1000, Number(r.limit) || 200)) };
  },

  // วันหยุดราชการ (ใช้ร่วมกันทุกปีงบ) เก็บในแท็บ holidays ของไฟล์ต้นทางปีงบแรก
  setHolidays: function (r) {
    const m = r.map || {}, rows = [['date', 'name']];
    Object.keys(m).sort().forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw err_('bad_date', 'วันที่ไม่ถูกต้อง');
      const n = String(m[k] || '').trim().slice(0, 120); if (n) rows.push([k, n]);
    });
    if (rows.length > 2000) throw err_('too_many', 'วันหยุดมากเกินไป');
    return withLock_(function () { rewrite_(sheet_(String(CFG.FIRST_FY), 'holidays', ['date', 'name']), rows); return { ok: true, ver: bump_() }; });
  },

  render: function () {
    const l = LockService.getScriptLock();
    if (!l.tryLock(1000)) return { ok: false, queued: true };
    try { renderDirty_(); } finally { l.releaseLock(); }
    return { ok: true };
  },

  // วางลิงก์ไฟล์ต้นทาง + ไฟล์แสดงผลของปีงบ (จากหน้าเว็บ)
  setFiles: function (r, s) {
    // the main admin of the login system only (user, 12 Nov 2026), and the admin code as well
    if (!s.super) throw err_('not_super', 'วางลิงก์ไฟล์ปีงบได้เฉพาะ Admin หลักของระบบ Login');
    const want = prop_('ADMIN_HASH');
    if (!want) throw err_('no_admin', 'ยังไม่ได้ตั้งรหัส admin (รัน setCodes ใน Apps Script)');
    if (sha256_(String(r.admin || '')) !== want) { Utilities.sleep(1500); throw err_('bad_admin', 'รหัส admin ไม่ถูกต้อง'); }
    const fy = Number(r.fy);
    if (!(fy >= 60 && fy <= CFG.FIRST_FY + 30)) throw err_('bad_fy', 'ปีงบไม่ถูกต้อง');
    const src = idFromUrl_(r.src), disp = idFromUrl_(r.disp);
    if (!src || !disp) throw err_('bad_link', 'ลิงก์ไม่ถูกต้อง วางลิงก์ Google Sheets ทั้ง 2 ไฟล์');
    if (src === disp) throw err_('same_file', 'ไฟล์ต้นทางและไฟล์แสดงผลต้องเป็นคนละไฟล์');
    const used = files_();
    Object.keys(used).forEach(function (k) {
      if (Number(k) !== fy && (used[k].src === src || used[k].disp === src || used[k].src === disp || used[k].disp === disp)) throw err_('in_use', 'ไฟล์นี้เป็นไฟล์ของปีงบ ' + k + ' อยู่แล้ว ใช้ไฟล์ใหม่สำหรับปีงบ ' + fy);
    });
    let a, b;
    try { a = SpreadsheetApp.openById(src); } catch (x) { throw err_('no_access', 'เปิดไฟล์ต้นทางไม่ได้ ตรวจว่าบัญชีที่ Deploy สคริปต์มีสิทธิ์แก้ไขไฟล์นี้'); }
    try { b = SpreadsheetApp.openById(disp); } catch (x) { throw err_('no_access', 'เปิดไฟล์แสดงผลไม่ได้ ตรวจว่าบัญชีที่ Deploy สคริปต์มีสิทธิ์แก้ไขไฟล์นี้'); }
    return withLock_(function () {
      const reg = JSON.parse(prop_('FILES') || '{}');
      reg[fy] = { src: src, disp: disp, srcName: a.getName(), dispName: b.getName(), by: s.name, at: new Date().toISOString() };
      PropertiesService.getScriptProperties().setProperty('FILES', JSON.stringify(reg));
      sheet_(fy, 'missions', M_COLS); sheet_(fy, 'logs', LOG_HEAD); snapSheet_(fy);
      appendLogs_(fy, [logRow_({ action: 'files', label: 'วางลิงก์ไฟล์ปีงบ ' + fy + ': ' + a.getName() + ' / ' + b.getName() }, s.name)]);
      markDirty_(fy);
      const n = rebalance_(s.name);  // ย้ายภารกิจที่รอปีงบนี้ไปไฟล์ใหม่
      return { ok: true, files: files_(), ver: bump_(), moved: n };
    });
  }
};

/* =========================== จัดภารกิจเข้าปีงบ =========================== */
// ปีงบ N = 1 ต.ค.(N-1) – 30 ก.ย.N (เลขปี พ.ศ. 2 หลัก)
function fyOfIso_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})/); if (!m) return 0;
  return (Number(m[1]) + 543 + (Number(m[2]) >= 10 ? 1 : 0)) % 100;
}
// ปีงบที่ภารกิจควรอยู่ (ยังไม่สนว่าวางลิงก์แล้วหรือยัง)
//  - มีช่วงวัน "หรือ" หลายช่วงที่คร่อมปีงบ: อยู่ปีงบก่อนหน้า (ปีงบแรก) จนกว่าจะเหลือช่วงเดียว
//  - ช่วงเดียวที่ปฏิบัติจริงข้ามปีงบ: อยู่ทั้ง 2 ปีงบ (เป็นภารกิจเดียวกัน แก้ที่ไหนก็ตรงกัน)
//  - ยังไม่ใส่วันที่: อยู่ปีงบเดิม
function wantFys_(row, home) {
  let rs = Array.isArray(row.ranges) ? row.ranges.filter(function (x) { return x && x.s; }) : [];
  if (!rs.length && row.start) rs = [{ s: row.start, e: row.end || row.start }];
  if (!rs.length) return home.map(Number);
  const fys = [];
  rs.forEach(function (x) { [fyOfIso_(x.s), fyOfIso_(x.e || x.s)].forEach(function (f) { if (f && fys.indexOf(f) < 0) fys.push(f); }); });
  fys.sort(function (a, b) { return a - b; });
  if (rs.length > 1) return [fys[0]];
  const out = []; for (let f = fys[0]; f <= fys[fys.length - 1]; f++) out.push(f);
  return out;
}
// ปีงบที่ยังไม่มีลิงก์: เก็บไว้ในปีงบล่าสุดที่มีลิงก์ก่อนหน้านั้น แล้วจด wantFy ไว้ย้ายทีหลัง
function placeFys_(row, home) {
  const reg = Object.keys(files_()).map(Number).sort(function (a, b) { return a - b; });
  const want = wantFys_(row, home), out = [], wait = [];
  want.forEach(function (f) {
    let t = f;
    if (reg.indexOf(f) < 0) { const past = reg.filter(function (x) { return x < f; }); t = past.length ? past[past.length - 1] : reg[0]; wait.push(f); }
    if (out.indexOf(t) < 0) out.push(t);
  });
  return { fys: out.map(String), wait: wait };
}
function allMaps_() {
  const st = { maps: {}, dirty: {} };
  Object.keys(files_()).forEach(function (fy) { st.maps[fy] = {}; readMissions_(fy).forEach(function (m) { st.maps[fy][m.id] = m; }); });
  return st;
}
function fysOf_(st, id) { return Object.keys(st.maps).filter(function (fy) { return st.maps[fy][id]; }); }
function place_(st, row, home) {
  const from = fysOf_(st, row.id), pl = placeFys_(row, home);
  if (pl.wait.length) row.wantFy = pl.wait.join(','); else delete row.wantFy;
  Object.keys(st.maps).forEach(function (fy) {
    if (pl.fys.indexOf(fy) >= 0) { st.maps[fy][row.id] = Object.assign({}, row); st.dirty[fy] = 1; }
    else if (st.maps[fy][row.id]) { delete st.maps[fy][row.id]; st.dirty[fy] = 1; }
  });
  return { from: from, to: pl.fys };
}
function saveMaps_(st) {
  Object.keys(st.dirty).forEach(function (fy) { writeMissions_(fy, objValues_(st.maps[fy])); markDirty_(fy); });
}
// จัดทุกภารกิจใหม่ (หลังวางลิงก์ปีงบใหม่)
function rebalance_(by) {
  const st = allMaps_(), seen = {}, logs = {}; let n = 0;
  Object.keys(st.maps).forEach(function (fy) {
    objValues_(st.maps[fy]).forEach(function (m) {
      if (seen[m.id]) return; seen[m.id] = 1;
      const res = place_(st, m, fysOf_(st, m.id));
      if (res.from.join() !== res.to.join()) {
        n++;
        const lg = logRow_({ action: 'move', mid: m.id, mission: m.mission || '', from: res.from.join(', '), to: res.to.join(', ') }, by);
        res.to.concat(res.from).filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (f) { (logs[f] = logs[f] || []).push(lg); });
      }
    });
  });
  saveMaps_(st);
  Object.keys(logs).forEach(function (fy) { appendLogs_(fy, logs[fy]); });
  return n;
}

/* =========================== helpers =========================== */

/* Who is asking, and may they? Decided by the login system of ฝูง.602 (repo eadmin), never here and never in the page.
   The page gets a pass for this web from the login system (App.enterWeb) and sends it with every request; this script
   sends it on to the login system (op web.check) with the code of this web, and gets back the person, the Role in this
   web (Admin / Editor edit, Viewer looks only) and whether it is the main admin. No access, the web closed, the hour
   over, the password changed, the account taken by another device: refused, every time. The pass is good for that
   question about this web only: this script never sees the login itself, so it cannot be used for the Admin page or
   another web. An answer is kept for CFG.CHECK_SEC for the questions that only read (sync, lists); everything that
   changes the plan asks afresh (FRESH). Only a mark of the pass is kept here, never the pass itself. */
function loginUrl_() {
  return String(prop_('LOGIN_URL') || CFG.LOGIN_URL || '').trim();
}
// the address of a deployed Apps Script web app, nothing else: the pass is only ever sent there
function loginUrlOk_(url) { return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url); }
function auth_(pass, fresh) {
  pass = String(pass || '');
  if (!pass || pass.length > 800) throw err_('auth', 'ให้เข้าสู่ระบบ');
  // a pass for another web: config.js (webCode) and CFG.WEB_CODE do not agree. Said plainly, so it is found at once.
  let w = '';
  try { w = String(JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pass.split('.')[0])).getDataAsString()).w || ''); } catch (x) { w = ''; }
  if (w && w !== CFG.WEB_CODE) throw err_('wrong_web', 'รหัสเว็บในไฟล์ config.js (' + w + ') ไม่ตรงกับ CFG.WEB_CODE ใน Apps Script (' + CFG.WEB_CODE + ') ให้แก้ให้ตรงกัน');
  const key = sha256_('overseas|' + pass).slice(0, 32), cache = CacheService.getScriptCache();
  if (!fresh) { const hit = cache.get('who:' + key); if (hit) return JSON.parse(hit); }
  const url = loginUrl_();
  if (!loginUrlOk_(url)) throw err_('config', 'ยังไม่ได้ตั้งที่อยู่ระบบ Login (CFG.LOGIN_URL แล้ว Run setup)');
  let j = null;
  try {
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify({ v: 1, op: 'web.check', pass: pass, web: CFG.WEB_CODE }), muteHttpExceptions: true, followRedirects: true });
    j = JSON.parse(res.getContentText());
  } catch (x) { j = null; }
  if (!j || (!j.ok && !j.error)) throw err_('busy', 'ตรวจสิทธิ์กับระบบ Login ไม่ได้ ลองอีกครั้ง');
  if (!j.ok) {
    cache.remove('who:' + key);
    const c = String(j.error.code || '');
    // the login is over: the page asks the login system itself and is sent to the login page with the reason
    if (c === 'auth' || c === 'expired' || c === 'taken') throw err_('auth', String(j.error.message || 'ให้เข้าสู่ระบบใหม่'));
    if (c === 'no_web' || c === 'web_closed') throw err_(c, String(j.error.message || 'บัญชีนี้ไม่มีสิทธิ์ใช้งานเว็บนี้ ให้ติดต่อ Admin'));
    throw err_('busy', String(j.error.message || 'ระบบ Login ขัดข้อง ลองอีกครั้ง'));
  }
  const u = j.user || {}, role = String(j.role || '');
  // the recorder: column "ชื่อ-สกุล" of the account's row in LOGIN DATABASE, found by the login system (Username as fallback)
  const who = { name: String(u.name || u.username || '').trim().slice(0, 60), role: role, edit: role === 'Admin' || role === 'Editor', admin: role === 'Admin', super: j.super === true };
  // the name in the column ผู้รับผิดชอบ: rank + first name + first letter of the surname (user, 12 Nov 2026), e.g. ร.อ.สมชาย ใ.
  who.owner = ownerOf_(u.rank, u.name); who.ownerOld = ownerOf_(u.rank, String(u.name || '').trim().split(/\s+/)[0]);
  const left = Math.floor((Number(j.expiresAt) - Date.now()) / 1000);
  if (left > 1) cache.put('who:' + key, JSON.stringify(who), Math.min(CFG.CHECK_SEC, left));
  return who;
}
/* ผู้รับผิดชอบภารกิจ: ยศ (column ยศ) ติดกับชื่อ แล้วเว้นวรรค อักษรตัวแรกของสกุลและจุด เช่น "ร.อ.สมชาย ใ."
   ชื่อกับสกุลแยกที่ช่องว่างแรกของ column ชื่อ-สกุล. A surname that starts with a leading vowel (เ แ โ ใ ไ) gives its first
   consonant, as Thai initials are written. The old way (rank + first name only, e.g. "ร.อ.สมชาย") counts as the same person. */
function ownerOf_(rank, name) {
  const parts = String(name || '').trim().split(/\s+/), first = parts[0] || '', sur = parts.slice(1).join('');
  const ini = (sur.replace(/^[เแโใไ]+/, '') || sur).charAt(0);
  return (String(rank || '').replace(/\s+/g, '') + first + (ini ? ' ' + ini + '.' : '')).trim();
}
function ownerKey_(v) { return String(v || '').replace(/\s+/g, '').replace(/\.$/, ''); }
function isMine_(owner, s) { const k = ownerKey_(owner); return !!k && (k === ownerKey_(s.owner) || k === ownerKey_(s.ownerOld)); }
// the missions of this account written the old way (rank + first name): the surname initial is filled in, once, when it opens the page
function claimOwner_(s) {
  if (!s.owner || ownerKey_(s.owner) === ownerKey_(s.ownerOld)) return;
  const old = ownerKey_(s.ownerOld);
  const st = allMaps_(); let n = 0;
  Object.keys(st.maps).forEach(function (fy) {
    objValues_(st.maps[fy]).forEach(function (m) { if (ownerKey_(m.owner) === old) { m.owner = s.owner; st.dirty[fy] = 1; n++; } });
  });
  if (!n) return;
  withLock_(function () {
    const fresh = allMaps_(), logs = {};
    Object.keys(fresh.maps).forEach(function (fy) {
      objValues_(fresh.maps[fy]).forEach(function (m) {
        if (ownerKey_(m.owner) !== old) return;
        (logs[fy] = logs[fy] || []).push(logRow_({ action: 'edit', mid: m.id, no: m.no || '', mission: m.mission || '', field: 'owner', from: m.owner, to: s.owner }, 'ระบบ (เติมสกุลย่อ)'));
        m.owner = s.owner; fresh.dirty[fy] = 1;
      });
    });
    saveMaps_(fresh);
    Object.keys(logs).forEach(function (fy) { appendLogs_(fy, logs[fy]); });
    if (Object.keys(fresh.dirty).length) bump_();
  });
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
  return v;
}
function objValues_(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
function isObj_(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge_(a, b) {
  const o = Object.assign({}, a);
  Object.keys(b).forEach(function (k) { o[k] = isObj_(b[k]) && isObj_(o[k]) ? merge_(o[k], b[k]) : b[k]; });
  return o;
}

function files_() {
  const reg = JSON.parse(prop_('FILES') || '{}');
  if (!reg[CFG.FIRST_FY]) reg[CFG.FIRST_FY] = { src: CFG.SOURCE_ID, disp: CFG.DISPLAY_ID };
  return reg;
}
function fyArg_(v) {
  const fy = String(Number(v) || CFG.FIRST_FY);
  if (!files_()[fy]) throw err_('no_files', 'ยังไม่ได้วางลิงก์ไฟล์ของปีงบ ' + fy);
  return fy;
}
function idFromUrl_(u) {
  u = String(u || '').trim();
  const m = u.match(/\/d\/([A-Za-z0-9_-]{20,})/) || u.match(/^([A-Za-z0-9_-]{25,})$/);
  return m ? m[1] : '';
}
function markDirty_(fy) {
  const d = JSON.parse(prop_('DIRTY_FYS') || '[]');
  if (d.indexOf(String(fy)) < 0) d.push(String(fy));
  PropertiesService.getScriptProperties().setProperty('DIRTY_FYS', JSON.stringify(d));
}
function src_(fy) { return SpreadsheetApp.openById(files_()[fy].src); }
function sheet_(fy, name, header) {
  const ss = src_(fy);
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

function readMissions_(fy) {
  const cache = CacheService.getScriptCache(), key = 'missions:' + fy + ':' + ver_();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const vals = sheet_(fy, 'missions', M_COLS).getDataRange().getValues();
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

function writeMissions_(fy, list) {
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
  rewrite_(sheet_(fy, 'missions', M_COLS), rows);
}

function readHolidays_() {
  const ss = src_(String(CFG.FIRST_FY)), sh = ss.getSheetByName('holidays');
  if (!sh || sh.getLastRow() < 2) return null;
  const out = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0] && r[1]) out[String(r[0])] = String(r[1]); });
  return out;
}

/* =========================== logs =========================== */

function logRow_(d, name) {
  const at = Date.now();
  const e = Object.assign({}, d, { byName: name, at: new Date(at).toISOString() });
  delete e.by;
  const detail = [d.field || '', d.from != null ? String(d.from) : '', d.to != null ? '→ ' + String(d.to) : '', d.label || ''].filter(String).join(' ');
  return [String(at), Utilities.formatDate(new Date(at), CFG.TZ, 'yyyy-MM-dd HH:mm:ss'), name, String(d.action || ''), String(d.mission || ''), detail.slice(0, 500), JSON.stringify(e).slice(0, 4000)];
}
function appendLogs_(fy, rows) {
  const sh = sheet_(fy, 'logs', LOG_HEAD);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length).setNumberFormat('@').setValues(rows);
}
function logsList_(fy, n) {
  const sh = sheet_(fy, 'logs', LOG_HEAD);
  const last = sh.getLastRow(); if (last < 2) return [];
  const from = Math.max(2, last - n + 1);
  return sh.getRange(from, 1, last - from + 1, LOG_HEAD.length).getValues().reverse().map(function (r, i) {
    let o = {}; try { o = JSON.parse(r[6]); } catch (x) { o = { action: String(r[3]), byName: String(r[2]) }; }
    o.id = 'l' + r[0] + '_' + i;
    return o;
  });
}
function pruneLogs() {
  if (!(CFG.LOG_DAYS > 0)) return; // ไม่ลบประวัติ
  Object.keys(files_()).forEach(function (fy) {
    const sh = sheet_(fy, 'logs', LOG_HEAD);
    const last = sh.getLastRow(); if (last < 2) return;
    const lim = Date.now() - CFG.LOG_DAYS * 864e5;
    const col = sh.getRange(2, 1, last - 1, 1).getValues();
    let n = 0; while (n < col.length && Number(col[n][0]) < lim) n++;
    if (n) sh.deleteRows(2, n);
  });
}

/* =========================== snapshots (ฉบับที่บันทึก) =========================== */

const CHUNK = 45000;
function snapSheet_(fy) { return sheet_(fy, 'snapshots', SNAP_HEAD); }
function snapAppend_(fy, meta, rows) {
  const sh = snapSheet_(fy);
  const js = JSON.stringify(rows), parts = [];
  for (let i = 0; i < js.length; i += CHUNK) parts.push(js.slice(i, i + CHUNK));
  const row = [meta.id, meta.at, meta.label, meta.by].concat(parts);
  if (sh.getMaxColumns() < row.length) sh.insertColumnsAfter(sh.getMaxColumns(), row.length - sh.getMaxColumns());
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}
function snapRows_(fy) {
  const sh = snapSheet_(fy); const last = sh.getLastRow(); if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, Math.max(5, sh.getLastColumn())).getValues()
    .map(function (r, i) { return { row: i + 2, r: r }; })
    .sort(function (a, b) { return String(b.r[1]).localeCompare(String(a.r[1])); });
}
function snapList_(fy) {
  return snapRows_(fy).slice(0, CFG.KEEP_SNAPS).map(function (x) {
    let rows = []; try { rows = JSON.parse(x.r.slice(4).join('')); } catch (e) { }
    return { id: String(x.r[0]), at: String(x.r[1]), label: String(x.r[2]), byName: String(x.r[3]), rows: rows };
  });
}
function snapPrune_(fy) {
  const sh = snapSheet_(fy);
  snapRows_(fy).slice(CFG.KEEP_SNAPS).map(function (x) { return x.row; }).sort(function (a, b) { return b - a; })
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

function group_(s) { s = String(s || ''); return s.indexOf('ยกเลิก') >= 0 ? 'cancelled' : s.indexOf('เลื่อน') >= 0 ? 'moved' : s.indexOf('เรียบร้อย') >= 0 ? 'done' : s.indexOf('รอปฏิบัติ') >= 0 ? 'ready' : 'pending'; }
// "รอปฏิบัติภารกิจ (ได้รับหนังสือขอใช้ บ.)" แสดง 2 บรรทัด: ดำ แล้วเขียว
function statusLines_(s) {
  s = String(s || ''); const i = s.indexOf(' (');
  if (s.indexOf('รอปฏิบัติภารกิจ') !== 0 || i < 0) return null;
  return [{ t: s.slice(0, i), color: '#000000' }, { t: s.slice(i + 1), color: '#00B050' }];
}
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
  if ((prop_('DIRTY_FYS') || '[]') === '[]') return;
  const l = LockService.getScriptLock();
  if (!l.tryLock(5000)) return;
  try { renderDirty_(); } finally { l.releaseLock(); }
}
function renderDirty_() {
  const d = JSON.parse(prop_('DIRTY_FYS') || '[]');
  PropertiesService.getScriptProperties().setProperty('DIRTY_FYS', '[]');
  d.forEach(function (fy) { if (files_()[fy]) renderDisplay_(fy); });
}
/** วาดไฟล์แสดงผลของทุกปีงบใหม่ทันที */
function renderNow() {
  const l = LockService.getScriptLock(); if (!l.tryLock(20000)) return;
  try { Object.keys(files_()).forEach(function (fy) { renderDisplay_(fy); }); } finally { l.releaseLock(); }
}

function renderDisplay_(fy) {
  fy = String(fy);
  const list = readMissions_(fy).slice().sort(function (a, b) { return (Number(a.order) || Number(a.no) || 1e6) - (Number(b.order) || Number(b.no) || 1e6) || String(a.id).localeCompare(String(b.id)); });
  const C = PCOLS.length, R = list.length + 5;
  const ss = SpreadsheetApp.openById(files_()[fy].disp);
  let sh = ss.getSheetByName(fy);
  if (!sh) { const first = ss.getSheets()[0]; if (ss.getSheets().length === 1 && first.getLastRow() === 0) sh = first.setName(fy); else sh = ss.insertSheet(fy, 0); }
  if (sh.getMaxRows() < R) sh.insertRowsAfter(sh.getMaxRows(), R - sh.getMaxRows());
  if (sh.getMaxColumns() < C) sh.insertColumnsAfter(sh.getMaxColumns(), C - sh.getMaxColumns());
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart(); all.clear(); all.setBorder(false, false, false, false, false, false);
  sh.setHiddenGridlines(true);

  const vals = [], bgs = [], fcs = [], fws = [], fss = [], szs = [], heights = [];
  function pushRow(v, bg, fc, fw, fs, sz) { vals.push(v); bgs.push(bg); fcs.push(fc); fws.push(fw); fss.push(fs); szs.push(sz); }
  const blank = function (x) { return PCOLS.map(function () { return x; }); };
  pushRow([CFG.TITLE + fy].concat(blank('').slice(1)), blank(null), blank('#000000'), blank('bold'), blank('normal'), blank(gsz_(16))); heights.push(30);
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
      if (f === 'dates' && r.dateTbc) rich.push({ r: rowN, c: ci + 1, parts: dateParts_(r).map(function (p) { return p.tbc ? { t: p.t, color: '#' + (r.tbcColor || 'FF0000') } : p; }) });
      if (f === 'status' && statusLines_(r.status) && !m.c) { v[ci] = statusLines_(r.status).map(function (p) { return p.t; }).join('\n'); rich.push({ r: rowN, c: ci + 1, parts: statusLines_(r.status) }); }
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
    x.parts.forEach(function (p, k) { const t = (k ? '\n' : '') + p.t; if (p.color) b.push([pos + (k ? 1 : 0), pos + t.length, p.color]); text += t; pos += t.length; });
    const rb = SpreadsheetApp.newRichTextValue().setText(text);
    b.forEach(function (s) { rb.setTextStyle(s[0], s[1], SpreadsheetApp.newTextStyle().setForegroundColor(s[2]).build()); });
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
  // ระบบ Login กลาง: จำที่อยู่ไว้ แล้วตรวจว่าระบบ Login ตอบ (ขอสิทธิ์เรียกเว็บภายนอกตอนนี้ด้วย)
  const p = PropertiesService.getScriptProperties();
  const url = String(CFG.LOGIN_URL || '').trim();
  if (url) {
    if (!loginUrlOk_(url)) throw new Error('CFG.LOGIN_URL ต้องเป็นที่อยู่ Web app ของระบบ Login (ขึ้นต้น https://script.google.com/macros/s/ ลงท้าย /exec)');
    p.setProperty('LOGIN_URL', url);
  }
  if (!loginUrl_()) throw new Error('ยังไม่ได้กรอก CFG.LOGIN_URL (ที่อยู่ระบบหลังบ้านของระบบ Login) กรอกแล้ว Run setup อีกครั้ง');
  let ok = false;
  try { ok = JSON.parse(UrlFetchApp.fetch(loginUrl_(), { muteHttpExceptions: true, followRedirects: true }).getContentText()).service === 'eadmin602'; } catch (x) { ok = false; }
  if (!ok) throw new Error('ติดต่อระบบ Login ที่ ' + loginUrl_() + ' ไม่ได้ ตรวจ CFG.LOGIN_URL แล้ว Run setup อีกครั้ง');
  Logger.log('ระบบ Login ตอบแล้ว · รหัสเว็บนี้ ' + CFG.WEB_CODE + ' (ต้องตรงกับรายชื่อเว็บในหน้า Admin)');
  p.deleteProperty('CODE_HASH');                       // the old access code is no longer used
  const fy = String(CFG.FIRST_FY);
  sheet_(fy, 'missions', M_COLS); sheet_(fy, 'logs', LOG_HEAD); snapSheet_(fy);
  // Seed.gs แบบหลายปีงบ: { years: { 69: [...], 70: [...] } }
  // ปีงบที่ยังไม่มีไฟล์ (เช่น 69) ระบบสร้างไฟล์ต้นทาง/แสดงผลให้ในโฟลเดอร์เดียวกับไฟล์ปีงบ 70
  if (typeof SEED !== 'undefined' && SEED.years) {
    Object.keys(SEED.years).forEach(function (y) {
      if (!files_()[y]) createYearFiles_(Number(y));
      sheet_(y, 'missions', M_COLS); sheet_(y, 'logs', LOG_HEAD); snapSheet_(y);
      if (!readMissions_(y).length && SEED.years[y].length) {
        writeMissions_(y, SEED.years[y]);
        appendLogs_(y, [logRow_({ action: 'import', label: 'นำเข้าข้อมูลเริ่มต้น ' + SEED.years[y].length + ' ภารกิจ' }, 'ระบบ')]);
        Logger.log('ปีงบ ' + y + ': นำเข้าข้อมูลเริ่มต้น ' + SEED.years[y].length + ' ภารกิจ');
      }
      markDirty_(y);
    });
  }
  if (!p.getProperty('ADMIN_HASH')) Logger.log('⚠ ยังไม่ได้ตั้งรหัส admin (ใช้ตอนวางลิงก์ปีงบใหม่): ใส่รหัสใน setCodes() แล้วรัน setCodes หนึ่งครั้ง');
  if (!p.getProperty('VER')) p.setProperty('VER', '1');
  // ติดตั้งครั้งแรก: นำข้อมูลจาก Seed.gs (ถ้าเพิ่มไฟล์นั้นไว้) ลงไฟล์ต้นทางที่ยังว่าง
  if (typeof SEED !== 'undefined' && SEED.missions && !readMissions_(fy).length) {
    writeMissions_(fy, SEED.missions || []);
    appendLogs_(fy, [logRow_({ action: 'import', label: 'นำเข้าข้อมูลเริ่มต้น ' + (SEED.missions || []).length + ' ภารกิจ' }, 'ระบบ')]);
    Logger.log('นำเข้าข้อมูลเริ่มต้น ' + (SEED.missions || []).length + ' ภารกิจ');
  }
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('renderIfDirty').timeBased().everyMinutes(1).create();
  if (CFG.LOG_DAYS > 0) ScriptApp.newTrigger('pruneLogs').timeBased().atHour(2).everyDays(1).inTimezone(CFG.TZ).create();
  try { DriveApp.getFolderById(CFG.BACKUP_FOLDER_ID).getName(); } // ขอสิทธิ์ Drive ตอนนี้
  catch (x) { Logger.log('⚠ เปิดโฟลเดอร์ Backup ไม่ได้: แชร์โฟลเดอร์ให้บัญชี ' + me_() + ' เป็น "ผู้แก้ไข"'); }
  bump_();
  Object.keys(files_()).forEach(function (y) {
    Logger.log('ปีงบ ' + y + ': ไฟล์ต้นทางมี ' + readMissions_(y).length + ' ภารกิจ');
    try { renderDisplay_(y); }
    catch (x) { Logger.log('⚠ วาดไฟล์แสดงผลปีงบ ' + y + ' ไม่ได้: ' + x.message + ' · แชร์ไฟล์แสดงผลให้บัญชี ' + me_() + ' เป็น "ผู้แก้ไข" แล้วรัน setup อีกครั้ง (หน้าเว็บใช้งานได้แล้วแม้ไฟล์แสดงผลยังไม่ถูกวาด)'); markDirty_(y); }
  });
  Logger.log('ตั้งค่าเสร็จแล้ว');
}

function me_() { try { return Session.getEffectiveUser().getEmail() || 'ที่ใช้รันสคริปต์'; } catch (x) { return 'ที่ใช้รันสคริปต์'; } }

/** สร้างไฟล์ต้นทาง + ไฟล์แสดงผลของปีงบ (ใช้ตอนนำเข้าข้อมูลปีงบย้อนหลัง) */
function createYearFiles_(fy) {
  const srcDir = DriveApp.getFileById(CFG.SOURCE_ID).getParents(), dispDir = DriveApp.getFileById(CFG.DISPLAY_ID).getParents();
  const a = SpreadsheetApp.create('รวมภารกิจต่างประเทศ ปีงบ' + fy + '_ต้นทาง'), b = SpreadsheetApp.create('รวมภารกิจต่างประเทศ ปีงบ' + fy + '_แสดงผล');
  if (srcDir.hasNext()) DriveApp.getFileById(a.getId()).moveTo(srcDir.next());
  if (dispDir.hasNext()) DriveApp.getFileById(b.getId()).moveTo(dispDir.next());
  const reg = JSON.parse(prop_('FILES') || '{}');
  reg[fy] = { src: a.getId(), disp: b.getId(), srcName: a.getName(), dispName: b.getName(), by: 'ระบบ', at: new Date().toISOString() };
  PropertiesService.getScriptProperties().setProperty('FILES', JSON.stringify(reg));
  Logger.log('สร้างไฟล์ปีงบ ' + fy + ': ' + a.getUrl() + ' และ ' + b.getUrl());
}
