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
const REQUESTS_SHEET = 'requests';
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
  if (action === 'get_requests') return getRequests_();       // 要望一覧
  if (action === 'plan_request') return planRequest_(e);       // 要望AIプランニング
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
    if (obj && obj.action === 'submit_request') return submitRequest_(obj);   // 要望を保存
    if (obj && obj.action === 'plan_request') return planRequestFromPayload_(obj); // 要望AIプランニング
    if (obj && obj.action === 'update_request') return updateRequest_(obj);   // 要望ステータス変更
    if (obj && obj.action === 'delete_request') return deleteRequest_(obj);   // 要望削除
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

function callGeminiText_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = 'gemini-flash-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 1600,
    },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  Logger.log('Gemini plan status: ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    Logger.log(res.getContentText().substring(0, 500));
    throw new Error('Gemini request failed: HTTP ' + res.getResponseCode());
  }
  const r = JSON.parse(res.getContentText());
  return (r.candidates && r.candidates[0] && r.candidates[0].content &&
    r.candidates[0].content.parts && r.candidates[0].content.parts[0] &&
    r.candidates[0].content.parts[0].text) || '';
}

function stripCodeFence_(text) {
  const s = String(text || '').trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1].trim() : s;
}

function buildRequestPlanPrompt_(obj) {
  const category = String(obj.category || 'その他').slice(0, 40);
  const userName = String(obj.user_name || '').slice(0, 80);
  const requestText = String(obj.text || '').slice(0, 1800);
  const extra = String(obj.message || '').slice(0, 1200);
  const history = Array.isArray(obj.history) ? obj.history.slice(-8).map(function(h) {
    return {
      role: String(h && h.role || '').slice(0, 20),
      text: String(h && h.text || '').slice(0, 900),
    };
  }) : [];
  return [
    'あなたは「三国覇王戦記 編成シミュレーター」の要望整理AIです。',
    'このシステムは、武将データ、所持武将、兵士属性、軍団兵種、主陣/角陣、優先ステータス、クラウド同期、要望一覧を扱います。',
    'あなたの役割は、実装前のプランニングまでです。コードを直接変更する、公開する、承認する、対応済みにする、とは言わないでください。',
    '曖昧な点があれば確認質問を出しつつ、現時点の仮プランも作ってください。',
    '返答は必ずJSONだけにしてください。Markdownのコードブロックは禁止です。',
    'JSON schema: {"reply":"画面に表示する短い返答","draft_text":"要望一覧へ保存する本文"}',
    'draft_text は次の見出しを必ず含めてください: 【ユーザー原文】, 【AI整理】, 【実装前プラン】, 【受け入れ条件】, 【確認事項】。',
    '実装前プランは3から6項目、受け入れ条件は2から5項目にしてください。',
    '',
    '【名前】' + userName,
    '【種別】' + category,
    '【現在の要望本文】',
    requestText,
    '',
    '【追加メッセージ】',
    extra,
    '',
    '【これまでのAI相談履歴JSON】',
    JSON.stringify(history),
  ].join('\n');
}

function planRequestFromPayload_(obj) {
  try {
    const prompt = buildRequestPlanPrompt_(obj || {});
    const raw = callGeminiText_(prompt);
    let parsed;
    try {
      parsed = JSON.parse(stripCodeFence_(raw));
    } catch (e) {
      parsed = {
        reply: 'AIの返答形式が少し崩れたため、本文として取り込みました。',
        draft_text: String(raw || '').trim(),
      };
    }
    const reply = String(parsed.reply || '').trim();
    const draftText = String(parsed.draft_text || '').trim();
    if (!draftText) throw new Error('empty AI draft');
    return jsonOut_({ ok: true, kind: 'request_plan', reply: reply, draft_text: draftText });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function planRequest_(e) {
  try {
    const payload = e && e.parameter && e.parameter.payload;
    const obj = payload ? JSON.parse(payload) : {};
    return planRequestFromPayload_(obj);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
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

// ============================================================
// 要望（requests）: 同期モードのフォームから送信 → 一覧・ステータス管理
//   列: created_at | user_name | category | text | status | updated_at
// ============================================================
function getRequestsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(REQUESTS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REQUESTS_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['created_at', 'user_name', 'category', 'text', 'status', 'updated_at']]);
  }
  return sheet;
}

function getRequests_() {
  const sheet = getRequestsSheet_();
  const last = sheet.getLastRow();
  const rows = [];
  if (last >= 2) {
    const vals = sheet.getRange(2, 1, last - 1, 6).getValues();
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      if (!r[0] && !r[3]) continue;
      rows.push({
        id: r[0] ? new Date(r[0]).toISOString() : String(i),  // created_at を一意キーに
        created_at: r[0] ? new Date(r[0]).toISOString() : '',
        user_name: String(r[1] || ''),
        category: String(r[2] || ''),
        text: String(r[3] || ''),
        status: String(r[4] || '未対応'),
        updated_at: r[5] ? new Date(r[5]).toISOString() : '',
      });
    }
  }
  return jsonOut_({ ok: true, requests: rows });
}

function submitRequest_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sheet = getRequestsSheet_();
    const text = String(obj.text || '').trim();
    if (!text) throw new Error('text required');
    const now = new Date();
    sheet.appendRow([now, String(obj.user_name || ''), String(obj.category || 'その他'), text, '未対応', now]);
    return jsonOut_({ ok: true, created_at: now.toISOString() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

// created_at（ISO文字列）で行を特定してステータス更新
function updateRequest_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sheet = getRequestsSheet_();
    const id = String(obj.id || '');
    const status = String(obj.status || '');
    const last = sheet.getLastRow();
    if (last < 2) throw new Error('empty');
    const ts = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ts.length; i++) {
      if (ts[i][0] && new Date(ts[i][0]).toISOString() === id) {
        sheet.getRange(i + 2, 5).setValue(status);
        sheet.getRange(i + 2, 6).setValue(new Date());
        return jsonOut_({ ok: true });
      }
    }
    return jsonOut_({ ok: false, error: 'not_found' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

function deleteRequest_(obj) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sheet = getRequestsSheet_();
    const id = String(obj.id || '');
    const last = sheet.getLastRow();
    if (last < 2) throw new Error('empty');
    const ts = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ts.length; i++) {
      if (ts[i][0] && new Date(ts[i][0]).toISOString() === id) {
        sheet.deleteRow(i + 2);
        return jsonOut_({ ok: true });
      }
    }
    return jsonOut_({ ok: false, error: 'not_found' });
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
