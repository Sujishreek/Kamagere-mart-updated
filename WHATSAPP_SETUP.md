# WhatsApp order notifications

After checkout saves the order and clears the cart, the app sends the complete order invoice to the
store through Meta's WhatsApp Business Cloud API. The customer confirmation popup is shown only
after the API confirms the message was sent. Configure an approved order template and these Apps
Script Script Properties to enable delivery:

- `WA_PHONE_NUMBER_ID`
- `WA_ACCESS_TOKEN`
- `WA_TEMPLATE_NAME`
- `WA_CANCELLATION_TEMPLATE_NAME` (optional; use an approved cancellation-specific template; defaults to `WA_TEMPLATE_NAME`)
- `WA_TEMPLATE_LANG` (optional; defaults to `en`)
- `ADMIN_WHATSAPP` (optional; defaults to `8197679897`, 10 digits)
- `WA_API_VERSION` (optional; defaults to `v23.0`)

When an order is cancelled, the app uses the same template to send the cancellation status and
order details before showing the customer the cancellation confirmation.

If the Cloud API is not configured or delivery fails, checkout opens a prefilled WhatsApp message
after saving the order and clearing the cart. The customer must tap **Send** in WhatsApp; the
order confirmation popup then appears in the storefront. If popups are blocked, WhatsApp opens in
the current tab and the order confirmation is restored when the customer returns. Check Apps Script
execution logs and the `Orders` sheet's `invoiceStatus` value when diagnosing a failed send; the
approved template name and its seven body variables must match the order invoice template.

Cancellation keeps its existing behavior: it sends the cancellation notification before showing
the cancellation confirmation, and opens a prefilled WhatsApp chat if automatic delivery fails.

To publish changes, deploy a new version of the Google Apps Script web app. For the static Netlify
build, set `KM_API_URL` to that web app's HTTPS `/exec` URL and run `node build-netlify.mjs`.
