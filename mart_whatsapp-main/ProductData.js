/**
 * Built-in product catalogue (ported from backend/product.js).
 * Seeded into the "Products" sheet the first time the app runs, and by
 * "Restore default products" in the admin dashboard.
 */
var DEFAULT_PRODUCTS = [
  {
    "id": 1,
    "name": "Aashirvaad Atta",
    "category": "Atta & Rice",
    "unit": "5 kg",
    "price": 285,
    "oldPrice": 310,
    "discount": 8,
    "image": "images/products/aashirvaad-atta.jpg",
    "description": "Aashirvaad Atta made from quality wheat. Suitable for everyday chapati and roti preparation."
  },
  {
    "id": 2,
    "name": "India Gate Basmati Rice",
    "category": "Atta & Rice",
    "unit": "5 kg",
    "price": 499,
    "oldPrice": 550,
    "discount": 9,
    "image": "images/products/india-gate-basmati-rice.jpg",
    "description": "Premium quality basmati rice with long grains and a pleasant aroma, suitable for biryani, pulao and everyday meals."
  },
  {
    "id": 3,
    "name": "Nandini Toned Milk",
    "category": "Dairy",
    "unit": "1 L",
    "price": 56,
    "oldPrice": 60,
    "discount": 7,
    "image": "images/products/nandini-toned-milk.jpg",
    "description": "Fresh toned milk suitable for drinking, tea, coffee, cooking and everyday household use."
  },
  {
    "id": 4,
    "name": "Amul Butter",
    "category": "Dairy",
    "unit": "500 g",
    "price": 285,
    "oldPrice": 310,
    "discount": 8,
    "image": "images/products/amul-butter.svg",
    "description": "Amul butter with a rich and creamy taste, suitable for breakfast, cooking, baking and snacks."
  },
  {
    "id": 5,
    "name": "Tata Salt",
    "category": "Staples",
    "unit": "1 kg",
    "price": 28,
    "oldPrice": 32,
    "discount": 13,
    "image": "images/products/tata-salt.jpg",
    "description": "Iodised salt for everyday cooking and household food preparation."
  },
  {
    "id": 6,
    "name": "Fortune Sunflower Oil",
    "category": "Cooking Oil",
    "unit": "1 L",
    "price": 145,
    "oldPrice": 165,
    "discount": 12,
    "image": "images/products/fortune-sunflower-oil.jpg",
    "description": "Sunflower cooking oil suitable for everyday frying, cooking and food preparation."
  },
  {
    "id": 7,
    "name": "Maggi Noodles",
    "category": "Snacks",
    "unit": "280 g",
    "price": 65,
    "oldPrice": 70,
    "discount": 7,
    "image": "images/products/maggi-noodles.jpg",
    "description": "Instant noodles that are quick and easy to prepare for a convenient snack or meal."
  },
  {
    "id": 8,
    "name": "Parle-G Biscuits",
    "category": "Snacks",
    "unit": "800 g",
    "price": 80,
    "oldPrice": 90,
    "discount": 11,
    "image": "images/products/parle-g-biscuits.jpg",
    "description": "Classic glucose biscuits suitable for tea time, snacks and everyday family consumption."
  },
  {
    "id": 9,
    "name": "Banana",
    "category": "Fruits",
    "unit": "1 dozen",
    "price": 70,
    "oldPrice": 80,
    "discount": 12,
    "image": "images/products/banana.jpg",
    "description": "Fresh bananas suitable for everyday consumption, breakfast and snacks."
  },
  {
    "id": 10,
    "name": "Tomato",
    "category": "Vegetables",
    "unit": "1 kg",
    "price": 42,
    "oldPrice": 50,
    "discount": 16,
    "image": "images/products/tomato.jpg",
    "description": "Fresh tomatoes suitable for curries, sambar, rasam, salads and everyday cooking."
  },
  {
    "id": 11,
    "name": "Onion",
    "category": "Vegetables",
    "unit": "1 kg",
    "price": 38,
    "oldPrice": 45,
    "discount": 16,
    "image": "images/products/onion.jpg",
    "description": "Fresh onions suitable for everyday cooking, curries, biryani and salads."
  },
  {
    "id": 12,
    "name": "Surf Excel",
    "category": "Household",
    "unit": "1 kg",
    "price": 155,
    "oldPrice": 175,
    "discount": 11,
    "image": "images/products/surf-excel.jpg",
    "description": "Laundry detergent suitable for everyday washing and household cleaning."
  }
];
