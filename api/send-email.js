// api/send-email.js
// POST /api/send-email
// Body: { to_email, subject, body, nomor?, user_id?, sender_email?, sender_pass? }
// Kalau sender_email & sender_pass tidak dikirim → pakai akun aktif dari MongoDB (round-robin)

const nodemailer = require("nodemailer");
const { checkApiKey } = require("../lib/auth");
const {
  getActiveGmailAccounts,
  insertTracking,
  genTrackingId,
  wibNow,
  normalizeNomor,
  jsonErr,
  jsonOk,
} = require("../lib/db");

// ─── Kirim via SMTP ────────────────────────────────────────────────────────────
async function sendViaSMTP({ senderUser, senderPass, toEmail, subject, body }) {
  // Transport SMTP STARTTLS port 587 (sama seperti Python: ehlo->starttls->ehlo->login)
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: senderUser, pass: senderPass },
    tls: { rejectUnauthorized: false },
  });

  // Deteksi html vs plain SAMA seperti Python (html bila body mengandung < DAN >)
  const isHtml = body.includes("<") && body.includes(">");

  // Domain Message-ID = domain milik sender (Python make_msgid(domain=...))
  const senderDomain = senderUser.includes("@") ? senderUser.split("@")[1] : "localhost";

  const info = await transporter.sendMail({
    // From dengan display name "Appeal Bot" — SAMA seperti Python formataddr(("Appeal Bot", ...))
    from: { name: "Appeal Bot", address: senderUser },
    to: toEmail,
    subject,
    // Single-part text ATAU html (Python kirim single-part, bukan multipart)
    [isHtml ? "html" : "text"]: body,
    // Content-Transfer-Encoding base64 (Python MIMEText utf-8 default = base64)
    encoding: "base64",
    // Message-ID domain = domain sender
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${senderDomain}>`,
    // Matikan header X-Mailer default nodemailer (Python TIDAK punya X-Mailer → hindari sinyal bot)
    xMailer: false,
  });

  return info.messageId; // format: <xxx@domain-sender>
}

// ─── Retry 2x ─────────────────────────────────────────────────────────────────
async function sendWithRetry(opts, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      if (i > 0) await new Promise((r) => setTimeout(r, 2000 * i));
      return await sendViaSMTP(opts);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return jsonErr(res, 405, "Method not allowed");
  if (!checkApiKey(req, res)) return;

  const { to_email, subject, body, nomor, user_id, sender_email, sender_pass } =
    req.body || {};

  // Validasi input
  if (!to_email || !subject || !body)
    return jsonErr(res, 400, "to_email, subject, body wajib diisi");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_email))
    return jsonErr(res, 400, "Format to_email tidak valid");
  if (body.length > 50000) return jsonErr(res, 400, "body terlalu panjang (max 50000 char)");

  // Pilih pengirim
  let senderUser = sender_email;
  let senderPass = sender_pass;

  if (!senderUser || !senderPass) {
    const accounts = await getActiveGmailAccounts();
    if (!accounts.length) return jsonErr(res, 500, "Tidak ada akun Gmail aktif di database");
    // Round-robin sederhana berdasarkan menit
    const idx = Math.floor(Date.now() / 60000) % accounts.length;
    const acc = accounts[idx];
    senderUser = acc.user;
    senderPass = acc.pass;
  }

  let messageId;
  try {
    messageId = await sendWithRetry({ senderUser, senderPass, toEmail: to_email, subject, body });
  } catch (e) {
    return jsonErr(res, 502, `SMTP gagal: ${e.message}`);
  }

  // Simpan ke tracking DB
  const trackingId = genTrackingId();
  const trackDoc = {
    tracking_id: trackingId,
    message_id: messageId,
    sender_user: senderUser,
    to_email,
    subject,
    nomor: normalizeNomor(nomor || ""),
    user_id: String(user_id || ""),
    status: "sent",
    reply_detected: false,
    reply_notified: false,
    reply_count: 0,
    created_at_ms: Date.now(),
    created_at_text: wibNow(),
    replied_at_ms: null,
    replied_at_text: null,
    latest_reply_from: null,
    latest_reply_subject: null,
    latest_reply_preview: null,
    appeal_id: null,
  };

  try {
    await insertTracking(trackDoc);
  } catch (e) {
    // Email sudah terkirim, tracking gagal → tetap return ok tapi dengan warning
    return jsonOk(res, {
      tracking_id: trackingId,
      message_id: messageId,
      sender: senderUser,
      warning: "Email terkirim tapi tracking DB gagal: " + e.message,
    });
  }

  return jsonOk(res, {
    tracking_id: trackingId,
    message_id: messageId,
    sender: senderUser,
    to: to_email,
    subject,
  });
};
