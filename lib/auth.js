// lib/auth.js - API Key middleware

function checkApiKey(req, res) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "API_KEY env tidak di-set di server" });
    return false;
  }
  const provided =
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace("Bearer ", "") ||
    req.query?.api_key;
  if (!provided || provided !== apiKey) {
    res.status(401).json({ ok: false, error: "Unauthorized: API key salah atau tidak ada" });
    return false;
  }
  return true;
}

module.exports = { checkApiKey };
