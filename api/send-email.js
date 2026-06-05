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
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: senderUser, pass: senderPass },
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from: `"FixMerah Bot" <${senderUser}>`,
    to: toEmail,
    subject,
    [body.includes("<") && body.includes(">") ? "html" : "text"]: body,
  });

  return info.messageId; // format: <xxx@gmail.com>
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
