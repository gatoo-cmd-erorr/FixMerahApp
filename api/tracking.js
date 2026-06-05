// api/tracking.js
// GET  /api/tracking?user_id=&nomor=&status=&reply_detected=&tracking_id=&limit=
// POST /api/tracking  { action: "mark-notified", tracking_id }

const { checkApiKey } = require("../lib/auth");
const { findTrackings, markNotified, jsonErr, jsonOk } = require("../lib/db");

module.exports = async function handler(req, res) {
  if (!checkApiKey(req, res)) return;

  // ── GET: list tracking ────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { user_id, nomor, status, reply_detected, tracking_id, limit } = req.query;
    try {
      const records = await findTrackings({ user_id, nomor, status, reply_detected, tracking_id, limit });
      return jsonOk(res, { records, total: records.length });
    } catch (e) {
      return jsonErr(res, 500, e.message);
    }
  }

  // ── POST: mark-notified ───────────────────────────────────────────────────
  if (req.method === "POST") {
    const { action, tracking_id } = req.body || {};
    if (action !== "mark-notified") return jsonErr(res, 400, "action tidak dikenal");
    if (!tracking_id) return jsonErr(res, 400, "tracking_id wajib");
    try {
      await markNotified(tracking_id);
      return jsonOk(res, { tracking_id, marked: true });
    } catch (e) {
      return jsonErr(res, 500, e.message);
    }
  }

  return jsonErr(res, 405, "Method not allowed");
};
