/**
 * Orders.gs : place, list, track, cancel (1-minute window) and update order status.
 */

var ORDER_STATUSES = ['Confirmed', 'Preparing', 'Out for delivery', 'Delivered'];
var CANCEL_WINDOW_MS = 60 * 1000;

function parseItems_(value) {
  try { return JSON.parse(value || '[]'); } catch (e) { return []; }
}

function normalizeOrder_(row) {
  var uid = row.userId === '' || row.userId == null ? null : (isFinite(Number(row.userId)) ? Number(row.userId) : row.userId);
  return {
    id: row.id,
    userId: uid,
    date: row.date,
    items: parseItems_(row.items),
    subtotal: Number(row.subtotal || 0),
    delivery: Number(row.delivery || 0),
    total: Number(row.total || 0),
    customerName: row.customerName || '',
    customerPhone: row.customerPhone || '',
    customerEmail: row.customerEmail || '',
    address: row.address,
    payment: row.payment || 'COD',
    status: row.status || 'Confirmed',
    source: row.source || 'Cart'
  };
}

function findOrder_(table, id) {
  for (var i = 0; i < table.rows.length; i++) if (table.rows[i].id === id) return table.rows[i];
  return null;
}

function placeOrder_(ctx) {
  var b = ctx.body;
  var items = b.items;
  if (!Array.isArray(items) || !items.length) return fail_(400, 'No items in order');
  if (typeof b.address !== 'string' || !b.address.trim()) return fail_(400, 'Delivery address is required');

  var payment = String(b.payment || 'COD').toUpperCase();
  if (payment !== 'COD' && payment !== 'UPI') return fail_(400, 'Please choose Cash on Delivery or UPI.');
  if (payment === 'UPI' && !upiConfig_().enabled) {
    return fail_(400, 'UPI payment is not available right now. Please choose Cash on Delivery.');
  }

  var customerName = String(b.customerName || '').trim();
  var customerPhone = String(b.customerPhone || '').trim();
  var customerEmail = String(b.customerEmail || '').trim();
  if (!customerName || customerName.length > 255) return fail_(400, 'Enter a valid customer name.');
  if (!PHONE_REGEX.test(customerPhone)) return fail_(400, 'Enter a valid 10-digit Indian mobile number.');
  if (!EMAIL_REGEX.test(customerEmail)) return fail_(400, 'Enter a valid email address.');

  // merge repeated lines for the same product
  var requested = {};
  var order = [];
  for (var i = 0; i < items.length; i++) {
    var pid = Number(items[i] && items[i].id);
    var qty = Number(items[i] && items[i].quantity);
    if (!isFinite(pid) || Math.floor(pid) !== pid || pid <= 0 || !isFinite(qty) || Math.floor(qty) !== qty || qty <= 0) {
      return fail_(400, 'Order contains an invalid product or quantity');
    }
    if (!(pid in requested)) { requested[pid] = 0; order.push(pid); }
    requested[pid] += qty;
  }

  // The caller holds the script lock, so the check + stock decrement below is atomic.
  var products = readTable_('Products');
  var priced = [];
  for (var k = 0; k < order.length; k++) {
    var product = findProduct_(products, order[k]);
    var quantity = requested[order[k]];
    if (!product) return fail_(400, 'Order contains a product that is no longer available');
    var available = Math.max(0, Number(product.stock || 0));
    if (available <= 0) return fail_(409, product.name + ' is sold out.');
    if (quantity > available) {
      return fail_(409, 'Only ' + available + ' of ' + product.name + ' ' + (available === 1 ? 'is' : 'are') + ' available.');
    }
    priced.push({ id: Number(product.id), name: product.name, price: Number(product.price), unit: product.unit, quantity: quantity, _p: product });
  }

  var subtotal = Math.round((priced.reduce(function (s, it) { return s + it.price * it.quantity; }, 0) + Number.EPSILON) * 100) / 100;
  var delivery = subtotal >= 199 ? 0 : 25;
  var createdAt = Date.now();
  var cancelToken = randomHex_(2);
  var trackingToken = randomHex_(2);

  var orders = readTable_('Orders');
  var orderId;
  do {
    orderId = 'KM' + String(Date.now()).slice(-7);
    if (findOrder_(orders, orderId)) Utilities.sleep(5);
  } while (findOrder_(orders, orderId));

  var cleanItems = priced.map(function (it) {
    return { id: it.id, name: it.name, price: it.price, unit: it.unit, quantity: it.quantity };
  });

  // A valid customer token decides who the order belongs to (a typed-in userId is not trusted).
  var session = ctx.authorization ? jwtVerify_(bearer_(ctx.authorization)) : null;
  var ownerId = session && session.role === 'customer' && /^\d+$/.test(String(session.sub || '')) ? Number(session.sub) : null;
  if (ownerId == null) ownerId = b.userId || null;
  var invoiceStatus = 'Click-to-chat';

  var result = {
    id: orderId,
    userId: ownerId,
    date: Utilities.formatDate(new Date(createdAt), TZ, 'dd/MM/yyyy, hh:mm:ss a').toLowerCase(),
    createdAt: createdAt,
    cancelToken: cancelToken,
    trackingToken: trackingToken,
    items: cleanItems,
    subtotal: subtotal,
    delivery: delivery,
    total: subtotal + delivery,
    customerName: customerName,
    customerPhone: customerPhone,
    customerEmail: customerEmail,
    address: b.address.trim(),
    payment: payment,
    status: 'Confirmed',
    source: b.source === 'Buy Now' ? 'Buy Now' : 'Cart'
  };

  // take the stock
  priced.forEach(function (it) {
    it._p.stock = Number(it._p.stock) - it.quantity;
    updateRow_('Products', it._p._row, it._p);
  });

  try {
    insertRow_('Orders', {
      id: result.id, userId: result.userId == null ? '' : result.userId, date: result.date, items: JSON.stringify(cleanItems),
      subtotal: subtotal, delivery: delivery, total: result.total, customerName: customerName, customerPhone: customerPhone,
      customerEmail: customerEmail, address: result.address, payment: result.payment, status: 'Confirmed', source: result.source,
      createdAt: createdAt, cancelTokenHash: sha256Hex_(cancelToken), trackingTokenHash: sha256Hex_(trackingToken),
      invoiceStatus: invoiceStatus
    });
  } catch (error) {
    releaseStock_(cleanItems);
    throw error;
  }
  if (payment === 'UPI') {
    var upi = upiConfig_();
    result.upi = { id: upi.id, name: upi.name, link: buildUpiLink_(orderId, result.total) };
  }
  return ok_({ message: 'Order placed successfully', order: result }, 201);
}

function notifyOrderWhatsapp_(ctx, m) {
  var orderId = decodeURIComponent(m[1]);
  var row = findOrder_(readTable_('Orders'), orderId);
  if (!row) return fail_(404, 'Order not found.');

  var token = String(ctx.body.trackingToken || '');
  if (!/^[a-f0-9]{64}$/i.test(token) || !row.trackingTokenHash ||
      !safeEqual_(sha256Hex_(token), row.trackingTokenHash)) {
    return fail_(403, 'WhatsApp notification is unavailable for this order.');
  }
  if (!waConfigured_() || !adminWhatsappPhone_()) return ok_({ sent: false, configured: false });
  if (row.invoiceStatus === 'Sent') return ok_({ sent: true, alreadySent: true });
  if (row.invoiceStatus === 'Sending') return ok_({ sent: false, pending: true }, 202);
  if (row.invoiceStatus && row.invoiceStatus !== 'Click-to-chat') {
    return ok_({ sent: false, alreadyAttempted: true });
  }

  row.invoiceStatus = 'Sending';
  updateRow_('Orders', row._row, row);
  var order = normalizeOrder_(row);
  var response = ok_({ sent: false });
  response.after = function () {
    deliverInvoice_(order, adminWhatsappPhone_());
    response.body.sent = order.invoice.sent;
  };
  return response;
}

function trackOrder_(ctx, m) {
  var token = bearer_(ctx.authorization);
  if (!/^[a-f0-9]{64}$/i.test(token)) return fail_(401, 'A valid order tracking token is required.');
  var row = findOrder_(readTable_('Orders'), decodeURIComponent(m[1]));
  if (!row) return fail_(404, 'Order not found.');
  if (!row.trackingTokenHash || !/^[a-f0-9]{64}$/i.test(row.trackingTokenHash)) return fail_(403, 'Tracking is unavailable for this order.');
  if (!safeEqual_(sha256Hex_(token), row.trackingTokenHash)) return fail_(403, 'Tracking is unavailable for this order.');
  return ok_({ status: row.status || 'Confirmed' });
}

function cancelOrder_(ctx, m) {
  var orderId = decodeURIComponent(m[1]);
  var token = String(ctx.body.cancelToken || '');
  if (!orderId || !/^[a-f0-9]{64}$/i.test(token)) return fail_(400, 'A valid order cancellation token is required.');

  var row = findOrder_(readTable_('Orders'), orderId);
  if (!row) return fail_(404, 'Order not found.');
  if (!row.cancelTokenHash || !/^[a-f0-9]{64}$/i.test(row.cancelTokenHash)) return fail_(403, 'This order cannot be cancelled from this browser.');
  if (!safeEqual_(sha256Hex_(token), row.cancelTokenHash)) return fail_(403, 'This order cannot be cancelled from this browser.');
  if (row.status !== 'Confirmed') return fail_(409, 'This order has already been processed and cannot be cancelled.');

  var age = Date.now() - Number(row.createdAt);
  if (!isFinite(age) || age < 0 || age >= CANCEL_WINDOW_MS) return fail_(410, 'The 1-minute cancellation window has expired.');

  row.status = 'Cancelled';
  updateRow_('Orders', row._row, row);
  try {
    releaseStock_(parseItems_(row.items));
  } catch (error) {
    console.error('Cancel Order Restock Error: ' + error);
  }
  var response = ok_({
    message: 'Order cancelled successfully.',
    status: 'Cancelled',
    notificationSent: false
  });
  var phone = waConfigured_() ? adminWhatsappPhone_() : '';
  if (phone) {
    var cancelledOrder = normalizeOrder_(row);
    response.after = function () {
      var notificationStatus = sendWhatsappInvoice_(cancelledOrder, phone, 'cancelled');
      response.body.notificationSent = notificationStatus === 'Sent';
      if (notificationStatus !== 'Sent') {
        response.body.notificationError = notificationStatus;
      }
    };
  }
  return response;
}

function adminCancelOrder_(ctx, m) {
  var orderId = decodeURIComponent(m[1]);
  var row = findOrder_(readTable_('Orders'), orderId);
  if (!row) return fail_(404, 'Order not found.');
  var current = row.status || 'Confirmed';
  if (current === 'Cancelled') return fail_(409, 'This order is already cancelled.');
  if (current === 'Delivered') return fail_(409, 'A delivered order cannot be cancelled.');

  releaseStock_(parseItems_(row.items));
  row.status = 'Cancelled';
  updateRow_('Orders', row._row, row);
  return ok_({ message: 'Order cancelled successfully.', status: 'Cancelled' });
}

function updateOrderStatus_(ctx, m) {
  var orderId = decodeURIComponent(m[1]);
  var next = String(ctx.body.status || '');
  if (ORDER_STATUSES.indexOf(next) < 0) return fail_(400, 'Choose a valid order status.');
  var row = findOrder_(readTable_('Orders'), orderId);
  if (!row) return fail_(404, 'Order not found.');
  var current = row.status || 'Confirmed';
  if (current === 'Cancelled') return fail_(409, 'A cancelled order cannot be updated.');
  if (current === next) return ok_({ status: current });
  if (ORDER_STATUSES.indexOf(next) < ORDER_STATUSES.indexOf(current)) return fail_(409, 'Order status cannot move backwards.');
  row.status = next;
  updateRow_('Orders', row._row, row);
  return ok_({ status: next });
}

function listOrders_() {
  var rows = readTable_('Orders').rows;
  rows.sort(function (a, b) { return Number(b.createdAt) - Number(a.createdAt); });
  return ok_(rows.map(normalizeOrder_));
}
