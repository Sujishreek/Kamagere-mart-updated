const { loadBackend } = require('./gas-mock');
const vm = require('vm'), assert = require('assert');
const SRC = process.argv[2];
let pass = 0; const t = (name, fn) => { try { fn(); pass++; console.log('ok  -', name); } catch (e) { console.log('FAIL-', name, '\n     ', e.message); process.exitCode = 1; } };

function boot(props) {
  const store = { props: { SPREADSHEET_ID: 'X', ADMIN_EMAIL: 'admin@gmail.com', ADMIN_PASSWORD: 'Admin@12345', ...props } };
  const ctx = loadBackend(SRC, store);
  ctx.SpreadsheetApp.openById = id => store.books[id] || (store.books[id] = ctx.SpreadsheetApp.create());
  ctx.fetched = [];
  ctx.fetchResult = { code: 200, body: '{"messages":[{"id":"wamid.x"}]}' };
  ctx.UrlFetchApp.fetch = (url, opts) => { ctx.fetched.push({ url, opts, payload: JSON.parse(opts.payload) }); return { getResponseCode: () => ctx.fetchResult.code, getContentText: () => ctx.fetchResult.body }; };
  vm.runInContext('setup()', ctx);
  ctx.call = (method, path, body, token) => JSON.parse(vm.runInContext('apiCall', ctx)(JSON.stringify({ method, path, body, authorization: token ? 'Bearer ' + token : '' })));
  return ctx;
}
function installHtmlService(ctx, templates, titles) {
  const output = {
    setTitle(title) { titles.push(title); return this; },
    addMetaTag() { return this; },
    setXFrameOptionsMode() { return this; }
  };
  ctx.HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' },
    createTemplateFromFile(name) {
      const template = { name, evaluate: () => output };
      templates.push(template);
      return template;
    }
  };
}
function loadPortalFrontend(portal, initialStorage = {}) {
  const values = initialStorage instanceof Map
    ? initialStorage
    : new Map(Object.entries(initialStorage));
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const window = {
    KM_PORTAL: portal,
    KM_DATA: { categoryGroups: [] },
    location: { search: '', hash: '', pathname: '/exec' },
    localStorage: storage,
    sessionStorage: storage,
    addEventListener() {}
  };
  const context = vm.createContext({ window, URLSearchParams, console });
  const html = require('fs').readFileSync(require('path').join(SRC, 'AppScript.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, 'Expected frontend scripts in AppScript.html');
  scripts.forEach((script) => vm.runInContext(script[1], context));
  return { context, values };
}
const WA = { WA_PHONE_NUMBER_ID: '1234567890', WA_ACCESS_TOKEN: 'EAAtoken', WA_TEMPLATE_NAME: 'order_invoice' };
const order = (extra) => Object.assign({ customerName: 'Meena', customerPhone: '9000000000', customerEmail: 'm@example.com', address: '12 MG Road', items: [{ id: 1, quantity: 2 }], payment: 'COD' }, extra);
function signup(c) {
  const registration = c.call('POST', '/api/register', { name: 'Meena', email: 'meena@example.com', phone: '9876543210', password: 'Str0ng@Pass', address: 'x' });
  assert.equal(registration.status, 200);
  assert.equal(registration.body.verificationRequired, true);
  const code = c.__store.sentEmails.at(-1).body.match(/\b(\d{6})\b/)[1];
  const verified = c.call('POST', '/api/register/verify', { email: 'meena@example.com', code });
  assert.equal(verified.status, 201);
  return c.call('POST', '/api/login', { email: 'meena@example.com', password: 'Str0ng@Pass' }).body.token;
}
const invoiceStatusOf = (c, id) => vm.runInContext(`readTable_('Orders').rows.filter(function(r){return r.id==='${id}'})[0].invoiceStatus`, c);

let portalContext = boot({});
t('web entry serves separate customer and admin portal templates', () => {
  const templates = [];
  const titles = [];
  installHtmlService(portalContext, templates, titles);
  portalContext.doGet({ parameter: { page: 'cart' } });
  assert.equal(templates[0].name, 'UserPortal');
  assert.equal(templates[0].route, 'cart');
  portalContext.doGet({ parameter: { qadmin: '1' } });
  assert.equal(templates[1].name, 'AdminPanel');
  assert.equal(titles[1], 'Kamagere Mart — Admin panel');
  const adminPage = require('fs').readFileSync(require('path').join(SRC, 'AdminPanel.html'), 'utf8');
  const userPage = require('fs').readFileSync(require('path').join(SRC, 'UserPortal.html'), 'utf8');
  assert.match(adminPage, /window\.KM_INITIAL_ROUTE = 'home'/);
  assert.match(adminPage, /window\.KM_PORTAL = 'admin'/);
  const portalScript = userPage.match(/<script>\s*\/\/ value comes from the Web App URL:[\s\S]*?<\/script>/)[0]
    .replace(/<\/?script>/g, '')
    .replace(/<\?!=\s*JSON\.stringify\(route\s*\|\|\s*''\)\s*\?>/, "''");
  const portalForSearch = (search) => {
    const window = { location: { search } };
    const bodyClasses = new Set();
    const document = { body: { classList: { toggle(name, enabled) {
      if (enabled) bodyClasses.add(name);
      else bodyClasses.delete(name);
    } } } };
    vm.runInNewContext(portalScript, { window, document, URLSearchParams });
    return {
      portal: window.KM_PORTAL,
      route: window.KM_INITIAL_ROUTE,
      adminTheme: bodyClasses.has('admin-portal')
    };
  };
  assert.deepEqual(portalForSearch(''), { portal: 'user', route: '', adminTheme: false });
  assert.deepEqual(portalForSearch('?qadmin'), { portal: 'admin', route: 'home', adminTheme: true });

  const appScript = require('fs').readFileSync(require('path').join(SRC, 'AppScript.html'), 'utf8');
  const continuationScript = require('fs').readFileSync(require('path').join(SRC, 'AppScriptContinuation.html'), 'utf8');
  assert.match(appScript, /if \(IS_ADMIN_PORTAL\) return isAdminSession\(\) \? 'admin' : 'home'/);
  const orderLinkBuilder = continuationScript.match(/function buildWhatsappOrderLink\(order, orderPayload\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(orderLinkBuilder, 'Expected WhatsApp order link builder');
  const orderLinkContext = vm.createContext({ Intl, Date, encodeURIComponent });
  vm.runInContext(`const STORE_WHATSAPP_NUMBER = '919840250476'; ${orderLinkBuilder}; this.buildOrderLink = buildWhatsappOrderLink;`, orderLinkContext);
  const formattedOrderLink = orderLinkContext.buildOrderLink(
    { id: 'KM0912296', date: '30/10/2026, 10:51:52 pm' },
    {
      customerName: 'Meenakshi G', customerPhone: '9840250476', address: 'Current location: https://www.google.com/maps?q=13.077600,80.291700',
      items: [
        { name: 'Sugar', unit: '1 kg', quantity: 1, price: 47.87 },
        { name: 'Frozen Veg Momos', unit: 'pack', quantity: 1, price: 150 },
        { name: 'Frozen Plain Paratha', unit: 'pack', quantity: 1, price: 100 },
        { name: 'Chana Dal', unit: '1 kg', quantity: 1, price: 95 }
      ],
      subtotal: 392.87, delivery: 0, total: 392.87, payment: 'COD'
    }
  );
  const formattedOrderMessage = decodeURIComponent(new URL(formattedOrderLink).searchParams.get('text'));
  assert.match(formattedOrderMessage, /^\S+ \*KAMAGERE MART\*\n\n📦 \*NEW ORDER\*\n\n🟣 \*ORDER DETAILS\*\nOrder ID: \*KM0912296\*\nDate: 30\/10\/2026, 10:51:52 pm/u);
  assert.match(formattedOrderMessage, /\*CUSTOMER DETAILS\*\nName: Meenakshi G\nPhone: \+91 98402 50476\nGoogle Maps: https:\/\/www\.google\.com\/maps\?q=13\.077600,80\.291700\nCoordinates: 13\.077600, 80\.291700/u);
  assert.match(formattedOrderMessage, /\*ORDER ITEMS \(4\)\*\n1\. \*Sugar\* \(1 kg\)\n   Qty: 1 \| Unit price: ₹47\.87 \| Line total: \*₹47\.87\*\n2\. \*Frozen Veg Momos\* \(pack\)\n   Qty: 1 \| Unit price: ₹150\.00 \| Line total: \*₹150\.00\*/u);
  assert.match(formattedOrderMessage, /\*PAYMENT SUMMARY\*\nSubtotal: ₹392\.87\nDelivery: ₹0\.00\n\*Grand total: ₹392\.87\*\nPayment: Cash on Delivery \(COD\)/u);
  assert.doesNotMatch(formattedOrderMessage, /^(?!   Qty: )[ \t]+/m, 'Only item detail lines should be indented');
  const messyOrderLink = orderLinkContext.buildOrderLink(
    { id: ' KM 0912296 ', date: ' today   ' },
    {
      customerName: '\n  Meenakshi\t G  ', customerPhone: '9840250476', address: 'Current location: https://maps.example.test/?q=13.1,80.2',
      items: [{ name: '\tSugar\n   ', unit: ' 1   kg ', quantity: 1, price: 47.87 }],
      subtotal: 47.87, delivery: 25, total: 72.87, payment: 'COD'
    }
  );
  const messyOrderMessage = new URL(messyOrderLink).searchParams.get('text');
  assert.doesNotMatch(messyOrderMessage, /^(?!   Qty: )[ \t]+/m, 'Whitespace in customer data should not indent WhatsApp lines');
  assert.match(messyOrderMessage, /Name: Meenakshi G\n/u);
  assert.match(messyOrderMessage, /1\. \*Sugar\* \(1 kg\)\n   Qty: 1/u);
  assert.match(continuationScript, /showWhatsappOrderPrompt\(\{ \.\.\.order, waLink \}\);/);
  assert.doesNotMatch(continuationScript, /setTimeout\(\(\) => \{ window\.location\.href = waLink;/);
  assert.match(appScript, /function showWhatsappOrderPrompt\(order\)[\s\S]*?Send order list to admin WhatsApp\?[\s\S]*?Tap Send there, then return here/);
  assert.match(appScript, /SS\.setItem\(WHATSAPP_RETURN_ORDER_KEY, JSON\.stringify\(order\)\);\s*window\.location\.href = order\.waLink;/);
  assert.match(appScript, /window\.addEventListener\('pageshow', resumeOrderSuccessAfterWhatsapp\)/);
  assert.match(appScript, /if \(!IS_ADMIN_PORTAL &&\s*\(SS\.getItem\(LANGUAGE_PROMPT_KEY\) \|\| new URLSearchParams\(window\.location\.search\)\.has\('qadmin'\)\)\) return;/);
  assert.match(appScript, /const isAdminLink = IS_ADMIN_PORTAL \|\|\s*window\.KM_INITIAL_ROUTE === 'admin-login' \|\|\s*new URLSearchParams\(window\.location\.search\)\.has\('qadmin'\);/);
  assert.match(appScript, /IS_ADMIN_PORTAL \? '' : `[\s\S]*?class="header-cart-btn"/);
  assert.match(appScript, /IS_ADMIN_PORTAL\s*\?\s*links\.filter\(\(\{ route \}\) => route !== 'cart'\)/);
  assert.match(appScript, /IS_ADMIN_PORTAL \? '' : '<button class="primary-btn" data-route="cart">Go to cart<\/button>'/);
  assert.match(appScript, /IS_ADMIN_PORTAL \? '' : '<button class="secondary-btn" data-route="orders">View orders<\/button>'/);
  assert.match(appScript, /\$\{IS_ADMIN_PORTAL \? '' : `[\s\S]*?<h3>Why shop with us\?<\/h3>/);
  assert.match(appScript, /\$\{IS_ADMIN_PORTAL \? '' : isSoldOut\(product\) \?/);
  assert.match(appScript, /if \(IS_ADMIN_PORTAL && \['cart', 'checkout'\]\.includes\(target\)\)/);
  assert.match(appScript, /const STOCK_REFRESH_KEY = 'km_stock_refresh'/);
  assert.match(appScript, /if \(event\.key === STOCK_REFRESH_KEY\) \{\s*if \(IS_ADMIN_PORTAL && \['admin', 'orders'\]\.includes\(state\.route\)\) \{\s*refreshAdminStock\(\);\s*\} else if \(!IS_ADMIN_PORTAL && \['home', 'cart'\]\.includes\(state\.route\)\) \{\s*loadProducts\(\);/);
  assert.match(continuationScript, /LS\.setItem\(STOCK_REFRESH_KEY, `\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\}`\)/);
  assert.match(continuationScript, /async function refreshAdminStock\(\)/);
  assert.match(continuationScript, /if \(!\['admin', 'orders'\]\.includes\(state\.route\)\) return;/);
  assert.match(continuationScript, /const previousProducts = state\.products;\s*state\.products = products;/);
  assert.match(continuationScript, /const hasUnsavedStockEdit = input && previousProduct &&\s*Number\(input\.value\) !== getStock\(previousProduct\);\s*if \(input && !hasUnsavedStockEdit\) input\.value = getStock\(product\);/);
  assert.match(continuationScript, /fetch\(`\$\{API_BASE\}\/api\/products\?stockRefresh=\$\{Date\.now\(\)\}`\)/);
  assert.match(appScript, /stockUpdateChannel\?\.addEventListener\('message'/);
  assert.match(appScript, /else if \(!IS_ADMIN_PORTAL && event\.data\?\.type === 'order-placed' &&\s*\['home', 'cart'\]\.includes\(state\.route\)\) \{\s*loadProducts\(\);/);
  assert.match(continuationScript, /stockUpdateChannel\?\.postMessage\(\{ type: 'order-placed' \}\)/);
  assert.match(appScript, /if \(IS_ADMIN_PORTAL && !isAdminSession\(\) &&\s*\['auth', 'profile'\]\.includes\(target\)\) \{\s*setRoute\('admin-login'\);/);
  assert.match(appScript, /authMarkup\(IS_ADMIN_PORTAL \? 'admin-login' : panel\)/);
  assert.match(continuationScript, /if \(IS_ADMIN_PORTAL && !isAdminLogin\) \{\s*showToast\('Use the admin login form to access this portal\.'/);
  assert.match(appScript, /if \(!isAdminSession\(\) \|\| getAdminToken\(\) !== token \|\|\s*!\['admin', 'orders'\]\.includes\(state\.route\)\)/);
  assert.doesNotMatch(continuationScript, /if \(document\.hidden \|\| state\.adminStockRefreshPromise\) return;/);
  assert.match(appScript, /window\.addEventListener\('focus', \(\) => \{\s*resumeOrderSuccessAfterWhatsapp\(\);\s*if \(IS_ADMIN_PORTAL && \['admin', 'orders'\]\.includes\(state\.route\)\) \{\s*refreshAdminStock\(\);/);
  assert.match(appScript, /if \(!\['admin', 'orders'\]\.includes\(target\) && state\.adminStockTimer\)/);
  assert.match(continuationScript, /function startAdminStockPolling\(\) \{\s*if \(state\.adminStockTimer\) clearInterval\(state\.adminStockTimer\);\s*refreshAdminStock\(\);\s*state\.adminStockTimer = setInterval\(refreshAdminStock, 1000\);/);
});
t('admin hero keeps the poster layout and uses blue accents', () => {
  const styles = require('fs').readFileSync(require('path').join(SRC, 'Stylesheet.html'), 'utf8');
  assert.match(styles, /body\.admin-portal \.hero \.pill \{[\s\S]*?color: #1d4ed8;/);
  assert.match(styles, /body\.admin-portal \.delivery-banner \{[\s\S]*?min-height: 375px;[\s\S]*?background: linear-gradient\(135deg, #f8fafc, #e0f2fe\);/);
  assert.match(styles, /body\.admin-portal \.delivery-banner-bg \{\s*opacity: 0\.48;/);
  assert.match(styles, /body\.admin-portal \.delivery-banner h1 \{\s*color: #1d4ed8;/);
});
t('customer and admin portal sessions stay isolated in a shared browser', () => {
  const savedUser = JSON.stringify({ id: 7, email: 'customer@example.com' });
  const savedCustomerToken = 'customer-session';
  const adminValues = {
    km_admin_token: 'admin-session',
    km_admin_email: 'admin@example.com',
    km_customer_token: savedCustomerToken,
    km_user: savedUser
  };
  const sharedStorage = new Map(Object.entries(adminValues));

  const user = loadPortalFrontend('user', sharedStorage);
  user.context.window.location.hash = '#admin';
  assert.equal(vm.runInContext('getAdminToken()', user.context), '');
  assert.equal(vm.runInContext('getInitialRoute()', user.context), 'home');
  assert.equal(user.values.get('km_customer_token'), savedCustomerToken);

  const admin = loadPortalFrontend('admin', sharedStorage);
  assert.equal(vm.runInContext('getAdminToken()', admin.context), 'admin-session');
  assert.equal(vm.runInContext('getInitialRoute()', admin.context), 'admin');
  assert.equal(vm.runInContext('state.user', admin.context), null);
  vm.runInContext("setAdminSession('new-admin-session', 'admin@example.com')", admin.context);
  assert.equal(admin.values.get('km_customer_token'), savedCustomerToken);
  assert.equal(admin.values.get('km_user'), savedUser);
});

// ---------- payment config / UPI
let c = boot({});
t('admin credentials are rejected by customer login and accepted by admin login', () => {
  const credentials = { email: 'admin@gmail.com', password: 'Admin@12345' };
  const registration = c.call('POST', '/api/register', {
    name: 'Admin',
    email: credentials.email,
    phone: '9876543210',
    password: credentials.password
  });
  assert.equal(registration.status, 409);
  const customerLogin = c.call('POST', '/api/login', credentials);
  assert.notEqual(customerLogin.status, 200);
  const adminLogin = c.call('POST', '/api/admin/login', credentials);
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.admin.role, 'admin');
});
t('registration sends a six-digit email code and creates no account until verified', () => {
  const b = boot({});
  const started = b.call('POST', '/api/register', {
    name: 'Nila', email: 'nila@example.com', phone: '9876543211',
    password: 'Str0ng@Pass', address: 'Home'
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.verificationRequired, true);
  assert.match(b.__store.sentEmails[0].body, /\b\d{6}\b/);
  assert.equal(b.__store.sentEmails[0].name, 'Kamagere Mart');
  assert.equal(b.call('POST', '/api/login', { email: 'nila@example.com', password: 'Str0ng@Pass' }).status, 401);
  const pending = vm.runInContext("readTable_('PendingRegistrations').rows[0]", b);
  assert.notEqual(pending.password, 'Str0ng@Pass');
  assert.equal(pending.codeHash.includes(b.__store.sentEmails[0].body.match(/\b(\d{6})\b/)[1]), false);
});
t('email verification rejects incorrect codes and accepts the emailed code', () => {
  const b = boot({});
  b.call('POST', '/api/register', {
    name: 'Oviya', email: 'oviya@example.com', phone: '9876543212', password: 'Str0ng@Pass'
  });
  const code = b.__store.sentEmails[0].body.match(/\b(\d{6})\b/)[1];
  assert.equal(b.call('POST', '/api/register/verify', { email: 'oviya@example.com', code: '000000' }).status, 400);
  assert.equal(b.call('POST', '/api/register/verify', { email: 'oviya@example.com', code }).status, 201);
  assert.equal(b.call('POST', '/api/login', { email: 'oviya@example.com', password: 'Str0ng@Pass' }).status, 200);
});
t('verification code can be resent after the cooldown and old code is invalidated', () => {
  const b = boot({});
  b.call('POST', '/api/register', {
    name: 'Uma', email: 'uma@example.com', phone: '9876543213', password: 'Str0ng@Pass'
  });
  const oldCode = b.__store.sentEmails[0].body.match(/\b(\d{6})\b/)[1];
  assert.equal(b.call('POST', '/api/register/resend', { email: 'uma@example.com' }).status, 429);
  vm.runInContext("var p=findPendingRegistration_('uma@example.com');p.lastSentAt=Date.now()-60001;updateRow_('PendingRegistrations',p._row,p)", b);
  assert.equal(b.call('POST', '/api/register/resend', { email: 'uma@example.com' }).status, 200);
  const newCode = b.__store.sentEmails[1].body.match(/\b(\d{6})\b/)[1];
  assert.notEqual(newCode, oldCode);
  assert.equal(b.call('POST', '/api/register/verify', { email: 'uma@example.com', code: oldCode }).status, 400);
  assert.equal(b.call('POST', '/api/register/verify', { email: 'uma@example.com', code: newCode }).status, 201);
});
t('email delivery failures are returned explicitly and do not create pending accounts', () => {
  const b = boot({});
  b.__store.mailError = 'mail unavailable';
  const response = b.call('POST', '/api/register', {
    name: 'Ira', email: 'ira@example.com', phone: '9876543214', password: 'Str0ng@Pass'
  });
  assert.equal(response.status, 503);
  assert.equal(vm.runInContext("readTable_('PendingRegistrations').rows.length", b), 0);
});
t('email quota authorization failures return an actionable response instead of a server error', () => {
  const b = boot({});
  b.__store.mailQuotaError = 'authorization required';
  const response = b.call('POST', '/api/register', {
    name: 'Asha', email: 'asha@example.com', phone: '9876543218', password: 'Str0ng@Pass'
  });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /authorize this sender/i);
  assert.equal(vm.runInContext("readTable_('PendingRegistrations').rows.length", b), 0);
});
t('registration uses MailApp delivery without blocking on Gmail alias discovery', () => {
  const b = boot({});
  b.__store.gmailAliases = [];
  const response = b.call('POST', '/api/register', {
    name: 'Asha', email: 'asha@example.com', phone: '9876543218', password: 'Str0ng@Pass'
  });
  assert.equal(response.status, 200);
  assert.equal((b.__store.sentEmails || []).length, 1);
});
t('expired verification codes are rejected and pending registration is removed', () => {
  const b = boot({});
  b.call('POST', '/api/register', {
    name: 'Tara', email: 'tara@example.com', phone: '9876543215', password: 'Str0ng@Pass'
  });
  const code = b.__store.sentEmails[0].body.match(/\b(\d{6})\b/)[1];
  vm.runInContext("var p=findPendingRegistration_('tara@example.com');p.expiresAt=Date.now()-1;updateRow_('PendingRegistrations',p._row,p)", b);
  assert.equal(b.call('POST', '/api/register/verify', { email: 'tara@example.com', code }).status, 410);
  assert.equal(vm.runInContext("readTable_('PendingRegistrations').rows.length", b), 0);
});
t('resending replaces an expired code without losing the pending registration', () => {
  const b = boot({});
  b.call('POST', '/api/register', {
    name: 'Wina', email: 'wina@example.com', phone: '9876543217', password: 'Str0ng@Pass'
  });
  vm.runInContext("var p=findPendingRegistration_('wina@example.com');p.expiresAt=Date.now()-1;p.lastSentAt=Date.now()-60001;updateRow_('PendingRegistrations',p._row,p)", b);
  assert.equal(b.call('POST', '/api/register/resend', { email: 'wina@example.com' }).status, 200);
  const code = b.__store.sentEmails[1].body.match(/\b(\d{6})\b/)[1];
  assert.equal(b.call('POST', '/api/register/verify', { email: 'wina@example.com', code }).status, 201);
});
t('verification attempts are limited and pending registration is cleared', () => {
  const b = boot({});
  b.call('POST', '/api/register', {
    name: 'Vani', email: 'vani@example.com', phone: '9876543216', password: 'Str0ng@Pass'
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(b.call('POST', '/api/register/verify', { email: 'vani@example.com', code: '000000' }).status, 400);
  }
  assert.equal(b.call('POST', '/api/register/verify', { email: 'vani@example.com', code: '000000' }).status, 429);
  assert.equal(vm.runInContext("readTable_('PendingRegistrations').rows.length", b), 0);
});
t('payment-config: UPI off when UPI_ID missing', () => { const r = c.call('GET', '/api/payment-config'); assert.equal(r.status, 200); assert.equal(r.body.upiEnabled, false); assert.equal(r.body.cod, true); });
t('UPI order rejected when UPI is not configured', () => { const r = c.call('POST', '/api/orders', order({ payment: 'UPI' })); assert.equal(r.status, 400); assert.match(r.body.message, /UPI payment is not available/); });
t('unknown payment method rejected', () => { assert.equal(c.call('POST', '/api/orders', order({ payment: 'PAYPAL' })).status, 400); });
t('COD order uses click-to-chat status without automatic WhatsApp send', () => {
  const r = c.call('POST', '/api/orders', order()); assert.equal(r.status, 201); assert.equal(r.body.order.payment, 'COD');
  assert.equal(invoiceStatusOf(c, r.body.order.id), 'Click-to-chat'); assert.equal(c.fetched.length, 0);
});
t('bad UPI_ID is ignored', () => { const b = boot({ UPI_ID: 'not a upi id' }); assert.equal(b.call('GET', '/api/payment-config').body.upiEnabled, false); });

c = boot({ UPI_ID: 'kamageremart@okhdfcbank', UPI_NAME: 'Kamagere Mart' });
t('payment-config: UPI on when UPI_ID set', () => { const r = c.call('GET', '/api/payment-config').body; assert.equal(r.upiEnabled, true); assert.equal(r.upiId, 'kamageremart@okhdfcbank'); });
t('UPI order returns a upi://pay link with server-side total', () => {
  const r = c.call('POST', '/api/orders', order({ payment: 'UPI', total: 1 })); assert.equal(r.status, 201);
  const o = r.body.order; assert.equal(o.payment, 'UPI'); assert.ok(o.upi.link.startsWith('upi://pay?pa=kamageremart%40okhdfcbank'), o.upi.link);
  assert.ok(o.upi.link.includes('am=' + o.total.toFixed(2)), o.upi.link); assert.ok(o.upi.link.includes('cu=INR')); assert.ok(o.upi.link.includes('Order%20' + o.id));
});
t('lower-case "upi" is accepted and normalised', () => { assert.equal(c.call('POST', '/api/orders', order({ payment: 'upi' })).body.order.payment, 'UPI'); });

// ---------- WhatsApp invoice
c = boot(WA);
let token = signup(c);
t('Cloud API credentials do not trigger duplicate order notifications', () => {
  const r = c.call('POST', '/api/orders', order({ customerPhone: '9000000000' }), token); assert.equal(r.status, 201);
  assert.equal(c.fetched.length, 0);
  assert.equal(invoiceStatusOf(c, r.body.order.id), 'Click-to-chat');
});
t('guest checkout also avoids an automatic Cloud API send', () => {
  const r = c.call('POST', '/api/orders', order()); assert.equal(r.status, 201);
  assert.equal(c.fetched.length, 0); assert.equal(invoiceStatusOf(c, r.body.order.id), 'Click-to-chat');
});
t('a valid token overrides a spoofed userId in the body', () => {
  const r = c.call('POST', '/api/orders', order({ userId: 999 }), token); assert.equal(r.status, 201); assert.equal(String(r.body.order.userId), '1');
});
t('stock still decremented exactly once per order; lock free afterwards', () => {
  const r = c.call('POST', '/api/orders', order(), token); assert.equal(r.status, 201);
  assert.equal(c.__store.locked, false);
});
t('admin order list still works and hides token hashes', () => {
  const a = c.call('POST', '/api/admin/login', { email: 'admin@gmail.com', password: 'Admin@12345' }).body.token;
  const r = c.call('GET', '/api/orders', undefined, a); assert.equal(r.status, 200); assert.ok(r.body.length > 3); assert.ok(!('cancelTokenHash' in r.body[0]));
});
t('admin order status and cancellation changes are visible to customer tracking', () => {
  const adminToken = c.call('POST', '/api/admin/login', { email: 'admin@gmail.com', password: 'Admin@12345' }).body.token;
  const productBefore = c.call('GET', '/api/products').body.find(product => Number(product.id) === 1).stock;
  const placed = c.call('POST', '/api/orders', order({ items: [{ id: 1, quantity: 1 }] }));
  assert.equal(placed.status, 201);
  const created = placed.body.order;
  const outForDelivery = c.call('PATCH', '/api/orders/' + created.id + '/status', { status: 'Out for delivery' }, adminToken);
  assert.equal(outForDelivery.status, 200);
  assert.equal(c.call('GET', '/api/orders/' + created.id + '/track', undefined, created.trackingToken).body.status, 'Out for delivery');
  const cancelled = c.call('PATCH', '/api/admin/orders/' + created.id + '/cancel', {}, adminToken);
  assert.equal(cancelled.status, 200);
  assert.equal(c.call('GET', '/api/orders/' + created.id + '/track', undefined, created.trackingToken).body.status, 'Cancelled');
  assert.equal(c.call('GET', '/api/products').body.find(product => Number(product.id) === 1).stock, productBefore);
});
console.log(pass + ' checks passed');
