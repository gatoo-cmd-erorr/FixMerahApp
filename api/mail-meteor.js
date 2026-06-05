// api/mail-meteor.js
// POST /api/mail-meteor
// Body: {
//   nomors: ["08xxx", "08yyy", ...],   ← max 5 nomor
//   to_email: "target@gmail.com",
//   subject: "...",
//   body: "...",                        ← bisa pakai {nomor} sebagai placeholder
//   user_id?: "...",
//   sender_email?: "...",              ← opsional, kalau tidak ada pakai DB
//   sender_pass?: "..."
// }
//
// Cara kerja:
// - Kirim 1 email per nomor (max 5)
// - Tiap email punya tracking_id unik
// - Return ringkasan: berhasil/gagal per nomor + semua tracking_id

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

const MAX_NOMOR = 5;

async function sendOne({ senderUser, senderPass, toEmail, subject, body }) {
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

  return info.messageId;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return jsonErr(res, 405, "Method not allowed");
  if (!checkApiKey(req, res)) return;

  const { nomors, to_email, subject, body, user_id, sender_email, sender_pass } =
    req.body || {};

  // ── Validasi ────────────────────────────────────────────────────────────────
  if (!Array.isArray(nomors) || nomors.length === 0)
    return jsonErr(res, 400, "nomors harus array minimal 1 nomor");
  if (nomors.length > MAX_NOMOR)
    return jsonErr(res, 400, `Maksimal ${MAX_NOMOR} nomor per request`);
  if (!to_email || !subject || !body)
    return jsonErr(res, 400, "to_email, subject, body wajib");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_email))
    return jsonErr(res, 400, "Format to_email tidak valid");

  // ── Pilih akun pengirim ──────────────────────────────────────────────────────
  let baseUser = sender_email;
  let basePass = sender_pass;
  let accounts = [];

  if (!baseUser || !basePass) {
    accounts = await getActiveGmailAccounts();
    if (!accounts.length) return jsonErr(res, 500, "Tidak ada akun Gmail aktif");
  }

  // ── Kirim per nomor ─────────────────────────────────────────────────────────
  const results = [];
  const baseTime = Date.now();

  for (let i = 0; i < nomors.length; i++) {
    const rawNomor = String(nomors[i] || "").trim();
    const normNomor = normalizeNomor(rawNomor);

    // Pilih sender: kalau ada banyak akun, rotasi per nomor
    let senderUser = baseUser;
    let senderPass2 = basePass;
    if (!senderUser && accounts.length) {
      const acc = accounts[i % accounts.length];
      senderUser = acc.user;
      senderPass2 = acc.pass;
    }

    // Replace placeholder {nomor} di body dan subject
    const finalSubject = subject.replace(/\{nomor\}/gi, rawNomor);
    const finalBody = body.replace(/\{nomor\}/gi, rawNomor);

    // Delay kecil antar kirim (hindari spam filter)
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));

    let messageId = null;
    let error = null;

    try {
      messageId = await sendOne({
        senderUser,
        senderPass: senderPass2,
        toEmail: to_email,
        subject: finalSubject,
        body: finalBody,
      });
    } catch (e) {
      error = e.message;
    }

    const trackingId = genTrackingId();

    if (messageId) {
      // Simpan tracking
      try {
        await insertTracking({
          tracking_id: trackingId,
          message_id: messageId,
          sender_user: senderUser,
          to_email,
          subject: finalSubject,
          nomor: normNomor,
          user_id: String(user_id || ""),
          status: "sent",
          reply_detected: false,
          reply_notified: false,
          reply_count: 0,
          created_at_ms: baseTime + i,
          created_at_text: wibNow(),
          replied_at_ms: null,
          replied_at_text: null,
          latest_reply_from: null,
          latest_reply_subject: null,
          latest_reply_preview: null,
          appeal_id: null,
          source: "mail_meteor",
        });
      } catch (dbErr) {
        error = (error || "") + ` [DB error: ${dbErr.message}]`;
      }
    }

    results.push({
      nomor: rawNomor,
      nomor_normalized: normNomor,
      tracking_id: messageId ? trackingId : null,
      message_id: messageId,
      sender: senderUser,
      status: messageId ? "sent" : "failed",
      error: error || null,
    });
  }

  // ── Ringkasan perbandingan ───────────────────────────────────────────────────
  const sent = results.filter((r) => r.status === "sent");
  const failed = results.filter((r) => r.status === "failed");

  return jsonOk(res, {
    summary: {
      total: nomors.length,
      sent: sent.length,
      failed: failed.length,
    },
    results,
    note:
      sent.length > 0
        ? `${sent.length} email terkirim. Gunakan /api/check-reply dengan tracking_ids untuk cek balasan.`
        : "Semua email gagal dikirim.",
  });
};
