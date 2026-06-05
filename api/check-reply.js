// api/check-reply.js
// POST /api/check-reply
// Body: { tracking_ids?: string[] }   ← kosong = cek semua pending

const Imap = require("imap");
const { simpleParser } = require("mailparser");
const { checkApiKey } = require("../lib/auth");
const {
  getActiveGmailAccounts,
  findPendingTrackings,
  findTrackingByMessageId,
  updateTrackingReply,
  updateImapLastUid,
  wibNow,
  jsonErr,
  jsonOk,
} = require("../lib/db");

// ─── Ambil email dari IMAP ─────────────────────────────────────────────────────
function fetchImapMessages(acc, sinceDate) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: acc.user,
      password: acc.pass,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    const messages = [];
    let lastUid = acc.imap_last_uid || 0;

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err) => {
        if (err) return reject(err);

        const criteria =
          lastUid > 0
            ? [["UID", `${lastUid + 1}:*`]]
            : [["SINCE", sinceDate]];

        imap.search(criteria, (err, uids) => {
          if (err || !uids || !uids.length) {
            imap.end();
            return resolve({ messages: [], lastUid });
          }

          const maxUid = Math.max(...uids);
          if (maxUid > lastUid) lastUid = maxUid;

          const f = imap.fetch(uids, { bodies: "" });

          f.on("message", (msg, seqno) => {
            let rawEmail = "";
            msg.on("body", (stream) => {
              stream.on("data", (chunk) => (rawEmail += chunk.toString("utf8")));
            });
            msg.once("end", () => messages.push(rawEmail));
          });

          f.once("error", (e) => reject(e));
          f.once("end", () => {
            imap.end();
            resolve({ messages, lastUid });
          });
        });
      });
    });

    imap.once("error", reject);
    imap.once("end", () => {});
    imap.connect();
  });
}

// ─── Ekstrak appeal ID dari teks balasan ─────────────────────────────────────
function extractAppealId(text) {
  if (!text) return null;
  const patterns = [
    /(?:appeal|banding|ticket|case|imap|uid|request)[:#\s\-]+([A-Z0-9][A-Z0-9_\-]{5,40})/i,
    /\b(GABRIEL-\d{8}-\d{4})\b/,
    /\b([A-Z]{2,6}-\d{6,})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return jsonErr(res, 405, "Method not allowed");
  if (!checkApiKey(req, res)) return;

  // Batas waktu Vercel 30s → kita pakai 25s internal guard
  const deadline = Date.now() + 25000;

  const { tracking_ids } = req.body || {};

  // Ambil semua pending tracking
  let pending = await findPendingTrackings();
  if (tracking_ids && Array.isArray(tracking_ids) && tracking_ids.length) {
    pending = pending.filter((t) => tracking_ids.includes(t.tracking_id));
  }
  if (!pending.length) return jsonOk(res, { checked: 0, replies_found: [] });

  // Kelompokkan per sender
  const bySender = {};
  for (const t of pending) {
    const s = (t.sender_user || "").toLowerCase();
    if (!s || !t.message_id) continue;
    if (!bySender[s]) bySender[s] = [];
    bySender[s].push(t);
  }

  const accounts = await getActiveGmailAccounts();
  const accMap = Object.fromEntries(accounts.map((a) => [a.user.toLowerCase(), a]));

  const repliesFound = [];
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 hari terakhir

  for (const [senderUser, tracks] of Object.entries(bySender)) {
    if (Date.now() > deadline) break; // jaga waktu Vercel

    const acc = accMap[senderUser];
    if (!acc) continue;

    let imapResult;
    try {
      imapResult = await fetchImapMessages(acc, sinceDate);
    } catch (e) {
      console.warn(`IMAP gagal untuk ${senderUser}:`, e.message);
      continue;
    }

    const { messages, lastUid } = imapResult;

    // Update last UID di DB
    if (lastUid > (acc.imap_last_uid || 0)) {
      await updateImapLastUid(acc.id, lastUid).catch(() => {});
    }

    // Buat map message_id → tracking
    const msgIdMap = Object.fromEntries(tracks.map((t) => [t.message_id, t]));

    for (const rawEmail of messages) {
      if (Date.now() > deadline) break;

      let parsed;
      try {
        parsed = await simpleParser(rawEmail);
      } catch {
        continue;
      }

      // Cek In-Reply-To / References
      const inReplyTo = parsed.inReplyTo || "";
      const references = (parsed.references || []).join(" ");
      const allRefs = `${inReplyTo} ${references}`;

      let matchedTrack = null;
      for (const [msgId, track] of Object.entries(msgIdMap)) {
        if (allRefs.includes(msgId)) {
          matchedTrack = track;
          break;
        }
      }

      if (!matchedTrack) continue;

      const bodyText =
        parsed.text || parsed.html || parsed.subject || "";
      const preview = bodyText.replace(/\s+/g, " ").trim().slice(0, 240);
      const appealId = extractAppealId(`${parsed.subject || ""} ${bodyText}`);

      await updateTrackingReply(matchedTrack.tracking_id, {
        latest_reply_from: String(parsed.from?.text || ""),
        latest_reply_subject: String(parsed.subject || ""),
        latest_reply_date: String(parsed.date || ""),
        latest_reply_preview: preview,
        appeal_id: appealId || matchedTrack.appeal_id || null,
      }).catch(() => {});

      repliesFound.push({
        tracking_id: matchedTrack.tracking_id,
        from: parsed.from?.text,
        subject: parsed.subject,
        preview,
        appeal_id: appealId,
        replied_at: wibNow(),
      });
    }
  }

  return jsonOk(res, {
    checked: pending.length,
    replies_found: repliesFound,
  });
};
