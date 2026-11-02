// Minimal in-memory mock of the Apps Script services used by the backend.
const crypto = require('crypto'), fs = require('fs'), path = require('path'), vm = require('vm');

function signed(buf) { return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); }
function toBuf(v) { return Array.isArray(v) ? Buffer.from(v.map(b => (b < 0 ? b + 256 : b))) : Buffer.from(String(v), 'utf8'); }

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.cell(this.r + i, this.c + j)); out.push(row); } return out; }
  setValues(v) { if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('range size mismatch'); v.forEach((row, i) => row.forEach((x, j) => this.sh.setCell(this.r + i, this.c + j, x))); return this; }
  setNumberFormat() { return this; } setNumberFormats() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.hidden = false; this.maxRows = 1000; }
  cell(r, c) { return (this.rows[r - 1] && this.rows[r - 1][c - 1] !== undefined) ? this.rows[r - 1][c - 1] : ''; }
  setCell(r, c, v) {
    if (typeof v === 'string' && v.length > 50000) throw new Error('Cell limit exceeded (' + v.length + ')');
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v; if (r > this.maxRows) this.maxRows = r;
  }
  getLastRow() { for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(x => x !== '' && x !== undefined)) return i + 1; return 0; }
  getMaxRows() { return this.maxRows; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() {} hideSheet() { this.hidden = true; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
}
class Spreadsheet {
  constructor() { this.sheets = [new Sheet('Sheet1')]; this.id = 'SS_' + crypto.randomBytes(4).toString('hex'); }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; } deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function createContext(store = {}) {
  store.props = store.props || {}; store.books = store.books || {};
  const sandbox = {
    console, Date, JSON, Math, Number, String, Array, Object, Promise, Error, isFinite, encodeURIComponent, decodeURIComponent, parseInt,
    Logger: { log: (...a) => { if (process.env.GAS_LOG) console.log('[Logger]', ...a); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store.props ? store.props[k] : null), setProperty: (k, v) => { store.props[k] = String(v); } }) },
    SpreadsheetApp: {
      openById: id => store.books[id], create: () => { const s = new Spreadsheet(); store.books[s.id] = s; return s; },
      getActiveSpreadsheet: () => null
    },
    LockService: { getScriptLock: () => ({ waitLock() { if (store.locked) throw new Error('lock busy'); store.locked = true; }, releaseLock() { store.locked = false; } }) },
    LanguageApp: { translate: (t, a, b) => 'KN[' + t + ']' },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 400, getContentText: () => '{}' }) },
    MailApp: {
      getRemainingDailyQuota: () => {
        if (store.mailQuotaError) throw new Error(store.mailQuotaError);
        return store.mailQuota === undefined ? 100 : store.mailQuota;
      },
      sendEmail: message => {
        if (store.mailError) throw new Error(store.mailError);
        store.sentEmails = store.sentEmails || [];
        store.sentEmails.push(message);
      }
    },
    GmailApp: {
      getAliases: () => store.gmailAliases || ['kamageremart04@gmail.com'],
      sendEmail: (to, subject, body, options) => {
        if (store.mailError) throw new Error(store.mailError);
        store.sentEmails = store.sentEmails || [];
        store.sentEmails.push({ to, subject, body, ...options });
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
      createHtmlOutputFromFile: n => ({ getContent: () => fs.readFileSync(path.join(store.srcDir, n + '.html'), 'utf8') }),
      createTemplateFromFile: n => ({ evaluate() { return { setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }, tpl: this }; } })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, v) => signed(crypto.createHash('sha256').update(toBuf(v)).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
      base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => signed(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
      formatDate: (d, tz, f) => d.toISOString(), sleep: () => {}
    }
  };
  const ctx = vm.createContext(sandbox);
  ctx.__store = store;
  return ctx;
}

function loadBackend(srcDir, store) {
  store = store || {}; store.srcDir = srcDir;
  const ctx = createContext(store);
  for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.gs') || f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
module.exports = { loadBackend };
