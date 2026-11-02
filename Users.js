/**
 * Users.gs : register, login (admin + customer on one form), profile, Google sign-in.
 */

function publicUser_(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    address: row.address || '',
    profileImage: row.profileImage || ''
  };
}

function findUserBy_(table, fn) {
  for (var i = 0; i < table.rows.length; i++) if (fn(table.rows[i])) return table.rows[i];
  return null;
}


/**
 * Reject syntactically valid but obviously fabricated Indian mobile numbers
 * (all-same digits, repeated blocks such as 7676767676, and straight sequences).
 */
function isValidIndianMobile_(phone) {
  phone = String(phone || '').trim();

  // Indian mobile numbers must contain exactly 10 digits and start with 6-9.
  if (!PHONE_REGEX.test(phone)) return false;

  // Reject obvious placeholder numbers such as 9999999999 or 2222222222.
  if (/^(\d)\1{9}$/.test(phone)) return false;

  // Reject repeated blocks such as 8989898989 and 1234512345.
  if (/^(\d{2})\1{4}$/.test(phone) || /^(\d{5})\1$/.test(phone)) return false;

  // Reject the common ascending placeholder sequence, but do not reject
  // ordinary numbers merely because their digits descend or vary regularly.
  if (phone === '1234567890') return false;

  return true;
}

var REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000;
var REGISTRATION_CODE_RESEND_MS = 60 * 1000;
var REGISTRATION_CODE_MAX_ATTEMPTS = 5;
var REGISTRATION_FROM_EMAIL = 'kamageremart04@gmail.com';

function getRegistrationSenderEmail_() {
  return String(prop_('REGISTRATION_FROM_EMAIL') || REGISTRATION_FROM_EMAIL).trim().toLowerCase();
}

function getRegistrationEmailSender_() {
  var target = getRegistrationSenderEmail_();
  var effectiveUser = '';
  try {
    if (typeof Session !== 'undefined' && Session.getEffectiveUser) {
      effectiveUser = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    }
  } catch (e) {}
  if (effectiveUser && effectiveUser === target) {
    return { authorized: true, isAlias: false, email: target };
  }

  var activeUser = '';
  try {
    if (typeof Session !== 'undefined' && Session.getActiveUser) {
      activeUser = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
    }
  } catch (e) {}
  if (activeUser && activeUser === target) {
    return { authorized: true, isAlias: false, email: target };
  }

  var aliases = [];
  try {
    if (typeof GmailApp !== 'undefined' && GmailApp.getAliases) {
      aliases = GmailApp.getAliases().map(function (alias) { return String(alias || '').trim().toLowerCase(); });
    }
  } catch (e) {}
  if (aliases.indexOf(target) >= 0) {
    return { authorized: true, isAlias: true, email: target };
  }
  if (effectiveUser) {
    return { authorized: true, isAlias: false, email: effectiveUser };
  }
  if (activeUser) {
    return { authorized: true, isAlias: false, email: activeUser };
  }

  return { authorized: false, isAlias: false, currentAccount: effectiveUser || activeUser || 'unknown' };
}

function authorizeRegistrationEmail() {
  var sender = getRegistrationEmailSender_();
  if (!sender.authorized) {
    throw new Error(
      'Current Google account is [' + sender.currentAccount + '], but sender is set to [' + getRegistrationSenderEmail_() + ']. ' +
      'To send from ' + getRegistrationSenderEmail_() + ', either run this script from that account, ' +
      'or open Gmail Settings -> Accounts and Import -> "Send mail as" in ' + sender.currentAccount + ' and add ' + getRegistrationSenderEmail_() + '.'
    );
  }
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log('Registration email sender is authorized as ' + sender.email + ' (' + (sender.isAlias ? 'alias' : 'primary account') + '). Remaining daily recipient quota: ' + quota);
  return quota;
}

function registrationCodeHash_(email, code) {
  return sha256Hex_(prop_('ADMIN_JWT_SECRET') + ':' + email + ':' + code);
}

function findPendingRegistration_(email) {
  return findUserBy_(readTable_('PendingRegistrations'), function (row) {
    return row.email === email;
  });
}

function removeExpiredRegistrations_(keepEmail) {
  var now = Date.now();
  var rows = readTable_('PendingRegistrations').rows
    .filter(function (row) { return row.email !== keepEmail && Number(row.expiresAt) <= now; })
    .sort(function (a, b) { return b._row - a._row; });
  var sh = sheet_('PendingRegistrations');
  rows.forEach(function (row) { sh.deleteRow(row._row); });
}

function escapeEmailHtml_(value) {
  return String(value || '').replace(/[&<>"']/g, function (ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
}

function sendRegistrationCode_(email, code, recipientName) {
  if (typeof GmailApp === 'undefined' || !GmailApp.sendEmail) {
    return fail_(503, 'Email delivery is unavailable. Please contact the store administrator.');
  }
  try {
    if (MailApp.getRemainingDailyQuota && MailApp.getRemainingDailyQuota() < 1) {
      return fail_(429, 'Email verification is temporarily unavailable. Please try again later.');
    }
    var sender = getRegistrationEmailSender_();
    if (!sender.authorized) {
      return fail_(503, 'Email verification must be authorized to send from ' + getRegistrationSenderEmail_() + '. Ask the store administrator to add it as a verified Gmail "Send mail as" address.');
    }
    var logoBlob = Utilities.newBlob(
      Utilities.base64Decode('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'),
      'image/png',
      'kamagere-mart-logo.png'
    );
    var mailOptions = {
      name: 'Kamagere Mart',
      htmlBody: [
        '<!doctype html><html><body style="margin:0;padding:0;background:#050509;font-family:Arial,Helvetica,sans-serif;color:#f4f4f7;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050509;padding:32px 12px;"><tr><td align="center">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111118;border:1px solid #292936;border-radius:12px;overflow:hidden;">',
        '<tr><td align="center" style="padding:24px 24px 28px;border-bottom:1px solid #292936;">',
        '<img src="cid:kamagereLogo" width="66" height="72" alt="Kamagere Mart" style="display:block;width:66px;height:72px;object-fit:contain;margin:0 auto 12px;">',
        '<div style="font-size:22px;line-height:28px;font-weight:700;letter-spacing:.3px;color:#10d8cf;">Kamagere Mart</div>',
        '<div style="font-size:12px;line-height:20px;color:#9a9aaa;margin-top:4px;">Fresh essentials, delivered with care</div>',
        '</td></tr>',
        '<tr><td style="padding:32px 34px 36px;">',
        '<h1 style="margin:0 0 20px;font-size:18px;line-height:26px;color:#10d8cf;font-weight:700;">Verify Your Email</h1>',
        '<p style="margin:0 0 18px;font-size:14px;line-height:24px;color:#d0d0d9;">Hello ' + escapeEmailHtml_(recipientName || 'there') + ',</p>',
        '<p style="margin:0 0 18px;font-size:14px;line-height:24px;color:#d0d0d9;">Your one-time password for setting up your Kamagere Mart account is:</p>',
        '<div style="margin:0 0 20px;padding:25px 12px;background:#20202a;border:1px solid #00d7e8;border-radius:11px;text-align:center;font-size:34px;line-height:42px;letter-spacing:9px;font-weight:700;color:#00e0c8;">' + code + '</div>',
        '<p style="margin:0;font-size:13px;line-height:22px;color:#9b9baa;">Valid for <strong style="color:#f4f4f7;">10 minutes</strong>. Do not share this code with anyone.</p>',
        '<p style="margin:18px 0 0;font-size:13px;line-height:22px;color:#9b9baa;">If you did not request this code, you can safely ignore this email.</p>',
        '</td></tr>',
        '<tr><td align="center" style="padding:20px 24px;border-top:1px solid #292936;color:#858595;font-size:11px;line-height:19px;">© 2026 Kamagere Mart. All rights reserved.<br>Need help? Contact our store support team.</td></tr>',
        '</table></td></tr></table></body></html>'
      ].join(''),
      inlineImages: { kamagereLogo: logoBlob }
    };
    if (sender.isAlias || sender.email) mailOptions.from = sender.email;
    GmailApp.sendEmail(
      email,
      'Your Kamagere Mart verification code',
      'Your six-digit Kamagere Mart verification code is ' + code +
        '. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.',
      mailOptions
    );
    return null;
  } catch (error) {
    console.error('Unable to send registration verification email: ' + error);
    return fail_(503, 'Email verification could not be sent from ' + getRegistrationSenderEmail_() + '. Ask the store administrator to authorize this sender and Gmail access, then try again.');
  }
}

function registrationDetailsError_(body) {
  var name = String(body.name || '').trim();
  var email = String(body.email || '').trim().toLowerCase();
  var phone = String(body.phone || '').trim();
  var password = body.password;
  if (!name || !email || !phone || !password) return fail_(400, 'Please fill all required fields.');
  if (name.length > 255) return fail_(400, 'Enter a name up to 255 characters.');
  if (!EMAIL_REGEX.test(email)) return fail_(400, 'Please enter a valid email address.');
  if (!isValidIndianMobile_(phone)) return fail_(400, 'Enter a valid 10-digit Indian mobile number. Avoid repeated or patterned numbers.');
  if (!PASSWORD_REGEX.test(String(password))) {
    return fail_(400, 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special symbol.');
  }
  if (String(body.address || '').length > 2000) return fail_(400, 'Address must be 2,000 characters or fewer.');
  return null;
}

function registrationConflict_(email, phone) {
  var users = readTable_('Users');
  var emailTaken = findUserBy_(users, function (user) { return String(user.email).toLowerCase() === email; });
  var phoneTaken = findUserBy_(users, function (user) { return user.phone === phone; });
  if (!emailTaken && !phoneTaken) return null;
  return fail_(409, emailTaken && phoneTaken
    ? 'This email address and phone number are already registered.'
    : emailTaken ? 'Email is already registered.' : 'Phone number is already registered.');
}

function register_(ctx) {
  removeExpiredRegistrations_();
  var b = ctx.body;
  var validationError = registrationDetailsError_(b);
  if (validationError) return validationError;

  var name = String(b.name).trim();
  var email = String(b.email).trim().toLowerCase();
  var phone = String(b.phone).trim();
  var adminEmail = prop_('ADMIN_EMAIL').trim().toLowerCase();
  if (adminEmail && email === adminEmail) return fail_(409, 'This email address cannot be used for a customer account.');
  var conflict = registrationConflict_(email, phone);
  if (conflict) return conflict;

  var pending = findPendingRegistration_(email);
  var now = Date.now();
  if (pending && now - Number(pending.lastSentAt) < REGISTRATION_CODE_RESEND_MS) {
    return ok_({ message: 'A verification code was already sent. Check your email or wait before requesting another.', verificationRequired: true });
  }

  var code = String(parseInt(randomHex_(1).slice(0, 8), 16) % 900000 + 100000);
  var sendError = sendRegistrationCode_(email, code, name);
  if (sendError) return sendError;

  var record = {
    email: email,
    name: name,
    phone: phone,
    password: hashPassword_(String(b.password)),
    address: String(b.address || '').trim(),
    codeHash: registrationCodeHash_(email, code),
    expiresAt: now + REGISTRATION_CODE_TTL_MS,
    attempts: 0,
    lastSentAt: now
  };
  if (pending) updateRow_('PendingRegistrations', pending._row, record);
  else insertRow_('PendingRegistrations', record);
  return ok_({ message: 'A verification code has been sent to your email address.', verificationRequired: true }, 200);
}

function resendRegistrationCode_(ctx) {
  var email = String(ctx.body.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) return fail_(400, 'Please enter a valid email address.');
  removeExpiredRegistrations_(email);
  var pending = findPendingRegistration_(email);
  if (!pending) return fail_(404, 'Registration details were not found. Please create your account again.');
  var now = Date.now();
  if (now - Number(pending.lastSentAt) < REGISTRATION_CODE_RESEND_MS) {
    return fail_(429, 'Please wait one minute before requesting another code.');
  }

  var code = String(parseInt(randomHex_(1).slice(0, 8), 16) % 900000 + 100000);
  var sendError = sendRegistrationCode_(email, code, pending.name);
  if (sendError) return sendError;
  pending.codeHash = registrationCodeHash_(email, code);
  pending.expiresAt = now + REGISTRATION_CODE_TTL_MS;
  pending.attempts = 0;
  pending.lastSentAt = now;
  updateRow_('PendingRegistrations', pending._row, pending);
  return ok_({ message: 'A new verification code has been sent to your email address.' });
}

function verifyRegistration_(ctx) {
  var email = String(ctx.body.email || '').trim().toLowerCase();
  var code = String(ctx.body.code || '').trim();
  if (!EMAIL_REGEX.test(email)) return fail_(400, 'Please enter a valid email address.');
  if (!/^\d{6}$/.test(code)) return fail_(400, 'Enter the six-digit verification code.');

  var pending = findPendingRegistration_(email);
  if (!pending) return fail_(404, 'Registration details were not found. Please create your account again.');
  var pendingSheet = sheet_('PendingRegistrations');
  if (Number(pending.expiresAt) <= Date.now()) {
    pendingSheet.deleteRow(pending._row);
    return fail_(410, 'Your verification code expired. Create your account again to receive a new code.');
  }
  if (Number(pending.attempts) >= REGISTRATION_CODE_MAX_ATTEMPTS) {
    pendingSheet.deleteRow(pending._row);
    return fail_(429, 'Too many incorrect codes. Create your account again to restart verification.');
  }
  if (!safeEqual_(registrationCodeHash_(email, code), pending.codeHash)) {
    pending.attempts = Number(pending.attempts) + 1;
    updateRow_('PendingRegistrations', pending._row, pending);
    return fail_(400, 'That verification code is incorrect.');
  }

  var conflict = registrationConflict_(email, pending.phone);
  if (conflict) {
    pendingSheet.deleteRow(pending._row);
    return conflict;
  }
  var id = nextId_('Users');
  insertRow_('Users', {
    id: id, name: pending.name, email: email, phone: pending.phone, password: pending.password,
    address: pending.address, profileImage: ''
  });
  var user = findUserBy_(readTable_('Users'), function (row) { return row.id === id; });
  pendingSheet.deleteRow(pending._row);
  return ok_({ message: 'Email verified. You can now log in.', user: publicUser_(user) }, 201);
}

function login_(ctx) {
  var email = ctx.body.email;
  var password = ctx.body.password;
  if (!email || !password) return fail_(400, 'Email and password are required.');
  if (!EMAIL_REGEX.test(String(email).trim())) return fail_(400, 'Please enter a valid email address.');

  if (checkAdminCredentials_(email, password).ok) return fail_(401, 'Invalid email or password.');
  if (!PASSWORD_REGEX.test(String(password))) {
    return fail_(400, 'Password must be at least 8 characters and contain uppercase, lowercase, number, and special symbol.');
  }
  var wanted = String(email).trim().toLowerCase();
  var user = findUserBy_(readTable_('Users'), function (u) { return String(u.email).toLowerCase() === wanted; });
  if (!user || !user.password || !verifyPassword_(String(password), user.password)) {
    return fail_(401, 'Invalid email or password.');
  }
  return ok_({ message: 'Login successful', role: 'customer', user: publicUser_(user), token: createCustomerToken_(user) });
}

function adminLogin_(ctx) {
  var email = ctx.body.email;
  var password = ctx.body.password;
  if (!email || !password || typeof password !== 'string') return fail_(400, 'Admin email and password are required.');
  if (!EMAIL_REGEX.test(String(email).trim())) return fail_(400, 'Please enter a valid admin email address.');
  var check = checkAdminCredentials_(email, password);
  if (!check.configured) return fail_(503, 'Admin login is not configured.');
  if (!check.ok) return fail_(401, 'Invalid admin email or password.');
  return ok_({ message: 'Admin login successful', token: check.token, admin: { email: check.email, role: 'admin' } });
}

function adminSession_(ctx, m, auth) {
  return ok_({ admin: { email: auth.session.email, role: 'admin' }, expiresAt: auth.session.exp ? auth.session.exp * 1000 : null });
}

function updateProfile_(ctx, m, auth) {
  var b = ctx.body;
  var name = String(b.name || '').trim();
  var email = String(b.email || '').trim();
  var phone = String(b.phone || '').trim();
  var address = String(b.address || '').trim();
  var photo = String(b.profileImage || '');

  if (!name || name.length > 255) return fail_(400, 'Enter a name up to 255 characters.');
  if (!EMAIL_REGEX.test(email)) return fail_(400, 'Please enter a valid email address.');
  if (!isValidIndianMobile_(phone)) return fail_(400, 'Enter a valid 10-digit Indian mobile number. Avoid repeated or patterned numbers.');
  if (address.length > 2000) return fail_(400, 'Address must be 2,000 characters or fewer.');
  if (photo.length > 100000 || (photo && !/^data:image\/jpeg;base64,[A-Za-z0-9+\/]+={0,2}$/.test(photo))) {
    return fail_(400, 'Profile photos must be JPEG images smaller than 75 KB.');
  }

  var users = readTable_('Users');
  var dup = findUserBy_(users, function (u) {
    return u.id !== auth.customerId && (String(u.email).toLowerCase() === email.toLowerCase() || u.phone === phone);
  });
  if (dup) return fail_(409, 'That email address or phone number is already in use.');

  var existing = findUserBy_(users, function (u) { return u.id === auth.customerId; });
  if (!existing) return fail_(404, 'Customer account not found.');

  existing.name = name;
  existing.email = email;
  existing.phone = phone;
  existing.address = address;
  existing.profileImage = photo || existing.profileImage || '';
  updateRow_('Users', existing._row, existing);
  return ok_({ message: 'Profile updated successfully.', user: publicUser_(existing) });
}

// ---------------------------------------------------------------- Google login

function googleConfig_() {
  return ok_({ clientId: prop_('GOOGLE_CLIENT_ID') || null });
}

/** Verifies a Google ID token through Google's tokeninfo endpoint. */
function googleSignIn_(ctx) {
  var clientId = prop_('GOOGLE_CLIENT_ID');
  if (!clientId) return fail_(503, 'Google sign-in is not configured. Add GOOGLE_CLIENT_ID in Script Properties.');
  var credential = String(ctx.body.credential || '');
  if (!credential || credential.length > 12000) return fail_(400, 'A valid Google credential is required.');

  var info;
  try {
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return fail_(401, 'Unable to verify your Google account.');
    info = JSON.parse(resp.getContentText());
  } catch (e) {
    return fail_(401, 'Unable to verify your Google account.');
  }
  if (info.aud !== clientId) return fail_(401, 'Unable to verify your Google account.');
  if (!info.sub || !info.email || String(info.email_verified) !== 'true') {
    return fail_(401, 'Google did not provide a verified email address.');
  }

  var users = readTable_('Users');
  var wanted = String(info.email).toLowerCase();
  var user = findUserBy_(users, function (u) { return String(u.email).toLowerCase() === wanted; });
  if (!user) {
    var id = nextId_('Users');
    insertRow_('Users', {
      id: id, name: String(info.name || wanted.split('@')[0]).slice(0, 255), email: info.email, phone: '',
      password: '', address: '', profileImage: ''
    });
    user = findUserBy_(readTable_('Users'), function (u) { return u.id === id; });
  }
  return ok_({ message: 'Google sign-in successful', user: publicUser_(user), token: createCustomerToken_(user) });
}