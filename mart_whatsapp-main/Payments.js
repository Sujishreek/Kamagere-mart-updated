/**
 * Payments.gs : the two payment choices (Cash on Delivery, UPI).
 *
 * UPI is switched on by two Script Properties (Project Settings -> Script Properties):
 *   UPI_ID    your store's UPI ID / VPA, e.g. kamageremart@okhdfcbank
 *   UPI_NAME  name shown in the customer's UPI app (optional, default "Kamagere Mart")
 * Without UPI_ID the UPI button on the checkout page is shown greyed out as "not available".
 *
 * Nothing here can tell that a customer really paid: UPI orders are recorded as "UPI" and the
 * store checks its own UPI app / bank statement before delivering.
 */

var UPI_ID_REGEX = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$/;

function upiConfig_() {
  var id = String(prop_('UPI_ID') || '').trim();
  if (!UPI_ID_REGEX.test(id)) return { enabled: false, id: '', name: '' };
  var name = String(prop_('UPI_NAME') || '').trim().replace(/[^\w .&'-]/g, '').slice(0, 60) || 'Kamagere Mart';
  return { enabled: true, id: id, name: name };
}

/** GET /api/payment-config  (public: a UPI ID is meant to be shared) */
function getPaymentConfig_() {
  var upi = upiConfig_();
  return ok_({ cod: true, upiEnabled: upi.enabled, upiId: upi.id, upiName: upi.name });
}

/** upi://pay deep link: opens GPay / PhonePe / Paytm / BHIM with the amount filled in. */
function buildUpiLink_(orderId, amount) {
  var upi = upiConfig_();
  if (!upi.enabled) return '';
  return 'upi://pay?pa=' + encodeURIComponent(upi.id) +
    '&pn=' + encodeURIComponent(upi.name) +
    '&am=' + encodeURIComponent((Math.round(Number(amount) * 100) / 100).toFixed(2)) +
    '&cu=INR&tn=' + encodeURIComponent('Order ' + orderId);
}
