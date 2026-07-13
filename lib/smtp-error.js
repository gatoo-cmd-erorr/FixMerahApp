// lib/smtp-error.js — Klasifikasi error SMTP terstruktur untuk POST /api/send-email.
// Dipisah dari db.js (yang murni schema/helper data) karena ini logic bisnis
// klasifikasi, bukan helper data mentah.
//
// Kategori (per keputusan Gabriel):
//   SMTP_AUTH_FAILED       — permanent, kredensial sender terbukti rusak
//   SMTP_TEMPORARY_FAILURE — transient (timeout/network/rate-limit/infra)
//   SMTP_RECIPIENT_ERROR   — alamat tujuan ditolak/invalid
//   SMTP_UNKNOWN_ERROR     — tidak bisa dipastikan -> diperlakukan retryable,
//                            TIDAK PERNAH dipakai caller untuk menandai sender rusak
//
// PRIORITAS: nodemailer error.code / error.responseCode (terstruktur) dulu.
// Fallback string HANYA dipakai kalau code/responseCode kosong — daftar
// sempit, case-insensitive, sengaja tidak digeneralisasi.

const AUTH_CODES = new Set(["EAUTH"]);
// HANYA 535 (Gmail: "535-5.7.8 Username and Password not accepted" — kode
// SMTP auth-gagal yang terdokumentasi resmi dan spesifik). 534 dan 530
// SENGAJA TIDAK dimasukkan di sini: keduanya dipakai Gmail/provider lain
// untuk berbagai kondisi (534 bisa berarti "app-specific password required"
// TAPI juga dipakai untuk kondisi account-policy lain; 530 seringkali
// "Authentication required" yang muncul sebelum STARTTLS/koneksi selesai —
// bukan bukti kredensial salah). Tanpa `e.code==="EAUTH"` sebagai penguat,
// treat sebagai ambigu (jatuh ke SMTP_UNKNOWN_ERROR) — safe default: JANGAN
// auto-disable atas dasar 530/534 sendirian.
const AUTH_RESPONSE_CODES = new Set([535]);

const TRANSIENT_CODES = new Set([
  "ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET", "ECONNABORTED", "EDNS", "ENOTFOUND",
]);
const TRANSIENT_RESPONSE_CODES = new Set([421, 450, 451, 452, 452, 454]); // 4xx SMTP = temporary

const RECIPIENT_CODES = new Set(["EENVELOPE"]);

// Fallback string SEMPIT — hanya dipakai kalau code/responseCode nodemailer
// tidak tersedia sama sekali. Case-insensitive, daftar sengaja pendek.
const AUTH_STRING_FALLBACKS = [
  "invalid login",
  "username and password not accepted",
  "application-specific password required",
];

/**
 * @param {Error & {code?: string, responseCode?: number, response?: string}} err
 * @returns {{ code: "SMTP_AUTH_FAILED"|"SMTP_TEMPORARY_FAILURE"|"SMTP_RECIPIENT_ERROR"|"SMTP_UNKNOWN_ERROR", retryable: boolean }}
 */
function classifySmtpError(err) {
  const code = err && err.code;
  const responseCode = err && err.responseCode;

  if (AUTH_CODES.has(code) || AUTH_RESPONSE_CODES.has(responseCode)) {
    return { code: "SMTP_AUTH_FAILED", retryable: false };
  }
  if (TRANSIENT_CODES.has(code) || TRANSIENT_RESPONSE_CODES.has(responseCode)) {
    return { code: "SMTP_TEMPORARY_FAILURE", retryable: true };
  }
  if (RECIPIENT_CODES.has(code)) {
    return { code: "SMTP_RECIPIENT_ERROR", retryable: false };
  }

  // Fallback string HANYA kalau code/responseCode benar-benar kosong.
  if (!code && !responseCode) {
    const raw = String((err && (err.response || err.message)) || "").toLowerCase();
    if (AUTH_STRING_FALLBACKS.some((phrase) => raw.includes(phrase))) {
      return { code: "SMTP_AUTH_FAILED", retryable: false };
    }
  }

  // Ambigu -> JANGAN pernah diklaim sebagai auth failure. Retryable=true
  // supaya caller (fix.js) tidak pernah menandai sender rusak dari kategori ini.
  return { code: "SMTP_UNKNOWN_ERROR", retryable: true };
}

// Pesan aman untuk HTTP response — TIDAK PERNAH raw e.message/e.response
// (bisa memuat detail SMTP internal). Detail asli hanya ke console.error
// server-side, tidak pernah ke response body.
const SAFE_MESSAGES = {
  SMTP_AUTH_FAILED: "Sender authentication failed",
  SMTP_TEMPORARY_FAILURE: "Temporary failure sending email, please retry",
  SMTP_RECIPIENT_ERROR: "Recipient address rejected",
  SMTP_UNKNOWN_ERROR: "Failed to send email",
};

module.exports = { classifySmtpError, SAFE_MESSAGES };
