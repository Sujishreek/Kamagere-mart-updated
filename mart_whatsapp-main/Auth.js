/**
 * Auth.gs : hashing, JWT (HS256) and role checks.
 * Apps Script has no bcrypt / jsonwebtoken, so they are built on Utilities.
 */

// ------------------------------------------------------------------- helpers

function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function randomHex_(n) {
  // n = number of UUIDs (32 hex chars each)
  var s = '';
  for (var i = 0; i < (n || 1); i++) s += Utilities.getUuid().replace(/-/g, '');
  return s;
}

function sha256Hex_(text) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

/** Constant-time string comparison. */
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function b64url_(str) {
  return Utilities.base64EncodeWebSafe(str, Utilities.Charset.UTF_8).replace(/=+$/, '');
}

function b64urlBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function b64urlDecode_(s) {
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString('UTF-8');
}

// ------------------------------------------------------------------ passwords

var PASSWORD_ROUNDS = 200;

/** Salted, iterated HMAC-SHA256.  Stored as  v1$rounds$salt$hash  */
function hashPassword_(password, saltOpt, roundsOpt) {
  var salt = saltOpt || randomHex_(1);
  var rounds = roundsOpt || PASSWORD_ROUNDS;
  var key = salt + ':' + password;
  var digest = Utilities.computeHmacSha256Signature(String(password), key);
  for (var i = 1; i < rounds; i++) {
    digest = Utilities.computeHmacSha256Signature(bytesToHex_(digest), key);
  }
  return 'v1$' + rounds + '$' + salt + '$' + bytesToHex_(digest);
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  var again = hashPassword_(password, parts[2], Number(parts[1]));
  return safeEqual_(again, stored);
}

// ------------------------------------------------------------------------ JWT

function jwtSign_(payload, expiresInSeconds) {
  var secret = prop_('ADMIN_JWT_SECRET');
  if (!secret) throw new Error('ADMIN_JWT_SECRET is not set. Run setup().');
  var body = {};
  Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
  var now = Math.floor(Date.now() / 1000);
  body.iat = now;
  body.exp = now + expiresInSeconds;
  var head = b64url_(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var data = head + '.' + b64url_(JSON.stringify(body));
  var sig = b64urlBytes_(Utilities.computeHmacSha256Signature(data, secret));
  return data + '.' + sig;
}

/** Returns the payload, or null when the token is missing / forged / expired. */
function jwtVerify_(token) {
  var secret = prop_('ADMIN_JWT_SECRET');
  if (!secret || !token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 3) return null;
  var expected = b64urlBytes_(Utilities.computeHmacSha256Signature(parts[0] + '.' + parts[1], secret));
  if (!safeEqual_(expected, parts[2])) return null;
  try {
    var payload = JSON.parse(b64urlDecode_(parts[1]));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ----------------------------------------------------------------- admin/user

/** { ok, configured, token, email } – mirrors checkAdminCredentials() of the Node backend */
function checkAdminCredentials_(email, password) {
  var adminEmail = prop_('ADMIN_EMAIL').trim().toLowerCase();
  var adminPassword = prop_('ADMIN_PASSWORD');
  if (!adminEmail || !adminPassword || !prop_('ADMIN_JWT_SECRET')) return { ok: false, configured: false };
  if (typeof email !== 'string' || typeof password !== 'string') return { ok: false, configured: true };
  var emailOk = safeEqual_(sha256Hex_(email.trim().toLowerCase()), sha256Hex_(adminEmail));
  var passOk = safeEqual_(sha256Hex_(password), sha256Hex_(adminPassword));
  if (!emailOk || !passOk) return { ok: false, configured: true };
  return {
    ok: true,
    configured: true,
    email: adminEmail,
    token: jwtSign_({ email: adminEmail, role: 'admin' }, 12 * 3600)
  };
}

function createCustomerToken_(user) {
  return jwtSign_({ sub: String(user.id), role: 'customer' }, 8 * 3600);
}

function bearer_(authorization) {
  var a = String(authorization || '');
  return a.indexOf('Bearer ') === 0 ? a.slice(7) : '';
}

/** Returns { session } or { error: response } */
function requireAdmin_(ctx) {
  if (!prop_('ADMIN_JWT_SECRET')) return { error: fail_(503, 'Admin authentication is not configured.') };
  var token = bearer_(ctx.authorization);
  if (!token) return { error: fail_(401, 'Admin sign-in is required.') };
  var session = jwtVerify_(token);
  if (!session) return { error: fail_(401, 'Admin session is invalid or expired.') };
  if (session.role !== 'admin') return { error: fail_(403, 'Admin access is required.') };
  return { session: session };
}

function requireCustomer_(ctx) {
  var token = bearer_(ctx.authorization);
  if (!prop_('ADMIN_JWT_SECRET') || !token) return { error: fail_(401, 'Customer sign-in is required.') };
  var session = jwtVerify_(token);
  if (!session) return { error: fail_(401, 'Customer session is invalid or expired.') };
  if (session.role !== 'customer' || !/^\d+$/.test(String(session.sub || ''))) {
    return { error: fail_(403, 'Customer access is required.') };
  }
  return { customerId: Number(session.sub) };
}
