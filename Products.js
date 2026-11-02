/**
 * Products.gs : catalogue, stock, store location and Kannada translation.
 */

var DEFAULT_CATEGORY_GROUPS = [
  {
    id: 'Fresh Items', name: 'Fresh Items', subtitle: 'Fruits, vegetables & meat',
    image: 'images/categories/fresh-items.png',
    subcategories: [
      { id: 'Fruits', name: 'Fruits', image: 'images/categories/fruits.jpg' },
      { id: 'Vegetables', name: 'Vegetables', image: 'images/categories/vegetables.jpg' },
      { id: 'Meat', name: 'Meat', image: 'images/categories/meat.jpg' }
    ]
  },
  {
    id: 'Atta & Rice', name: 'Atta & Rice', subtitle: 'Flour, rice & grains',
    image: 'images/categories/atta-rice.png',
    subcategories: [{ id: 'Atta & Rice', name: 'Atta & Rice', image: 'images/categories/atta-rice.png' }]
  },
  {
    id: 'Dairy & Eggs', name: 'Dairy & Eggs', subtitle: 'Milk, butter, curd & eggs',
    image: 'images/categories/dairy-eggs.jpg',
    subcategories: [{ id: 'Dairy', name: 'Dairy', image: 'images/categories/dairy-eggs.jpg' }]
  },
  {
    id: 'Cooking Essentials', name: 'Cooking Essentials', subtitle: 'Oil, salt & daily staples',
    image: 'images/categories/cooking-essentials.jpg',
    subcategories: [
      { id: 'Staples', name: 'Staples', image: 'images/categories/cooking-essentials.jpg' },
      { id: 'Cooking Oil', name: 'Cooking Oil', image: 'images/categories/cooking-essentials.jpg' }
    ]
  },
  {
    id: 'Snacks & Biscuits', name: 'Snacks & Biscuits', subtitle: 'Biscuits, noodles & munchies',
    image: 'images/categories/snacks-biscuits.png',
    subcategories: [{ id: 'Snacks', name: 'Snacks', image: 'images/categories/snacks-biscuits.png' }]
  },
  {
    id: 'Household', name: 'Household', subtitle: 'Cleaning & home essentials',
    image: 'images/categories/household.jpg',
    subcategories: [{ id: 'Household', name: 'Household', image: 'images/categories/household.jpg' }]
  }
];

function normalizeProduct_(row) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category,
    unit: row.unit,
    price: Number(row.price),
    oldPrice: Number(row.oldPrice),
    discount: Number(row.discount),
    image: row.image,
    description: row.description,
    stock: Math.max(0, Number(row.stock || 0))
  };
}

function productArt_(label) {
  var safe = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" rx="42" fill="#16a34a"/>' +
    '<circle cx="150" cy="120" r="80" fill="#ffffff" fill-opacity=".2"/><circle cx="650" cy="420" r="140" fill="#ffffff" fill-opacity=".12"/>' +
    '<text x="400" y="300" text-anchor="middle" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#fff">' + safe + '</text></svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function validateProductInput_(body) {
  var name = String(body.name || '').trim();
  var category = String(body.category || '').trim();
  var unit = String(body.unit || '').trim();
  var description = String(body.description || '').trim();
  var price = Number(body.price);
  var oldPrice = (body.oldPrice === '' || body.oldPrice == null) ? price : Number(body.oldPrice);
  var image = String(body.image || '').trim();

  if (!name || !category || !unit || !description) return { error: 'Name, category, unit, price, and description are required.' };
  if (name.length > 255 || category.length > 100 || unit.length > 100 || description.length > 2000) {
    return { error: 'One or more product fields exceed the allowed length.' };
  }
  if (!isFinite(price) || price <= 0 || price > 10000000) return { error: 'Enter a valid product price greater than zero.' };
  if (!isFinite(oldPrice) || oldPrice < price || oldPrice > 10000000) return { error: 'MRP must be equal to or greater than the selling price.' };

  if (image.indexOf('data:') === 0) {
    if (image.length > 60000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/.test(image)) {
      return { error: 'Captured product photos must be JPEG images smaller than 60 KB.' };
    }
  } else if (image) {
    if (!/^https:\/\/[^\s]+$/i.test(image)) return { error: 'Product image must be a valid HTTPS image URL.' };
  }

  var stock = null;
  if (body.stock !== '' && body.stock != null) {
    stock = Number(body.stock);
    if (!isFinite(stock) || Math.floor(stock) !== stock || stock < 0 || stock > MAX_STOCK) {
      return { error: 'Stock must be a whole number between 0 and ' + MAX_STOCK + '.' };
    }
  }

  return {
    product: {
      name: name, category: category, unit: unit, price: price, oldPrice: oldPrice,
      discount: Math.round((1 - price / oldPrice) * 100), image: image, description: description, stock: stock
    }
  };
}

function findProduct_(table, id) {
  for (var i = 0; i < table.rows.length; i++) if (table.rows[i].id === id) return table.rows[i];
  return null;
}

/** Inserts the built-in catalogue. onlyIfEmpty = true on a brand-new database. */
function seedDefaultProducts_(onlyIfEmpty) {
  var table = readTable_('Products');
  if (onlyIfEmpty && table.rows.length > 0) return 0;
  var restored = 0;
  var rows = table.rows.slice();
  DEFAULT_PRODUCTS.forEach(function (p) {
    var sameName = rows.some(function (r) { return r.name === p.name; });
    if (sameName) return;
    var idTaken = rows.some(function (r) { return r.id === p.id; });
    var id = idTaken ? rows.reduce(function (m, r) { return Math.max(m, r.id); }, 0) + 1 : p.id;
    var obj = {
      id: id, name: p.name, category: p.category, unit: p.unit, price: p.price, oldPrice: p.oldPrice,
      discount: p.discount, image: p.image, description: p.description, stock: DEFAULT_STOCK
    };
    insertRow_('Products', obj);
    rows.push(obj);
    restored++;
  });
  return restored;
}

/** Gives stock back (cancelled order). Caller must hold the lock. */
function releaseStock_(items) {
  var table = readTable_('Products');
  items.forEach(function (item) {
    var row = findProduct_(table, Number(item.id));
    if (!row) return;
    row.stock = Number(row.stock) + (Number(item.quantity) || 0);
    updateRow_('Products', row._row, row);
  });
}

// ---------------------------------------------------------------- route handlers

function listProducts_() {
  return ok_(readTable_('Products').rows.sort(function (a, b) { return a.id - b.id; }).map(normalizeProduct_));
}

function validateCategoryGroups_(groups) {
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 30) {
    return { error: 'Add between 1 and 30 category groups.' };
  }
  var groupIds = Object.create(null);
  var categoryIds = Object.create(null);
  var clean = [];
  for (var i = 0; i < groups.length; i++) {
    var source = groups[i] || {};
    var id = String(source.id || '').trim();
    var name = String(source.name || '').trim();
    var subtitle = String(source.subtitle || '').trim();
    var image = String(source.image || '').trim();
    if (!id || id.length > 100 || !name || name.length > 80 || subtitle.length > 120) {
      return { error: 'Each category needs an ID, a name up to 80 characters, and a subtitle up to 120 characters.' };
    }
    if (!isValidCategoryImage_(image)) {
      return { error: 'Category images must be JPEG uploads under 60 KB, HTTPS URLs, or paths inside images/.' };
    }
    var groupKey = id.toLowerCase();
    if (groupIds[groupKey] || categoryIds[groupKey]) return { error: 'Category group IDs must be unique.' };
    groupIds[groupKey] = true;
    if (!Array.isArray(source.subcategories) || source.subcategories.length < 1 || source.subcategories.length > 40) {
      return { error: 'Each group must contain between 1 and 40 product categories.' };
    }
    var subcategories = [];
    for (var j = 0; j < source.subcategories.length; j++) {
      var subSource = source.subcategories[j] || {};
      var subId = String(subSource.id || '').trim();
      var subName = String(subSource.name || '').trim();
      var subImage = String(subSource.image || image).trim();
      if (!subId || subId.length > 100 || !subName || subName.length > 80) {
        return { error: 'Each product category needs an ID and a name up to 80 characters.' };
      }
      var subKey = subId.toLowerCase();
      if (categoryIds[subKey] || (groupIds[subKey] && subKey !== groupKey)) {
        return { error: 'Product category IDs must be unique.' };
      }
      if (!isValidCategoryImage_(subImage)) {
        return { error: 'Product category images must be JPEG uploads under 60 KB, HTTPS URLs, or paths inside images/.' };
      }
      categoryIds[subKey] = true;
      subcategories.push({ id: subId, name: subName, image: subImage });
    }
    clean.push({
      id: id, name: name, subtitle: subtitle, image: image,
      subcategories: subcategories
    });
  }
  return { groups: clean };
}

function isValidCategoryImage_(image) {
  return image.length <= 60000 &&
    (/^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/.test(image) ||
      /^https:\/\/[^\s]+$/i.test(image) ||
      /^images\/[A-Za-z0-9_./-]+$/.test(image));
}

function getCategoryGroups_() {
  var saved = getSetting_('category_groups');
  if (!saved) return DEFAULT_CATEGORY_GROUPS;
  var parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    throw new Error('Saved category configuration is invalid JSON.');
  }
  var result = validateCategoryGroups_(parsed);
  if (result.error) throw new Error('Saved category configuration is invalid: ' + result.error);
  return result.groups;
}

function listCategoryGroups_() {
  return ok_({ groups: getCategoryGroups_() });
}

function updateCategoryGroups_(ctx) {
  var validated = validateCategoryGroups_(ctx.body.groups);
  if (validated.error) return fail_(400, validated.error);

  var allowed = Object.create(null);
  validated.groups.forEach(function (group) {
    group.subcategories.forEach(function (subcategory) { allowed[subcategory.id] = true; });
  });
  var inUse = [];
  readTable_('Products').rows.forEach(function (product) {
    var category = String(product.category || '');
    if (!allowed[category] && inUse.indexOf(category) < 0) inUse.push(category);
  });
  if (inUse.length) {
    return fail_(409, 'Cannot remove product categories that are still assigned to products: ' + inUse.join(', ') + '. Reassign those products first.');
  }

  var serialized = JSON.stringify(validated.groups);
  if (serialized.length > 1500000) return fail_(400, 'Category configuration is too large to save.');
  setSetting_('category_groups', serialized);
  return ok_({ message: 'Categories updated.', groups: validated.groups });
}

function createProduct_(ctx) {
  var v = validateProductInput_(ctx.body);
  if (v.error) return fail_(400, v.error);
  var p = v.product;
  var id = nextId_('Products');
  insertRow_('Products', {
    id: id, name: p.name, category: p.category, unit: p.unit, price: p.price, oldPrice: p.oldPrice,
    discount: p.discount, image: p.image || productArt_(p.name), description: p.description,
    stock: p.stock == null ? DEFAULT_STOCK : p.stock
  });
  var created = findProduct_(readTable_('Products'), id);
  return ok_({ message: 'Product added successfully.', product: normalizeProduct_(created) }, 201);
}

function updateProduct_(ctx, m) {
  var id = Number(m[1]);
  if (!isFinite(id) || id <= 0) return fail_(400, 'Invalid product ID.');
  var table = readTable_('Products');
  var existing = findProduct_(table, id);
  if (!existing) return fail_(404, 'Product not found.');
  var v = validateProductInput_(ctx.body);
  if (v.error) return fail_(400, v.error);
  var p = v.product;
  updateRow_('Products', existing._row, {
    id: id, name: p.name, category: p.category, unit: p.unit, price: p.price, oldPrice: p.oldPrice,
    discount: p.discount, image: p.image || existing.image || productArt_(p.name), description: p.description,
    stock: p.stock == null ? Number(existing.stock || 0) : p.stock
  });
  return ok_({ message: 'Product updated successfully.', product: normalizeProduct_(findProduct_(readTable_('Products'), id)) });
}

function setStock_(ctx, m) {
  var id = Number(m[1]);
  var raw = ctx.body.stock;
  var stock = Number(raw);
  if (!isFinite(id) || id <= 0) return fail_(400, 'Invalid product ID.');
  if (raw === '' || raw == null || !isFinite(stock) || Math.floor(stock) !== stock || stock < 0 || stock > MAX_STOCK) {
    return fail_(400, 'Stock must be a whole number between 0 and ' + MAX_STOCK + '.');
  }
  var row = findProduct_(readTable_('Products'), id);
  if (!row) return fail_(404, 'Product not found.');
  row.stock = stock;
  updateRow_('Products', row._row, row);
  return ok_({ message: 'Stock updated.', product: normalizeProduct_(row), changed: 1 });
}

function quickUpdateProduct_(ctx, m) {
  var id = Number(m[1]);
  if (!isFinite(id) || id <= 0) return fail_(400, 'Invalid product ID.');
  var row = findProduct_(readTable_('Products'), id);
  if (!row) return fail_(404, 'Product not found.');
  var touched = false;
  if (ctx.body.unit !== undefined) {
    var unit = String(ctx.body.unit || '').trim();
    if (!unit || unit.length > 100) return fail_(400, 'Enter a pack size (up to 100 characters).');
    row.unit = unit;
    touched = true;
  }
  if (ctx.body.stock !== undefined) {
    var stock = Number(ctx.body.stock);
    if (ctx.body.stock === '' || ctx.body.stock === null || !isFinite(stock) || Math.floor(stock) !== stock || stock < 0 || stock > MAX_STOCK) {
      return fail_(400, 'Stock must be a whole number between 0 and ' + MAX_STOCK + '.');
    }
    row.stock = stock;
    touched = true;
  }
  if (!touched) return fail_(400, 'Nothing to update.');
  updateRow_('Products', row._row, row);
  return ok_({ message: 'Product updated.', product: normalizeProduct_(row) });
}

function deleteProduct_(ctx, m) {
  var id = Number(m[1]);
  if (!isFinite(id) || id <= 0) return fail_(400, 'Invalid product ID.');
  var row = findProduct_(readTable_('Products'), id);
  if (!row) return fail_(404, 'Product not found.');
  deleteRow_('Products', row._row);
  return ok_({ message: 'Product removed.', id: id });
}

function restoreDefaults_() {
  var restored = seedDefaultProducts_(false);
  return ok_({
    message: restored
      ? restored + ' default product' + (restored === 1 ? '' : 's') + ' restored.'
      : 'All default products are already in the store.',
    restored: restored
  });
}

// -------------------------------------------------------------- store location

function getStoreLocation_() {
  return ok_({ storeLocation: getSetting_('store_location') || DEFAULT_STORE_LOCATION });
}

function putStoreLocation_(ctx) {
  var loc = String(ctx.body.storeLocation || '').trim();
  if (!loc || loc.length > 500) return fail_(400, 'Enter a store address up to 500 characters.');
  setSetting_('store_location', loc);
  return ok_({ message: 'Store location updated.', storeLocation: loc });
}

// ---------------------------------------------------------------- translations

/** Kannada translation of product names/descriptions, cached in the TranslationCache sheet. */
function productTranslations_(ctx) {
  var ids = ctx.body.productIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
      ids.some(function (id) { return !isFinite(Number(id)) || Math.floor(Number(id)) !== Number(id) || Number(id) <= 0; })) {
    return fail_(400, 'Request between 1 and 10 valid product IDs.');
  }
  var unique = [];
  ids.map(Number).forEach(function (id) { if (unique.indexOf(id) < 0) unique.push(id); });
  var table = readTable_('Products');
  var products = [];
  for (var i = 0; i < unique.length; i++) {
    var row = findProduct_(table, unique[i]);
    if (!row) return fail_(404, 'One or more products were not found.');
    products.push(row);
  }

  var cache = readTable_('TranslationCache').rows;
  var byHash = {};
  cache.forEach(function (r) { byHash[r.sourceHash] = r; });

  var out = {};
  var needed = [];
  products.forEach(function (p) {
    [p.name, p.description].forEach(function (text) {
      var h = sha256Hex_(text);
      out[h] = byHash[h] && byHash[h].sourceText === text ? byHash[h].translatedText : null;
      if (out[h] === null && needed.indexOf(h) < 0) needed.push(h);
    });
  });

  try {
    needed.forEach(function (h) {
      var source = null;
      products.forEach(function (p) {
        [p.name, p.description].forEach(function (t) { if (sha256Hex_(t) === h) source = t; });
      });
      var translated = LanguageApp.translate(source, 'en', 'kn');
      if (!translated || !String(translated).trim()) throw new Error('empty translation');
      out[h] = translated;
      if (byHash[h]) {
        updateRow_('TranslationCache', byHash[h]._row, { sourceHash: h, sourceText: source, translatedText: translated });
      } else {
        insertRow_('TranslationCache', { sourceHash: h, sourceText: source, translatedText: translated });
      }
    });
  } catch (error) {
    console.error('Product Translation Error: ' + error);
    return fail_(503, 'Automatic Kannada translation is unavailable right now.');
  }

  return ok_({
    translations: products.map(function (p) {
      return { id: Number(p.id), name: out[sha256Hex_(p.name)], description: out[sha256Hex_(p.description)] };
    })
  });
}
