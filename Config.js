/**
 * Kamagere Mart – Google Apps Script backend
 * -------------------------------------------------------------
 * Config.gs : constants, Script Properties helpers, one-time setup
 *
 * Secrets (admin e-mail / password, JWT secret) live in
 * Project Settings -> Script Properties, NEVER in the code.
 * Run the function  setup()  once (see GUIDE.md) and it creates them for you.
 */

var DATABASE_SPREADSHEET_ID = '';
var DEFAULT_STORE_LOCATION = 'Koramangala, Bengaluru, Karnataka, India';
var DEFAULT_STOCK = 20;
var MAX_STOCK = 1000000;
var TZ = 'Asia/Kolkata';
var APP_TITLE = 'Kamagere Mart — Fresh essentials delivered';

var EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
var PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{8,}$/;
var PHONE_REGEX = /^[6-9]\d{9}$/;
// Orders are sent on WhatsApp to the ADMIN (store) number, not to the customer.
// Can be overridden with the Script Property ADMIN_WHATSAPP (10 digits).
var DEFAULT_ADMIN_WHATSAPP = '9840250476';
var DEFAULT_ADMIN_EMAIL = 'Kamageremart04@gmail.com';

function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key) || '';
  if (!v && key === 'ADMIN_EMAIL') return DEFAULT_ADMIN_EMAIL;
  return v;
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

/**
 * RUN THIS from the Apps Script editor after granting access to the database sheet.
 *  - connects to the configured Google Sheet and creates its tabs / headers
 *  - seeds the 12 default products when the Products tab is empty
 *  - requires SPREADSHEET_ID, ADMIN_EMAIL and ADMIN_PASSWORD in Script Properties
 *  - creates ADMIN_JWT_SECRET if it does not exist yet
 */
function setup() {
  var spreadsheetId = DATABASE_SPREADSHEET_ID || prop_('SPREADSHEET_ID');
  var adminEmail = prop_('ADMIN_EMAIL');
  var adminPassword = prop_('ADMIN_PASSWORD');
  if (!spreadsheetId) throw new Error('Set SPREADSHEET_ID in Script Properties before running setup().');
  if (!EMAIL_REGEX.test(adminEmail)) throw new Error('Set a valid ADMIN_EMAIL in Script Properties before running setup().');
  if (!PASSWORD_REGEX.test(adminPassword)) {
    throw new Error('Set a strong ADMIN_PASSWORD in Script Properties before running setup().');
  }
  if (!prop_('SPREADSHEET_ID')) setProp_('SPREADSHEET_ID', spreadsheetId);

  _ss = null;
  _schemaChecked = false;
  _blobCache = null;
  if (!prop_('ADMIN_JWT_SECRET')) {
    setProp_('ADMIN_JWT_SECRET', randomHex_(16) + randomHex_(16) + randomHex_(16));
  }
  ensureSchema_(true);
  var url = ss_().getUrl();
  Logger.log('Setup complete.');
  Logger.log('Database sheet : ' + url);
  Logger.log('Admin e-mail   : ' + prop_('ADMIN_EMAIL'));
  return url;
}

/** Handy for the editor: logs how many rows each sheet holds. */
function status() {
  var out = {};
  Object.keys(SCHEMAS).forEach(function (name) {
    out[name] = Math.max(0, sheet_(name).getLastRow() - 1);
  });
  Logger.log(JSON.stringify(out));
  return out;
}
