/**
 * Db.gs : a tiny "database" on top of Google Sheets.
 * Each sheet (tab) is a table, row 1 holds the column names.
 *
 * Column types:  's' text, 'n' number, 'b' text that may be longer than the
 * 50 000 character cell limit (photos) – long values are split over the
 * hidden "Blobs" sheet and the cell keeps a  blob:<id>  reference.
 */

var CELL_LIMIT = 45000;
var CHUNK = 40000;

var SCHEMAS = {
  Users: [['id', 'n'], ['name', 's'], ['email', 's'], ['phone', 's'], ['password', 's'], ['address', 's'], ['profileImage', 'b']],
  PendingRegistrations: [['email', 's'], ['name', 's'], ['phone', 's'], ['password', 's'], ['address', 's'],
    ['codeHash', 's'], ['expiresAt', 'n'], ['attempts', 'n'], ['lastSentAt', 'n']],
  Orders: [['id', 's'], ['userId', 's'], ['date', 's'], ['items', 'b'], ['subtotal', 'n'], ['delivery', 'n'], ['total', 'n'],
    ['customerName', 's'], ['customerPhone', 's'], ['customerEmail', 's'], ['address', 's'], ['payment', 's'], ['status', 's'],
    ['source', 's'], ['createdAt', 'n'], ['cancelTokenHash', 's'], ['trackingTokenHash', 's'], ['invoiceStatus', 's']],
  Products: [['id', 'n'], ['name', 's'], ['category', 's'], ['unit', 's'], ['price', 'n'], ['oldPrice', 'n'], ['discount', 'n'],
    ['image', 'b'], ['description', 's'], ['stock', 'n']],
  Settings: [['settingKey', 's'], ['settingValue', 'b']],
  TranslationCache: [['sourceHash', 's'], ['sourceText', 's'], ['translatedText', 's']],
  Blobs: [['blobId', 's'], ['idx', 'n'], ['chunk', 's']]
};

var _ss = null;
var _schemaChecked = false;
var _blobCache = null;

// ---------------------------------------------------------------- spreadsheet

function ss_() {
  if (_ss) return _ss;
  var id = DATABASE_SPREADSHEET_ID || prop_('SPREADSHEET_ID');
  if (id) {
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }
  var active = null;
  try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { active = null; }
  if (active) {
    _ss = active;
  } else {
    _ss = SpreadsheetApp.create('Kamagere Mart Database');
  }
  setProp_('SPREADSHEET_ID', _ss.getId());
  return _ss;
}

function sheet_(name) {
  ensureSchema_(false);
  return ss_().getSheetByName(name);
}

function columns_(name) {
  return SCHEMAS[name];
}

function textFormats_(name) {
  return columns_(name).map(function (c) { return c[1] === 'n' ? '0.######' : '@'; });
}

/** Creates the tabs, headers and the default products (first run only). */
function ensureSchema_(force) {
  if (_schemaChecked && !force) return;
  if (!force && prop_('SCHEMA_READY') === '4') {
    _schemaChecked = true;
    return;
  }
  var ss = ss_();
  Object.keys(SCHEMAS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var cols = columns_(name);
    if (!sh) sh = ss.insertSheet(name);
    var header = cols.map(function (c) { return c[0]; });
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#dcfce7');
    sh.setFrozenRows(1);
    // plain-text columns so phone numbers / hashes are never turned into numbers or formulas
    cols.forEach(function (c, i) {
      if (c[1] !== 'n') sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
    sh.getRange(1, 1, 1, header.length).setNumberFormat('@');
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  var blobs = ss.getSheetByName('Blobs');
  if (blobs) blobs.hideSheet();
  _schemaChecked = true;
  setProp_('SCHEMA_READY', '4');

  if (readTable_('Products').rows.length === 0) seedDefaultProducts_(true);
  if (!getSetting_('store_location')) setSetting_('store_location', DEFAULT_STORE_LOCATION);
}

// ---------------------------------------------------------------------- blobs

function loadBlobs_() {
  if (_blobCache) return _blobCache;
  var sh = ss_().getSheetByName('Blobs');
  var map = {};
  if (sh && sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    vals.forEach(function (r) {
      if (!map[r[0]]) map[r[0]] = [];
      map[r[0]][Number(r[1])] = String(r[2]);
    });
  }
  _blobCache = map;
  return map;
}

function packBlob_(value) {
  value = value == null ? '' : String(value);
  if (value.length <= CELL_LIMIT) return value;
  var id = 'blob:' + Utilities.getUuid().replace(/-/g, '');
  var rows = [];
  for (var i = 0, n = 0; i < value.length; i += CHUNK, n++) {
    rows.push([id, n, value.substr(i, CHUNK)]);
  }
  var sh = ss_().getSheetByName('Blobs');
  var start = sh.getLastRow() + 1;
  var range = sh.getRange(start, 1, rows.length, 3);
  range.setNumberFormats(rows.map(function () { return ['@', '0', '@']; }));
  range.setValues(rows);
  _blobCache = null;
  return id;
}

function releaseBlob_(ref) {
  if (typeof ref !== 'string' || ref.indexOf('blob:') !== 0) return;
  var sh = ss_().getSheetByName('Blobs');
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === ref) sh.deleteRow(i + 2);
  }
  _blobCache = null;
}

function unpackBlob_(value) {
  if (typeof value !== 'string' || value.indexOf('blob:') !== 0) return value;
  var parts = loadBlobs_()[value];
  return parts ? parts.join('') : '';
}

// ---------------------------------------------------------------------- tables

function coerce_(type, v) {
  if (type === 'n') {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Reads a whole sheet -> { rows: [ {col: value, _row: sheetRowNumber} ] } */
function readTable_(name) {
  var sh = ss_().getSheetByName(name);
  var cols = columns_(name);
  var rows = [];
  var last = sh.getLastRow();
  if (last > 1) {
    var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
    values.forEach(function (r, idx) {
      var obj = { _row: idx + 2 };
      var empty = true;
      cols.forEach(function (c, i) {
        var v = coerce_(c[1], r[i]);
        if (c[1] === 'b') v = unpackBlob_(v);
        if (v !== '' && v !== 0) empty = false;
        obj[c[0]] = v;
      });
      if (!empty) rows.push(obj);
    });
  }
  return { sheet: sh, rows: rows };
}

function toRow_(name, obj, packed) {
  return columns_(name).map(function (c) {
    var v = obj[c[0]];
    if (c[1] === 'n') return Number(v) || 0;
    v = v == null ? '' : String(v);
    if (c[1] === 'b') v = packed ? packed[c[0]] : packBlob_(v);
    return v;
  });
}

function insertRow_(name, obj) {
  var sh = ss_().getSheetByName(name);
  var row = toRow_(name, obj);
  var target = sh.getLastRow() + 1;
  var range = sh.getRange(target, 1, 1, row.length);
  range.setNumberFormats([textFormats_(name)]);
  range.setValues([row]);
  return target;
}

function updateRow_(name, rowNumber, obj) {
  var sh = ss_().getSheetByName(name);
  var cols = columns_(name);
  var range = sh.getRange(rowNumber, 1, 1, cols.length);
  var old = range.getValues()[0];
  var row = cols.map(function (c, i) {
    var v = obj[c[0]];
    if (c[1] === 'n') return Number(v) || 0;
    v = v == null ? '' : String(v);
    if (c[1] === 'b') {
      var oldRef = String(old[i] || '');
      var current = unpackBlob_(oldRef);
      if (v === current) return oldRef; // unchanged photo: keep the stored reference
      releaseBlob_(oldRef);
      return packBlob_(v);
    }
    return v;
  });
  range.setNumberFormats([textFormats_(name)]);
  range.setValues([row]);
}

function deleteRow_(name, rowNumber) {
  var sh = ss_().getSheetByName(name);
  var cols = columns_(name);
  var old = sh.getRange(rowNumber, 1, 1, cols.length).getValues()[0];
  cols.forEach(function (c, i) {
    if (c[1] === 'b') releaseBlob_(String(old[i] || ''));
  });
  sh.deleteRow(rowNumber);
}

function nextId_(name) {
  var max = 0;
  readTable_(name).rows.forEach(function (r) { if (r.id > max) max = r.id; });
  return max + 1;
}

// ------------------------------------------------------------------- settings

function getSetting_(key) {
  var rows = readTable_('Settings').rows;
  for (var i = 0; i < rows.length; i++) if (rows[i].settingKey === key) return rows[i].settingValue;
  return '';
}

function setSetting_(key, value) {
  var rows = readTable_('Settings').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].settingKey === key) {
      updateRow_('Settings', rows[i]._row, { settingKey: key, settingValue: value });
      return;
    }
  }
  insertRow_('Settings', { settingKey: key, settingValue: value });
}

// ----------------------------------------------------------------------- lock

/** Runs fn while holding the script lock so two customers can never buy the last item at once. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
