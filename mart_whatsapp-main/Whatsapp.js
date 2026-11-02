/**
 * Whatsapp.gs : sends the order list to the ADMIN (store) on WhatsApp after an order is placed.
 *
 * Uses Meta's WhatsApp Business Cloud API (the official Meta service for sending WhatsApp
 * messages from a program). The order list goes to the ADMIN WhatsApp number
 * (ADMIN_WHATSAPP script property, default 9840250476) - never to the customer.
 * The customer's name, phone and address are included in the message so the admin can deliver.
 *
 * Script Properties (Project Settings -> Script Properties):
 *   WA_PHONE_NUMBER_ID  "Phone number ID" from Meta -> WhatsApp -> API Setup
 *   WA_ACCESS_TOKEN     permanent System User token (whatsapp_business_messaging permission)
 *   WA_TEMPLATE_NAME    approved template name, e.g. order_invoice   (see WHATSAPP_SETUP.md)
 *   WA_TEMPLATE_LANG    template language code, default "en"
 *   ADMIN_WHATSAPP     optional 10-digit admin number (default 9840250476)
 *   WA_API_VERSION      Graph API version, default "v23.0"
 * If any of the first three is missing, nothing is sent and orders work exactly as before.
 */

function waConfigured_() {
  return !!(prop_('WA_PHONE_NUMBER_ID') && prop_('WA_ACCESS_TOKEN') && prop_('WA_TEMPLATE_NAME'));
}

/** The admin WhatsApp number (10 digits) that receives every order. */
function adminWhatsappPhone_() {
  var p = String(prop_('ADMIN_WHATSAPP') || DEFAULT_ADMIN_WHATSAPP).replace(/\D/g, '').slice(-10);
  return PHONE_REGEX.test(p) ? p : '';
}

function maskPhone_(phone) {
  return '+91 ******' + String(phone).slice(-4);
}

/** WhatsApp template variables must be one line, no tabs, no long runs of spaces. */
function waText_(value, max) {
  var s = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (!s) s = '-';
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function money_(n) {
  var v = Math.round(Number(n) * 100) / 100;
  return v === Math.floor(v) ? String(v) : v.toFixed(2);
}

function invoiceParameters_(order) {
  var items = (order.items || []).map(function (it) {
    return it.name + ' (' + it.unit + ') x ' + it.quantity + ' = Rs.' + money_(it.price * it.quantity);
  }).join(', ');
  var payment = order.payment === 'UPI' ? 'UPI' : 'Cash on Delivery';
  return [
    // first template variable carries who ordered + how to reach / deliver to them
    waText_(order.customerName + ' | Ph: ' + order.customerPhone + ' | ' + order.address, 250),
    waText_(order.id, 30),
    waText_(order.date, 40),
    waText_(items, 900),
    money_(order.delivery),
    money_(order.total),
    payment
  ];
}

/** Sends the invoice template. Returns a short status string ("Sent" or "Failed: ..."). Never throws. */
function sendWhatsappInvoice_(order, phone) {
  try {
    var version = prop_('WA_API_VERSION') || 'v23.0';
    var url = 'https://graph.facebook.com/' + encodeURIComponent(version) + '/' + encodeURIComponent(prop_('WA_PHONE_NUMBER_ID')) + '/messages';
    var payload = {
      messaging_product: 'whatsapp',
      to: '91' + phone,
      type: 'template',
      template: {
        name: prop_('WA_TEMPLATE_NAME'),
        language: { code: prop_('WA_TEMPLATE_LANG') || 'en' },
        components: [{
          type: 'body',
          parameters: invoiceParameters_(order).map(function (t) { return { type: 'text', text: t }; })
        }]
      }
    };
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + prop_('WA_ACCESS_TOKEN') },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return 'Sent';
    var detail = '';
    try { var j = JSON.parse(res.getContentText()); detail = (j.error && (j.error.message || j.error.type)) || ''; } catch (e) { /* ignore */ }
    console.error('WhatsApp invoice failed for ' + order.id + ': HTTP ' + code + ' ' + detail);
    return ('Failed: HTTP ' + code + ' ' + detail).slice(0, 200);
  } catch (error) {
    console.error('WhatsApp invoice error for ' + order.id + ': ' + error);
    return ('Failed: ' + (error && error.message ? error.message : error)).slice(0, 200);
  }
}

/** Runs after the order is saved and the script lock is released (see handleApi_). */
function deliverInvoice_(order, phone) {
  var status = sendWhatsappInvoice_(order, phone);
  order.invoice = { sent: status === 'Sent', phone: maskPhone_(phone) };
  try {
    withLock_(function () {
      var row = findOrder_(readTable_('Orders'), order.id);
      if (row) {
        row.invoiceStatus = status;
        updateRow_('Orders', row._row, row);
      }
    });
  } catch (error) {
    console.error('Could not record invoice status for ' + order.id + ': ' + error);
  }
}
