// lib/db.js - MongoDB connection & tracking helpers

const { MongoClient } = require("mongodb");

let _client = null;
let _db = null;

async function getDb() {
  if (_db) return _db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI env tidak di-set");
  _client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await _client.connect();
  _db = _client.db(process.env.MONGODB_DB || "fixmerah");
  return _db;
}

// ── Tracking CRUD ─────────────────────────────────────────────────────────────

async function insertTracking(doc) {
  const db = await getDb();
  const res = await db.collection("email_tracking").insertOne(doc);
  return res.insertedId;
}

async function findTrackingByMessageId(messageId) {
  const db = await getDb();
  return db.collection("email_tracking").findOne({ message_id: messageId });
}

async function findPendingTrackings() {
  const db = await getDb();
  return db
    .collection("email_tracking")
    .find({ reply_detected: false })
    .toArray();
}

async function updateTrackingReply(trackingId, replyData) {
  const db = await getDb();
  return db.collection("email_tracking").updateOne(
    { tracking_id: trackingId },
    {
      $set: {
        reply_detected: true,
        reply_notified: false,
        status: "reply_detected",
        ...replyData,
        replied_at_ms: Date.now(),
        replied_at_text: wibNow(),
      },
    }
  );
}

async function findTrackings({ user_id, nomor, status, reply_detected, tracking_id, limit = 20 } = {}) {
  const db = await getDb();
  const filter = {};
  if (user_id) filter.user_id = String(user_id);
  if (nomor) filter.nomor = String(nomor);
  if (status) filter.status = status;
  if (reply_detected !== undefined) filter.reply_detected = reply_detected === "true" || reply_detected === true;
  if (tracking_id) filter.tracking_id = String(tracking_id);
  return db
    .collection("email_tracking")
    .find(filter)
    .sort({ created_at_ms: -1 })
    .limit(Math.min(Number(limit) || 20, 100))
    .toArray();
}

async function markNotified(tracking_id) {
  const db = await getDb();
  return db.collection("email_tracking").updateOne(
    { tracking_id: String(tracking_id) },
    { $set: { reply_notified: true } }
  );
}

// ── Gmail Accounts ─────────────────────────────────────────────────────────────

async function getGmailAccounts() {
  const db = await getDb();
  return db.collection("gmail_accounts").find({}).toArray();
}

async function getActiveGmailAccounts() {
  const db = await getDb();
  return db.collection("gmail_accounts").find({ active: true }).toArray();
}

async function upsertGmailAccount(account) {
  const db = await getDb();
  return db.collection("gmail_accounts").updateOne(
    { id: account.id },
    { $set: account },
    { upsert: true }
  );
}

async function updateImapLastUid(accountId, lastUid) {
  const db = await getDb();
  return db
    .collection("gmail_accounts")
    .updateOne({ id: accountId }, { $set: { imap_last_uid: lastUid } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wibNow() {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function genTrackingId() {
  const now = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `GABRIEL-${datePart}-${rand}`;
}

function normalizeNomor(raw) {
  if (!raw) return "";
  let n = String(raw).replace(/[\s\-().+]/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  if (!n.startsWith("+")) n = "+" + n;
  return n;
}

function jsonErr(res, code, msg) {
  return res.status(code).json({ ok: false, error: msg });
}

function jsonOk(res, data) {
  return res.status(200).json({ ok: true, ...data });
}

module.exports = {
  getDb,
  insertTracking,
  findTrackingByMessageId,
  findPendingTrackings,
  updateTrackingReply,
  findTrackings,
  markNotified,
  getGmailAccounts,
  getActiveGmailAccounts,
  upsertGmailAccount,
  updateImapLastUid,
  wibNow,
  genTrackingId,
  normalizeNomor,
  jsonErr,
  jsonOk,
};
