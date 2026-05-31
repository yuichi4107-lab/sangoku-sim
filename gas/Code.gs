/**
 * 三国覇王戦記 グループ共有DB（GAS Web App）完全版 v2
 *
 * ★v2 変更点★ 共有データ(shared_state)が1セル50000文字制限を超えて保存できない問題を解消。
 *   従来: data シートの B1 セルに JSON 全体を1個格納 → 約49KB超で保存失敗(サイレント)。
 *   v2  : users_data シートに「1ユーザー=1行」で分割保存し、shared_meta に編成等の軽量データを保存。
 *         GET 時は全行＋metaを結合して従来と同じ {ok, data, updated_at} 形式で返す（取得側は無改修）。
 *         旧 data シートにデータが残っていれば自動移行（初回GET/保存時）。
 *
 *   ※ inbox（受信箱）と OCR 関連は従来コードのまま（列順・形式を変えない＝既存データを壊さない）。
 */
const SHEET_NAME = 'data';            // 旧: 共有stateの1セル格納（移行元として参照）
const USERS_SHEET = 'users_data';     // 新: 1ユーザー=1行
const META_SHEET = 'shared_meta';     // 新: 編成/優先など軽量データ
const INBOX_SHEET = 'inbox';
const IMG_FOLDER_NAME = 'sangoku_inbox_images';
const KEY_CELL = 'A1';
const VALUE_CELL = 'B1';
const UPDATED_CELL = 'C1';
const CHUNK_SIZE = 40000;

// ---------- シート取得 ----------
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SHEET_NAME); sheet.getRange(KEY_CELL).setValue('shared_state'); }
  return sheet;
}
function getUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET);
    sheet.getRange(1, 1, 1, 5).setValues([['user_id', 'name', 'ownerships_json', 'player_stats_json', 'updated_at']]);
  }
  return sheet;
}
function getMetaSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(META_SHEET);
  if (!sheet) sheet = ss.insertSheet(META_SHEET);
  return sheet;
}
function getInboxSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INBOX_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INBOX_SHEET);
    sheet.getRange(1,1).setValue('user_name');
    sheet.getRange(1,2).setValue('ownerships_json');
    sheet.getRange(1,3).setValue('updated_at');
    sheet.getRange(1,4).setValue('image_refs_json');
    sheet.getRange(1,5).setValue('player_stats_json');
    sheet.getRange(1,6).setValue('pin');
  }
  return sheet;
}
function getImageFolder_() {
  const fs = DriveApp.getFoldersByName(IMG_FOLDER_NAME);
  return fs.hasNext() ? fs.next() : DriveApp.createFolder(IMG_FOLDER_NAME);
}
function parseJson_(v, fallback) {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(String(v)); } catch (e) { return fallback; }
}
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- ルーティング ----------
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'get_state';
  if (action === 'get_inbox') return getInbox_();
  if (action === 'get_user_by_pin') return getUserByPin_(e);  // 暗証番号で本人の前回送信を取得
  return getState_();
}
function doPost(e) {
  let body;
  if (e && e.parameter && e.parameter.payload) body = e.parameter.payload;
  else if (e && e.postData && e.postData.contents) body = e.postData.contents;
  else body = '{}';
  try {
    const obj = JSON.parse(body);
    if (obj && obj.action === 'submit_user') return submitUser_(obj);
    if (obj && obj.action === 'update_stats') return updateStats_(obj);
    if (obj && obj.action === 're_ocr') return reOcr_(obj);
    if (obj && obj.action === 'delete_inbox') return deleteInbox_(obj);
    if (obj && obj.action === 'save_user') return saveUser_(obj);     // 新: 1ユーザー保存
    if (obj && obj.action === 'save_meta') return saveMeta_(obj.meta || {});  // 新: メタ保存
    if (obj && obj.action === 'delete_user') return deleteUser_(obj); // 新: 1ユーザー削除
    if (obj && obj.action === 'clear_all') return clearAll_();        // 新: 共有データ全消去（メンテ用）
  } catch (err) {}
  return saveState_(body);  // 旧クライアント互換: schema付き一括保存
}

// ============================================================
// 共有データ（ユーザー単位分割）
// ============================================================

// 旧 data シート(B1=JSON全体)にデータがあれば users_data/shared_meta へ移行
function migrateLegacyIfNeeded_() {
  const usersSheet = getUsersSheet_();
  if (usersSheet.getLastRow() >= 2) return false;  // 既に新形式にデータあり
  const legacy = getSheet_();
  const val = legacy.getRange(VALUE_CELL).getValue();
  const data = parseJson_(val, null);
  if (!data || !data.users || !data.users.length) {
    // 旧データが無い/空 → 移行不要。残骸があれば消しておく（復活防止）。
    legacy.getRange(VALUE_CELL).setValue('');
    return false;
  }
  writeAllUsers_(data);
  saveMeta_({ formations: data.formations || [], priority: data.priority || {}, aggMode: data.aggMode || '', activeUserId: data.activeUserId });
  // 移行完了 → 旧B1をクリアして二度と復活しないようにする
  legacy.getRange(VALUE_CELL).setValue('');
  return true;
}

// メンテ用: 共有データ（旧data B1 / users_data / shared_meta）を全消去。受信箱は触らない。
function clearAll_() {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    getSheet_().getRange(VALUE_CELL).setValue('');
    const u = getUsersSheet_();
    u.clearContents();
    u.getRange(1, 1, 1, 5).setValues([['user_id', 'name', 'ownerships_json', 'player_stats_json', 'updated_at']]);
    getMetaSheet_().clearContents();
    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, cleared: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function writeAllUsers_(data) {
  const sh = getUsersSheet_();
  const users = data.users || [];
  const own = data.ownerships || {};
  const ps = data.playerStats || {};
  const now = new Date().toISOString();
  sh.clearContents();
  sh.getRange(1, 1, 1, 5).setValues([['user_id', 'name', 'ownerships_json', 'player_stats_json', 'updated_at']]);
  const rows = [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const uid = String(u.id);
    const ownJson = JSON.stringify(own[uid] || own[u.id] || {});
    const psJson = JSON.stringify(ps[uid] || ps[u.id] || {});
    if (ownJson.length > 49000 || psJson.length > 49000) throw new Error('user ' + uid + ' field too large');
    rows.push([uid, String(u.name == null ? '' : u.name), ownJson, psJson, now]);
  }
  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function findUserRow_(sh, userId) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(userId)) return i + 2;
  return -1;
}

// 旧クライアント互換: schema付き一括保存 → 全ユーザー行＋metaに分解
function saveState_(body) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const data = JSON.parse(body);
    if (!data || data.schema !== 'sangoku_group_v1') {
      // 想定外フォーマットは旧来通り data シートに退避（後方互換）
      const sheet = getSheet_();
      sheet.getRange(KEY_CELL).setValue('shared_state');
      sheet.getRange(VALUE_CELL).setValue(body);
      sheet.getRange(UPDATED_CELL).setValue(new Date().toISOString());
      return jsonOut_({ ok: true, updated_at: new Date().toISOString() });
    }
    writeAllUsers_(data);
    saveMeta_({ formations: data.formations || [], priority: data.priority || {}, aggMode: data.aggMode || '', activeUserId: data.activeUserId });
    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, updated_at: new Date().toISOString(), users: (data.users || []).length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// 新: 1ユーザー行だけ保存（軽量）
function saveUser_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (obj.user_id == null) throw new Error('user_id required');
    const sh = getUsersSheet_();
    const now = new Date().toISOString();
    const ownJson = JSON.stringify(obj.ownerships || {});
    const psJson = JSON.stringify(obj.player_stats || obj.playerStats || {});
    if (ownJson.length > 49000 || psJson.length > 49000) throw new Error('field too large');
    const values = [String(obj.user_id), String(obj.name == null ? '' : obj.name), ownJson, psJson, now];
    const row = findUserRow_(sh, obj.user_id);
    if (row === -1) sh.appendRow(values);
    else sh.getRange(row, 1, 1, 5).setValues([values]);
    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, updated_at: now });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function deleteUser_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = getUsersSheet_();
    const row = findUserRow_(sh, obj.user_id);
    if (row === -1) return jsonOut_({ ok: true, deleted: false });
    sh.deleteRow(row);
    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, deleted: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// 新: メタ（編成/優先など）保存。巨大化に備えてチャンク分割。
function saveMeta_(meta) {
  const sh = getMetaSheet_();
  const now = new Date().toISOString();
  const text = JSON.stringify(meta || {});
  sh.clearContents();
  sh.getRange(1, 1).setValue(now);
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.substring(i, i + CHUNK_SIZE));
  if (!chunks.length) chunks = [''];
  sh.getRange(2, 1).setValue(chunks.length);
  for (let c = 0; c < chunks.length; c++) sh.getRange(3 + c, 1).setValue(chunks[c]);
  SpreadsheetApp.flush();
  return jsonOut_({ ok: true, updated_at: now });
}
function readMeta_() {
  const sh = getMetaSheet_();
  const updated = sh.getRange(1, 1).getValue();
  const n = Number(sh.getRange(2, 1).getValue()) || 0;
  let text = '';
  if (n > 0) {
    const vals = sh.getRange(3, 1, n, 1).getValues();
    for (let i = 0; i < n; i++) text += String(vals[i][0]);
  }
  return { meta: parseJson_(text, {}), updated_at: updated ? String(updated) : '' };
}

// 共有データ取得（全ユーザー結合＋メタ）。従来と同じ {ok,data,updated_at}。
function getState_() {
  migrateLegacyIfNeeded_();
  const sh = getUsersSheet_();
  const last = sh.getLastRow();
  const users = [];
  const ownerships = {};
  const playerStats = {};
  let maxTs = '';
  if (last >= 2) {
    const vals = sh.getRange(2, 1, last - 1, 5).getValues();
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      if (r[0] === '' || r[0] == null) continue;
      const uid = String(r[0]);
      const idNum = Number(uid);
      users.push({ id: isNaN(idNum) ? uid : idNum, name: String(r[1]) });
      ownerships[uid] = parseJson_(r[2], {});
      playerStats[uid] = parseJson_(r[3], {});
      const ts = r[4] ? String(r[4]) : '';
      if (ts > maxTs) maxTs = ts;
    }
  }
  const m = readMeta_();
  if (m.updated_at > maxTs) maxTs = m.updated_at;
  const meta = m.meta || {};
  const data = {
    schema: 'sangoku_group_v1',
    users: users,
    ownerships: ownerships,
    playerStats: playerStats,
    formations: meta.formations || [],
    priority: meta.priority || {},
    aggMode: meta.aggMode || '',
    activeUserId: (meta.activeUserId == null ? (users[0] && users[0].id) : meta.activeUserId),
  };
  return jsonOut_({ ok: true, data: data, updated_at: maxTs });
}

// ============================================================
// 受信箱（★従来のまま：列順・形式を変えない）
// ============================================================
function getInbox_() {
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  const rows = [];
  if (lastRow >= 2) {
    const data = sheet.getRange(2,1,lastRow-1,5).getValues();
    for (const r of data) {
      if (!r[0]) continue;
      rows.push({
        user_name: String(r[0]),
        ownerships: parseJson_(r[1], {}),
        updated_at: r[2] ? new Date(r[2]).toISOString() : '',
        image_refs: parseJson_(r[3], []),
        player_stats: parseJson_(r[4], null),
      });
    }
  }
  return jsonOut_({ ok: true, inbox: rows });
}

function submitUser_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet = getInboxSheet_();
    const name = String(obj.user_name || '').trim();
    if (!name) throw new Error('user_name required');
    const ownerships = obj.ownerships || {};
    const now = new Date();
    const imageRefs = [];
    if (Array.isArray(obj.images)) {
      const folder = getImageFolder_();
      const ts = Utilities.formatDate(now, 'JST', 'yyyyMMdd_HHmmss');
      for (let i = 0; i < obj.images.length; i++) {
        const img = obj.images[i];
        if (!img || !img.base64) continue;
        try {
          const bytes = Utilities.base64Decode(img.base64);
          const safeName = name + '_' + ts + '_' + (i+1) + '.' + ((img.mimeType||'image/png').split('/')[1]||'png');
          const blob = Utilities.newBlob(bytes, img.mimeType || 'image/png', safeName);
          const file = folder.createFile(blob);
          try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
          imageRefs.push({ name: safeName, fileId: file.getId(), url: file.getUrl() });
        } catch (e) {}
      }
    }
    const lastRow = sheet.getLastRow();
    let targetRow = -1;
    if (lastRow >= 2) {
      const names = sheet.getRange(2,1,lastRow-1,1).getValues();
      for (let i = 0; i < names.length; i++) if (String(names[i][0]) === name) { targetRow = i+2; break; }
    }
    const isNew = (targetRow === -1);
    if (isNew) targetRow = lastRow + 1;
    // 画像が新規に添付されなかった & 既存行 → 既存の image_refs を維持（消さない）
    let imageRefsToSave = imageRefs;
    if (imageRefs.length === 0 && !isNew) {
      imageRefsToSave = parseJson_(sheet.getRange(targetRow, 4).getValue(), []);
    }
    sheet.getRange(targetRow,1).setValue(name);
    sheet.getRange(targetRow,2).setValue(JSON.stringify(ownerships));
    sheet.getRange(targetRow,3).setValue(now);
    sheet.getRange(targetRow,4).setValue(JSON.stringify(imageRefsToSave));
    // 暗証番号（4桁数字）: 送信時に設定。直近のもので上書き。空送信時は据え置き。
    const pin = String(obj.pin || '').trim();
    if (/^\d{4}$/.test(pin)) {
      const cell = sheet.getRange(targetRow, 6);
      cell.setNumberFormat('@');   // テキスト書式（先頭0を保持）
      cell.setValue(pin);
    }
    return jsonOut_({ ok: true, image_count: imageRefs.length, image_kept: imageRefsToSave.length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// 暗証番号で本人の前回送信データを取得（「📥 前回の登録を呼び戻す」用）。
// 保存pinが空（既存ユーザー）なら "1234" として照合。pin不一致/未送信は ok:false。
function getUserByPin_(e) {
  const name = String((e.parameter && e.parameter.user_name) || '').trim();
  const pin = String((e.parameter && e.parameter.pin) || '').trim();
  if (!name) return jsonOut_({ ok: false, error: 'user_name required' });
  if (!/^\d{4}$/.test(pin)) return jsonOut_({ ok: false, error: 'pin must be 4 digits' });
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut_({ ok: false, error: 'not_found' });
  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  for (const r of data) {
    if (String(r[0]) === name) {
      const savedPin = String(r[5] == null ? '' : r[5]).trim() || '1234';  // 空なら1234
      if (savedPin !== pin) return jsonOut_({ ok: false, error: 'pin_mismatch' });
      return jsonOut_({ ok: true, ownerships: parseJson_(r[1], {}), player_stats: parseJson_(r[4], null) });
    }
  }
  return jsonOut_({ ok: false, error: 'not_found' });
}

function updateStats_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sheet = getInboxSheet_();
    const name = String(obj.user_name || '').trim();
    if (!name) throw new Error('user_name required');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('inbox empty');
    const names = sheet.getRange(2,1,lastRow-1,1).getValues();
    let targetRow = -1;
    for (let i = 0; i < names.length; i++) if (String(names[i][0]) === name) { targetRow = i+2; break; }
    if (targetRow === -1) throw new Error('user not found: ' + name);
    sheet.getRange(targetRow,5).setValue(JSON.stringify(obj.player_stats || {}));
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function reOcr_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(40000);
  try {
    const sheet = getInboxSheet_();
    const name = String(obj.user_name || '').trim();
    if (!name) throw new Error('user_name required');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('inbox empty');
    const data = sheet.getRange(2,1,lastRow-1,5).getValues();
    let targetRow = -1, imageRefs = [];
    for (let i = 0; i < data.length; i++) if (String(data[i][0]) === name) { targetRow = i+2; imageRefs = parseJson_(data[i][3], []); break; }
    if (targetRow === -1) throw new Error('user not found');
    if (!imageRefs.length) throw new Error('no images');
    const stats = ocrPlayerStats_(imageRefs);
    if (!stats) throw new Error('OCR failed');
    sheet.getRange(targetRow,5).setValue(JSON.stringify(stats));
    return jsonOut_({ ok: true, stats: stats });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function ocrPlayerStats_(imageRefs) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { Logger.log('No GEMINI_API_KEY'); return null; }
  if (!Array.isArray(imageRefs) || !imageRefs.length) return null;
  const model = 'gemini-flash-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const TROOPS = ['歩兵','騎兵','弓兵','戦車'];
  const TROOP_ATTRS = ['攻撃ボーナス','防御ボーナス','速度ボーナス','攻城ボーナス','荷重ボーナス','シールド付加','貫通付加','連撃付加','抵抗付加','貫通抵抗付加','軍紀付加'];
  const DEBUFFS = ['攻撃','防御','シールド','貫通','連撃','抵抗','貫通抵抗','軍紀'];
  let items = ['行軍部隊総数','出征可軍団上限'];
  for (const t of TROOPS) for (const a of TROOP_ATTRS) items.push(t + a);
  items.push('戦車支援付加');
  for (const d of DEBUFFS) items.push('敵方の' + d + 'に対する減益');
  for (const b of ['連撃上昇','抵抗上昇','シールド上昇','貫通上昇','攻撃上昇','防御上昇','貫通抵抗上昇']) items.push(b);
  const prompt = '三国覇王戦記の「兵士属性」「武府属性」スクショから値を抽出してください。\n' +
    '各項目に数値を1行ずつ「項目名: 数値」形式で出力。スクショに無い項目は省略可。%や説明文・コードブロック不要。\n\n【項目一覧】\n' + items.join('\n');
  const parts = [{ text: prompt }];
  for (const ref of imageRefs) {
    if (!ref || !ref.fileId) continue;
    try {
      const blob = DriveApp.getFileById(ref.fileId).getBlob();
      parts.push({ inline_data: { mime_type: blob.getContentType() || 'image/png', data: Utilities.base64Encode(blob.getBytes()) } });
    } catch (e) {}
  }
  if (parts.length === 1) return null;
  const res = UrlFetchApp.fetch(url, { method: 'POST', contentType: 'application/json', payload: JSON.stringify({ contents: [{ parts: parts }] }), muteHttpExceptions: true });
  Logger.log('Gemini status: ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) { Logger.log(res.getContentText().substring(0,500)); return null; }
  const r = JSON.parse(res.getContentText());
  const text = (r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts && r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text) || '';
  Logger.log('Gemini text: ' + text.substring(0,400));
  return parsePlayerStatsText_(text);
}

function parsePlayerStatsText_(text) {
  const TROOPS = ['歩兵','騎兵','弓兵','戦車'];
  const TROOP_ATTRS = [['attack','攻撃ボーナス'],['defense','防御ボーナス'],['speed','速度ボーナス'],['siege','攻城ボーナス'],['load','荷重ボーナス'],['shield','シールド付加'],['pierce','貫通付加'],['rensa','連撃付加'],['resist','抵抗付加'],['pierce_resist','貫通抵抗付加'],['discipline','軍紀付加']];
  const DEBUFFS = [['attack','攻撃'],['defense','防御'],['shield','シールド'],['pierce','貫通'],['rensa','連撃'],['resist','抵抗'],['pierce_resist','貫通抵抗'],['discipline','軍紀']];
  const BUFU = [['rensa','連撃上昇'],['resist','抵抗上昇'],['shield','シールド上昇'],['pierce','貫通上昇'],['attack','攻撃上昇'],['defense','防御上昇'],['pierce_resist','貫通抵抗上昇']];
  const ps = { general: { march_count: null, max_legions: null }, by_troop: {}, tank_support: null, debuff_enemy: {}, bufu_attrs: [] };
  for (const t of TROOPS) { ps.by_troop[t] = {}; for (const a of TROOP_ATTRS) ps.by_troop[t][a[0]] = null; }
  for (const d of DEBUFFS) ps.debuff_enemy[d[0]] = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const m = raw.match(/^[\s\-・*]*(.+?)[:：\s]+(-?[\d,]+(?:\.\d+)?)\s*[%％]?\s*$/);
    if (!m) continue;
    const key = m[1].trim().replace(/\s+/g, '');
    const val = parseFloat(m[2].replace(/,/g, ''));
    if (key === '行軍部隊総数') { ps.general.march_count = val; continue; }
    if (key === '出征可軍団上限') { ps.general.max_legions = val; continue; }
    if (key === '戦車支援付加') { ps.tank_support = val; continue; }
    const bf = BUFU.find(function(x){ return x[1] === key; });
    if (bf) { if (val > 0 && ps.bufu_attrs.indexOf(bf[0]) < 0) ps.bufu_attrs.push(bf[0]); continue; }
    const db = key.match(/^敵方の(.+?)に対する減益$/);
    if (db) { const f = DEBUFFS.find(function(x){ return x[1] === db[1]; }); if (f) ps.debuff_enemy[f[0]] = val; continue; }
    for (const t of TROOPS) {
      if (key.indexOf(t) !== 0) continue;
      const rest = key.slice(t.length);
      const f = TROOP_ATTRS.find(function(x){ return x[1] === rest; });
      if (f) { ps.by_troop[t][f[0]] = val; break; }
    }
  }
  return ps;
}

function deleteInbox_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sheet = getInboxSheet_();
    const name = String(obj.user_name || '').trim();
    if (!name) throw new Error('user_name required');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('inbox empty');
    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    let targetRow = -1, imageRefs = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]) === name) { targetRow = i + 2; imageRefs = parseJson_(data[i][3], []); break; }
    }
    if (targetRow === -1) throw new Error('user not found');
    if (obj.delete_images) {
      for (const ref of imageRefs) {
        try { if (ref && ref.fileId) DriveApp.getFileById(ref.fileId).setTrashed(true); } catch (e) {}
      }
    }
    sheet.deleteRow(targetRow);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// ---------- 手動実行用 ----------
function authorizeDrive() { getImageFolder_(); Logger.log('Drive authorized OK'); }
function testOcrLatest() {
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('inbox empty'); return; }
  const data = sheet.getRange(lastRow,1,1,5).getValues()[0];
  const imageRefs = parseJson_(data[3], []);
  Logger.log('Testing OCR for: ' + data[0] + ' with ' + imageRefs.length + ' images');
  Logger.log('Result: ' + JSON.stringify(ocrPlayerStats_(imageRefs)));
}
