/**
 * Code.gs : entry points + API router.
 *
 * doGet(e)      -> serves the customer or admin portal [also  ?api=/api/products  for quick JSON tests]
 * doPost(e)     -> JSON API for external clients (Postman, other websites)
 * apiCall(json) -> called by the front end through google.script.run
 */

// --- helpers

function ok_(body, status) {
  return { status: status || 200, body: body };
}

function fail_(status, message) {
  return { status: status, body: { message: message } };
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function registrationCodeHash_(email, code) {
  return sha256Hex_(prop_('ADMIN_JWT_SECRET') + ':' + email + ':' + code);
}

function findPendingRegistration_(email) {
  return findUserBy_(readTable_('PendingRegistrations'), function (row) {
    return row.email === email;
  });
}

// --- web entries

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.api) {
    var res = handleApi_({ method: 'GET', path: String(p.api), authorization: p.token ? 'Bearer ' + p.token : '' });
    return jsonOut_(res.body);
  }
  var isAdmin = Object.prototype.hasOwnProperty.call(p, 'qadmin');
  var t = HtmlService.createTemplateFromFile(isAdmin ? 'AdminPanel' : 'UserPortal');
  if (!isAdmin) t.route = String(p.page || '').replace(/[^a-z-]/g, '');
  var pageTitle = isAdmin
    ? 'Kamagere Mart — Admin panel'
    : (typeof APP_TITLE !== 'undefined' ? APP_TITLE : 'Kamagere Mart');
  return t.evaluate()
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ message: 'Request body must be JSON.' });
  }
  var res = handleApi_(req);
  return jsonOut_(req.envelope ? res : res.body);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiCall(requestJson) {
  var req;
  try {
    req = JSON.parse(requestJson);
  } catch (e) {
    return JSON.stringify(fail_(400, 'Bad request.'));
  }
  return JSON.stringify(handleApi_(req));
}

// --- router

var _routes = null;
function routes_() {
  if (_routes) return _routes;
  _routes = [
    ['GET', /^\/health$/, function () { return ok_({ status: 'ok', service: 'Kamagere Mart Backend (Apps Script)' }); }, null, false],

    // products
    ['GET', /^\/api\/products$/, listProducts_, null, false],
    ['GET', /^\/api\/categories$/, listCategoryGroups_, null, false],
    ['PUT', /^\/api\/admin\/categories$/, updateCategoryGroups_, 'admin', true],
    ['POST', /^\/api\/product-translations$/, productTranslations_, null, true],
    ['POST', /^\/api\/products$/, createProduct_, 'admin', true],
    ['PUT', /^\/api\/products\/(\d+)$/, updateProduct_, 'admin', true],
    ['PATCH', /^\/api\/products\/(\d+)\/stock$/, setStock_, 'admin', true],
    ['PATCH', /^\/api\/products\/(\d+)$/, quickUpdateProduct_, 'admin', true],
    ['DELETE', /^\/api\/products\/(\d+)$/, deleteProduct_, 'admin', true],
    ['POST', /^\/api\/admin\/products\/restore-defaults$/, restoreDefaults_, 'admin', true],

    // settings
    ['GET', /^\/api\/payment-config$/, getPaymentConfig_, null, false],
    ['GET', /^\/api\/store-location$/, getStoreLocation_, null, false],
    ['PUT', /^\/api\/admin\/store-location$/, putStoreLocation_, 'admin', true],

    // auth
    ['GET', /^\/api\/auth\/google\/config$/, googleConfig_, null, false],
    ['POST', /^\/api\/auth\/google$/, googleSignIn_, null, true],
    ['POST', /^\/api\/register$/, register_, null, true],
    ['POST', /^\/api\/register\/verify$/, verifyRegistration_, null, true],
    ['POST', /^\/api\/register\/resend$/, resendRegistrationCode_, null, true],
    ['POST', /^\/api\/login$/, login_, null, false],
    ['PUT', /^\/api\/profile$/, updateProfile_, 'customer', true],
    ['GET', /^\/api\/admin\/session$/, adminSession_, 'admin', false],
    ['POST', /^\/api\/admin\/login$/, adminLogin_, null, false],

    // orders
    ['POST', /^\/api\/orders$/, placeOrder_, null, true],
    ['GET', /^\/api\/orders\/([^\/]+)\/track$/, trackOrder_, null, false],
    ['PATCH', /^\/api\/admin\/orders\/([^\/]+)\/cancel$/, adminCancelOrder_, 'admin', true],
    ['PATCH', /^\/api\/orders\/([^\/]+)\/cancel$/, cancelOrder_, null, true],
    ['PATCH', /^\/api\/orders\/([^\/]+)\/status$/, updateOrderStatus_, 'admin', true],
    ['GET', /^\/api\/orders$/, listOrders_, 'admin', false]
  ];
  return _routes;
}

function handleApi_(req) {
  try {
    var method = String((req && req.method) || 'GET').toUpperCase();
    var path = String((req && req.path) || '').split('?')[0].replace(/\/+$/, '') || '/';
    var body = req && req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    var ctx = { method: method, path: path, body: body && typeof body === 'object' ? body : {}, authorization: (req && req.authorization) || '' };

    ensureSchema_(false);

    var table = routes_();
    for (var i = 0; i < table.length; i++) {
      var r = table[i];
      if (r[0] !== method) continue;
      var m = r[1].exec(path);
      if (!m) continue;

      var auth = null;
      if (r[3] === 'admin') {
        auth = requireAdmin_(ctx);
        if (auth.error) return auth.error;
      } else if (r[3] === 'customer') {
        auth = requireCustomer_(ctx);
        if (auth.error) return auth.error;
      }
      var run = function () { return r[2](ctx, m, auth); };
      var out = r[4] ? withLock_(run) : run();
      // slow follow-up work (e.g. the WhatsApp invoice) runs here, after the lock is released
      if (out && typeof out.after === 'function') {
        var after = out.after;
        delete out.after;
        try { after(); } catch (afterError) { console.error('After-hook error: ' + afterError); }
      }
      return out;
    }
    return fail_(404, 'Not found.');
  } catch (error) {
    var errorDetails = error && error.stack ? error.stack : String(error);
    console.error('API error: ' + errorDetails);
    Logger.log('API error: ' + errorDetails);
    return fail_(500, 'Server error');
  }
}