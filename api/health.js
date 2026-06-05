// api/health.js
// GET /api/health — cek koneksi MongoDB + SMTP + IMAP

const nodemailer = require("nodemailer");
const Imap = require("imap");
const { checkApiKey } = require("../lib/auth");
const { getDb, getActiveGmailAccounts, jsonOk, jsonErr } = require("../lib/db");

function checkSmtp(user, pass) {
  return new Promise((resolve) => {
    const t = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    t.verify((err) => resolve(!err));
  });
}

function checkImap(user, pass) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user,
      password: pass,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 8000,
      authTimeout: 8000,
    });
    imap.once("ready", () => {
      imap.end();
      resolve(true);
    });
    imap.once("error", () => resolve(false));
    imap.connect();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return jsonErr(res, 405, "Method not allowed");
  if (!checkApiKey(req, res)) return;

  const status = { mongo: false, smtp: false, imap: false, accounts_active: 0 };

  // MongoDB
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    status.mongo = true;
  } catch (e) {
    status.mongo_error = e.message;
  }

  // Ambil 1 akun aktif untuk cek SMTP + IMAP
  try {
    const accounts = await getActiveGmailAccounts();
    status.accounts_active = accounts.length;
    if (accounts.length > 0) {
      const acc = accounts[0];
      const [smtpOk, imapOk] = await Promise.all([
        checkSmtp(acc.user, acc.pass),
        checkImap(acc.user, acc.pass),
      ]);
      status.smtp = smtpOk;
      status.imap = imapOk;
      status.test_account = acc.user;
    }
  } catch (e) {
    status.account_error = e.message;
  }

  const allOk = status.mongo && status.smtp && status.imap;
  return res.status(allOk ? 200 : 503).json({
    ok: allOk,
    status,
    timestamp: new Date().toISOString(),
  });
};
