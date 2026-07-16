// Permanent, self-contained contract tests for API-key transport and README examples.
// No network, database, dependency install, or real secret is required.
const fs = require("fs");
const path = require("path");
const { checkApiKey } = require("./lib/auth");

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  if (condition) {
    pass++;
    console.log("PASS:", name);
  } else {
    fail++;
    console.log("FAIL:", name);
  }
};

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function authenticate(req) {
  const res = makeResponse();
  const ok = checkApiKey({ headers: {}, query: {}, ...req }, res);
  return { ok, res };
}

const originalApiKey = process.env.API_KEY;
const testKey = "transport-test-&-#-?-with space";
process.env.API_KEY = testKey;

console.log("=== API KEY AUTH TRANSPORT ===");

const headerResult = authenticate({ headers: { "x-api-key": testKey } });
check("X-API-Key header diterima", headerResult.ok === true);
check("karakter reserved/spasi utuh di header", headerResult.res.statusCode === 200);

const bearerResult = authenticate({ headers: { authorization: `Bearer ${testKey}` } });
check("Authorization Bearer tetap diterima", bearerResult.ok === true);

const queryResult = authenticate({ query: { api_key: testKey } });
check("query api_key tetap diterima sementara", queryResult.ok === true);

const capturedConsole = [];
const invalidKey = "wrong-test-key";
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = (...args) => capturedConsole.push(args.join(" "));
console.warn = (...args) => capturedConsole.push(args.join(" "));
console.error = (...args) => capturedConsole.push(args.join(" "));

const missingResult = authenticate({});
const wrongResult = authenticate({ headers: { "x-api-key": invalidKey } });

console.log = originalLog;
console.warn = originalWarn;
console.error = originalError;

check("missing auth ditolak", missingResult.ok === false && missingResult.res.statusCode === 401);
check("wrong auth ditolak", wrongResult.ok === false && wrongResult.res.statusCode === 401);
const failureConsoleText = capturedConsole.join("\n");
const failureResponseText = JSON.stringify([missingResult.res.body, wrongResult.res.body]);
check("configured valid key tidak muncul di console", !failureConsoleText.includes(testKey));
check("supplied invalid key tidak muncul di console", !failureConsoleText.includes(invalidKey));
check("configured valid key tidak muncul di response", !failureResponseText.includes(testKey));
check("supplied invalid key tidak muncul di response", !failureResponseText.includes(invalidKey));

console.log("\n=== README CREDENTIAL EXAMPLES ===");

const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
const apiKeyRow = readme.split(/\r?\n/).find((line) => /^\|\s*`?API_KEY`?\s*\|/.test(line));
check(
  "API_KEY row memakai placeholder eksplisit",
  Boolean(apiKeyRow && apiKeyRow.includes("<generate-a-unique-random-api-key>"))
);
check("API_KEY row tidak lagi berupa contoh opaque", /^\|\s*`?API_KEY`?\s*\|\s*`?<generate-a-unique-random-api-key>`?\s*\|/.test(apiKeyRow || ""));
check("README mendokumentasikan X-API-Key sebagai metode utama", readme.includes("X-API-Key: <api-key>"));
check("README mendokumentasikan Bearer yang memang didukung", readme.includes("Authorization: Bearer <api-key>"));
check("query authentication ditandai deprecated", /deprecated/i.test(readme) && readme.includes("?api_key=<api-key>"));

if (originalApiKey === undefined) delete process.env.API_KEY;
else process.env.API_KEY = originalApiKey;

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
