# Kamagere Mart payment setup

Checkout has two clear buttons: **Cash on Delivery** and **UPI**.

* **COD** always works.
* **UPI** works once you add two Script Properties (Project Settings -> Script Properties):

| Property | Example |
|---|---|
| UPI_ID | kamageremart@okhdfcbank (your store's UPI ID) |
| UPI_NAME | Kamagere Mart (optional; shown in the customer's UPI app) |

Until UPI_ID is set the UPI button is greyed out with "Not available right now", and the server
also refuses UPI orders.

How a UPI order works:
1. The customer picks UPI and places the order.
2. The success popup shows **Open UPI app to pay** (a upi://pay link with the exact total and the order
   number as note) plus the UPI ID with a Copy button for computer users.
3. The order is saved with payment = `UPI`. **The app cannot know whether the customer really paid**:
   check your own UPI app / bank statement for the order number before delivering.
   For automatic verification you need a payment gateway (Razorpay, Cashfree, PhonePe etc.); that is not included.
