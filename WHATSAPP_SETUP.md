# WhatsApp order notifications

After checkout saves the order and clears the cart, the app sends the order invoice to the store
through Meta's WhatsApp Business Cloud API when configured. Configure an approved message template
and these Apps Script Script Properties to enable automatic delivery:

- `WA_PHONE_NUMBER_ID`
- `WA_ACCESS_TOKEN`
- `WA_TEMPLATE_NAME`
- `WA_CANCELLATION_TEMPLATE_NAME` (optional; use an approved cancellation-specific template; defaults to `WA_TEMPLATE_NAME`)
- `WA_TEMPLATE_LANG` (optional; defaults to `en`)
- `ADMIN_WHATSAPP` (optional; defaults to `8197679897`, 10 digits)
- `WA_API_VERSION` (optional; defaults to `v23.0`)

When an order is cancelled, the app uses the same template to send the cancellation status and
order details before showing the customer the cancellation confirmation.

If the Cloud API is not configured or delivery fails, checkout or cancellation opens WhatsApp with
the relevant order details prefilled for the store. The customer must press **Send** in that
fallback; click-to-chat cannot send messages without that confirmation. The fallback number is
`918197679897` in `AppScriptContinuation.html` (`STORE_WHATSAPP_NUMBER`).

To publish changes, deploy a new version of the Google Apps Script web app. For the static Netlify
build, set `KM_API_URL` to that web app's HTTPS `/exec` URL and run `node build-netlify.mjs`.
