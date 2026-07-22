const crypto = require("crypto");

const PLAN_DEFS = {
  lifetime: { id: "lifetime", label: "Lifetime", durationDays: null },
  weekly: { id: "weekly", label: "1 Week", durationDays: 7 },
  monthly: { id: "monthly", label: "1 Month", durationDays: 30 },
};

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function getPlan(planId) {
  return PLAN_DEFS[planId] || null;
}

function createLicensePayload({ plan, email, paymentRef = "", issuedAt = Date.now() }) {
  const planDef = getPlan(plan);
  if (!planDef) {
    throw new Error(`Unknown plan: ${plan}`);
  }

  const safeEmail = String(email || "").trim().toLowerCase();
  if (!safeEmail) {
    throw new Error("Email is required.");
  }

  const payload = {
    product: "ActiveDesk",
    plan: planDef.id,
    email: safeEmail,
    paymentRef: String(paymentRef || "").trim(),
    issuedAt,
  };

  if (planDef.durationDays != null) {
    payload.expiresAt = issuedAt + planDef.durationDays * 24 * 60 * 60 * 1000;
  }

  return payload;
}

function signLicensePayload(payload, privateKeyPem) {
  const body = JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(body), privateKeyPem);
  return `${toBase64Url(body)}.${toBase64Url(signature)}`;
}

function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function decodeLicenseKey(licenseKey) {
  const trimmed = String(licenseKey || "").trim();
  
  // Check if it's a UUID (new format from Supabase)
  if (isValidUUID(trimmed)) {
    const payload = {
      product: "ActiveDesk",
      plan: "lifetime",
      email: "",
      issuedAt: Date.now(),
    };
    return { payload, payloadRaw: null, signature: null, isUUID: true };
  }

  // Otherwise expect RSA-signed format (old format)
  const parts = trimmed.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("License key format is invalid.");
  }

  const payloadRaw = fromBase64Url(parts[0]).toString("utf8");
  const payload = JSON.parse(payloadRaw);
  const signature = fromBase64Url(parts[1]);

  return { payload, payloadRaw, signature, isUUID: false };
}

function verifyLicenseKey(licenseKey, publicKeyPem, now = Date.now()) {
  try {
    const decoded = decodeLicenseKey(licenseKey);
    const { payload, payloadRaw, signature, isUUID } = decoded;
    const planDef = getPlan(payload?.plan);

    if (!planDef) {
      return { valid: false, status: "invalid", message: "Unknown license plan." };
    }

    // UUID format: accept without signature verification
    if (isUUID) {
      return {
        valid: true,
        status: "active",
        message: "License is active.",
        payload,
        plan: planDef,
      };
    }

    // RSA-signed format: verify signature
    if (payload.product !== "ActiveDesk") {
      return { valid: false, status: "invalid", message: "License is for a different product." };
    }

    const verified = crypto.verify(null, Buffer.from(payloadRaw), publicKeyPem, signature);
    if (!verified) {
      return { valid: false, status: "invalid", message: "License signature is invalid." };
    }

    if (payload.expiresAt && Number(payload.expiresAt) < now) {
      return {
        valid: false,
        status: "expired",
        message: "License has expired.",
        payload,
        plan: planDef,
      };
    }

    return {
      valid: true,
      status: "active",
      message: "License is active.",
      payload,
      plan: planDef,
    };
  } catch (error) {
    return {
      valid: false,
      status: "invalid",
      message: error?.message || "License could not be read.",
    };
  }
}

module.exports = {
  PLAN_DEFS,
  createLicensePayload,
  signLicensePayload,
  verifyLicenseKey,
};
