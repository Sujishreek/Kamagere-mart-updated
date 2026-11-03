# WhatsApp click-to-chat

Checkout opens WhatsApp with the new order, invoice totals, and customer details prefilled for the
store. After a successful cancellation, the customer gets the same kind of prefilled message with
the cancellation details. The customer must press **Send** in WhatsApp; click-to-chat cannot send
messages without that confirmation.

The store chat number is `918197679897` in `AppScriptContinuation.html` (`STORE_WHATSAPP_NUMBER`).
Update that constant if the store's WhatsApp number changes. The value includes the country code and
must contain digits only.

No Meta Business Cloud API credentials, approved templates, or `WA_*` Script Properties are needed.
The backend records the order notification method as `Click-to-chat` and does not send a second
automatic message.

To publish changes, deploy a new version of the Google Apps Script web app. For the static Netlify
build, set `KM_API_URL` to that web app's HTTPS `/exec` URL and run `node build-netlify.mjs`.
