// test_smtp_error.js — Test untuk classifySmtpError() (lib/smtp-error.js).
// Self-contained, pass/fail counter, tidak butuh koneksi SMTP sungguhan.
const { classifySmtpError, SAFE_MESSAGES } = require("./lib/smtp-error");

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS:", n); } else { fail++; console.log("FAIL:", n); } };

console.log("=== PERMANENT AUTH ERROR ===");
{
  const r1 = classifySmtpError({ code: "EAUTH", responseCode: 535, message: "Invalid login: 535-5.7.8 Username and Password not accepted." });
  check("nodemailer EAUTH -> SMTP_AUTH_FAILED", r1.code === "SMTP_AUTH_FAILED");
  check("SMTP_AUTH_FAILED -> retryable=false", r1.retryable === false);

  const r2 = classifySmtpError({ responseCode: 535, message: "auth failed" });
  check("responseCode 535 tanpa e.code -> SMTP_AUTH_FAILED", r2.code === "SMTP_AUTH_FAILED");

  const r3 = classifySmtpError({ message: "Invalid login: Username and Password not accepted." });
  check("fallback string (tanpa code/responseCode sama sekali) -> SMTP_AUTH_FAILED", r3.code === "SMTP_AUTH_FAILED");
}

console.log("\n=== TRANSIENT INFRA ERROR ===");
{
  const cases = [
    { code: "ETIMEDOUT" }, { code: "ESOCKET" }, { code: "ECONNECTION" },
    { code: "ECONNRESET" }, { responseCode: 421 }, { responseCode: 450 },
  ];
  for (const c of cases) {
    const r = classifySmtpError(c);
    check(`${JSON.stringify(c)} -> SMTP_TEMPORARY_FAILURE (retryable=true)`, r.code === "SMTP_TEMPORARY_FAILURE" && r.retryable === true);
  }
}

console.log("\n=== RECIPIENT/MESSAGE ERROR ===");
{
  const r = classifySmtpError({ code: "EENVELOPE", message: "No recipients accepted" });
  check("EENVELOPE -> SMTP_RECIPIENT_ERROR", r.code === "SMTP_RECIPIENT_ERROR");
  check("SMTP_RECIPIENT_ERROR -> retryable=false (bukan sender's fault, jangan retry sender ini)", r.retryable === false);
}

console.log("\n=== AMBIGU -> TIDAK BOLEH diklaim auth failure ===");
{
  const r1 = classifySmtpError({ code: "SOME_UNKNOWN_CODE", message: "weird internal error" });
  check("code asing tidak dikenal -> SMTP_UNKNOWN_ERROR (bukan AUTH_FAILED)", r1.code === "SMTP_UNKNOWN_ERROR");
  check("SMTP_UNKNOWN_ERROR -> retryable=true (aman, tidak memicu auto-disable)", r1.retryable === true);

  const r2 = classifySmtpError({ message: "something went wrong, unclear cause" });
  check("string tanpa code, tidak match fallback auth phrase -> SMTP_UNKNOWN_ERROR", r2.code === "SMTP_UNKNOWN_ERROR");

  const r3 = classifySmtpError({});
  check("error kosong -> SMTP_UNKNOWN_ERROR, tidak crash", r3.code === "SMTP_UNKNOWN_ERROR");
}

console.log("\n=== SAFE_MESSAGES tidak pernah bocorkan detail SMTP mentah ===");
{
  for (const code of Object.keys(SAFE_MESSAGES)) {
    const msg = SAFE_MESSAGES[code];
    check(`${code}: pesan tidak mengandung kata 'password'`, !msg.toLowerCase().includes("password"));
    check(`${code}: pesan tidak mengandung '535' (raw SMTP code)`, !msg.includes("535"));
  }
}

console.log("\n=== KOREKSI: 530/534 TANPA EAUTH -> TIDAK BOLEH auto-disable ===");
{
  const r1 = classifySmtpError({ responseCode: 530, message: "5.7.0 Authentication Required" });
  check("responseCode 530 TANPA e.code -> BUKAN SMTP_AUTH_FAILED (safe default)", r1.code !== "SMTP_AUTH_FAILED");
  check("responseCode 530 sendirian -> SMTP_UNKNOWN_ERROR", r1.code === "SMTP_UNKNOWN_ERROR");

  const r2 = classifySmtpError({ responseCode: 534, message: "5.7.9 Application-specific password required" });
  check("responseCode 534 TANPA e.code -> BUKAN SMTP_AUTH_FAILED (butuh bukti tambahan)", r2.code !== "SMTP_AUTH_FAILED");

  const r3 = classifySmtpError({ code: "EAUTH", responseCode: 530 });
  check("e.code EAUTH (walau responseCode cuma 530) -> TETAP SMTP_AUTH_FAILED", r3.code === "SMTP_AUTH_FAILED");

  const r4 = classifySmtpError({ code: "EAUTH" }); // tanpa responseCode sama sekali
  check("EAUTH TANPA responseCode -> TETAP SMTP_AUTH_FAILED", r4.code === "SMTP_AUTH_FAILED");
}

console.log("\n=== KONTRAK send-email.js: pastikan tidak ada lagi raw leak di source ===");
{
  const fs = require("fs");
  const src = fs.readFileSync(require("path").join(__dirname, "api", "send-email.js"), "utf8");
  check("send-email.js TIDAK mengandung 'raw=' (pola log lama yang bocorkan e.response/e.message)", !src.includes("raw="));
  check("send-email.js TIDAK menaruh e.message langsung ke response body (grep `message: e.message`)", !src.includes("message: e.message") || !/return res\.status\(502\)[\s\S]{0,200}e\.message/.test(src));
  check("send-email.js pakai SAFE_MESSAGES untuk response error SMTP", src.includes("SAFE_MESSAGES[cls.code]"));
  check("send-email.js log pakai JSON.stringify (structured), bukan template string manual", /console\.error\(JSON\.stringify\(\{[\s\S]*operation:\s*"send_email"/.test(src));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
