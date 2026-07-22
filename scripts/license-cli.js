#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  PLAN_DEFS,
  createLicensePayload,
  signLicensePayload,
} = require("../electron/license");

const ROOT = path.resolve(__dirname, "..");
const KEYS_DIR = path.join(ROOT, "license-keys");
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, "private-key.pem");
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, "public-key.pem");
const APP_PUBLIC_KEY_PATH = path.join(ROOT, "assets", "license-public.pem");
const SALES_DIR = path.join(ROOT, "sales");
const SALES_LOG_PATH = path.join(SALES_DIR, "issued-licenses.jsonl");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureKeys() {
  ensureDir(KEYS_DIR);

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    return;
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(
    PRIVATE_KEY_PATH,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    "utf8"
  );
  fs.writeFileSync(
    PUBLIC_KEY_PATH,
    publicKey.export({ type: "spki", format: "pem" }),
    "utf8"
  );
}

function syncAppPublicKey() {
  ensureDir(path.dirname(APP_PUBLIC_KEY_PATH));
  fs.copyFileSync(PUBLIC_KEY_PATH, APP_PUBLIC_KEY_PATH);
}

function appendSalesLog(record) {
  ensureDir(SALES_DIR);
  fs.appendFileSync(SALES_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

function printUsage() {
  console.log(`
Usage:
  npm run license:init
  npm run license:generate -- --plan lifetime --email buyer@example.com --payment-ref PF123

Plans:
  ${Object.keys(PLAN_DEFS).join(", ")}
`);
}

function runInit() {
  ensureKeys();
  syncAppPublicKey();
  console.log(`Private key: ${PRIVATE_KEY_PATH}`);
  console.log(`Public key: ${PUBLIC_KEY_PATH}`);
  console.log(`App public key synced to: ${APP_PUBLIC_KEY_PATH}`);
}

function runGenerate(args) {
  const plan = String(args.plan || "").trim().toLowerCase();
  const email = String(args.email || "").trim();
  const paymentRef = String(args["payment-ref"] || "").trim();

  if (!PLAN_DEFS[plan]) {
    throw new Error("Missing or invalid --plan.");
  }

  if (!email) {
    throw new Error("Missing --email.");
  }

  ensureKeys();
  syncAppPublicKey();

  const payload = createLicensePayload({
    plan,
    email,
    paymentRef,
  });
  const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const licenseKey = signLicensePayload(payload, privateKeyPem);

  appendSalesLog({
    ...payload,
    licenseKey,
    createdAt: new Date().toISOString(),
  });

  console.log(JSON.stringify(payload, null, 2));
  console.log("\nLicense key:\n");
  console.log(licenseKey);
  console.log(`\nSaved sale record: ${SALES_LOG_PATH}`);
}

function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "init") {
    runInit();
    return;
  }

  if (command === "generate") {
    runGenerate(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
