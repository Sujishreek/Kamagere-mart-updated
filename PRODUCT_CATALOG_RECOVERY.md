# Kamagere Mart product catalogue recovery

## Why previously updated products may not appear

This ZIP contains the 12 built-in default products in `ProductData.js`. Products added or edited through the Admin page are stored in the Google Sheets `Products` tab through the Apps Script backend; those custom rows are not automatically embedded in a ZIP. The frontend only shows products returned by the backend endpoint `/api/products`.

## Restore your previously updated products without losing them

1. Use the same Apps Script deployment URL (`.../exec`) that the old working website used.
2. Confirm that the Apps Script project has the `SPREADSHEET_ID` Script Property set to the same Google Sheet as before; do not switch it to a new blank sheet if you want the old records.
3. Build with that old deployment URL set as `KM_API_URL`.
4. Open the site and check the browser Network tab for `/api/products`; the response should include the previous catalogue.
5. Do not run `setup()` against a different/new spreadsheet expecting it to recover custom products. Setup only seeds defaults when the Products tab is empty.
6. Do not use “Restore default products” as a way to recover custom products; it only adds the built-in defaults.

## Built-in products preserved in this ZIP

- Aashirvaad Atta — Atta & Rice, 5 kg, ₹285
- India Gate Basmati Rice — Atta & Rice, 5 kg, ₹499
- Nandini Toned Milk — Dairy, 1 L, ₹56
- Amul Butter — Dairy, 500 g, ₹285
- Tata Salt — Staples, 1 kg, ₹28
- Fortune Sunflower Oil — Cooking Oil, 1 L, ₹145
- Maggi Noodles — Snacks, 280 g, ₹65
- Parle-G Biscuits — Snacks, 800 g, ₹80
- Banana — Fruits, 1 dozen, ₹70
- Tomato — Vegetables, 1 kg, ₹42
- Onion — Vegetables, 1 kg, ₹38
- Surf Excel — Household, 1 kg, ₹155

Custom products not present in the ZIP can only be recovered from the original Google Sheet, an export/backup, or another ZIP that actually contains those records. This project does not include a product export of those custom rows.
