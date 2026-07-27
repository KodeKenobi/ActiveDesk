import { createClient } from "npm:@supabase/supabase-js@2";
import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// RSA private key for generating licenses (load from environment)
const PRIVATE_KEY = Deno.env.get("LICENSE_PRIVATE_KEY")!;

// PayFast merchant key for verification
const PAYFAST_MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
const PAYFAST_PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE") || "";

interface PayFastIPN {
  m_payment_id: string;
  pf_payment_id: string;
  payment_status: string;
  item_name: string;
  item_description: string;
  amount_gross: string;
  amount_fee: string;
  amount_net: string;
  custom_str1: string; // email
  custom_str2: string; // plan
  email_address: string;
  merchant_id: string;
  source: string;
  signature: string;
}

const VALID_PLANS = new Set(["weekly", "monthly", "lifetime"]);

function toBase64Url(input: Buffer): string {
  return input.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function generateLicenseKey(plan: string, email: string, reference: string): Promise<string> {
  const issuedAt = Date.now();
  const durationDays = plan === "weekly" ? 7 : plan === "monthly" ? 30 : null;

  const payload: Record<string, unknown> = {
    product: "ActiveDesk",
    plan,
    email,
    paymentRef: reference,
    issuedAt,
  };
  if (durationDays != null) {
    payload.expiresAt = issuedAt + durationDays * 24 * 60 * 60 * 1000;
  }

  const body = JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(body), PRIVATE_KEY);
  return `${toBase64Url(Buffer.from(body))}.${toBase64Url(signature)}`;
}

function phpUrlencode(str: string): string {
  // PHP urlencode: encode spaces as + (not %20)
  return encodeURIComponent(str).replace(/%20/g, "+");
}

function verifyPayFastSignature(data: Record<string, string>, signature: string, fieldOrder: string[]): boolean {
  // Per PayFast docs: loop through fields in received order, stop (break) at 'signature'
  // Include ALL fields (even empty), URL-encode values, then append passphrase
  const parts: string[] = [];
  for (const key of fieldOrder) {
    if (key === "signature") break; // stop here, don't include signature
    parts.push(`${key}=${phpUrlencode(data[key] ?? "")}`);
  }

  let toSign = parts.join("&");
  if (PAYFAST_PASSPHRASE) {
    toSign += `&passphrase=${phpUrlencode(PAYFAST_PASSPHRASE)}`;
  }

  const hash = crypto.createHash("md5").update(toSign).digest("hex");
  return hash === signature;
}

Deno.serve(async (req) => {
  console.log(`[webhook] Request received: ${req.method}`);
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const formData = await req.formData();
    const ipn: PayFastIPN = {} as any;
    const fieldOrder: string[] = [];

    // Convert FormData to object and track order
    formData.forEach((value, key) => {
      ipn[key as keyof PayFastIPN] = value as string;
      fieldOrder.push(key);
    });

    console.log(`[webhook] IPN received with ${Object.keys(ipn).length} fields`);
    console.log(`[webhook] Fields in order: ${fieldOrder.join(", ")}`);

    // Verify signature
    if (!verifyPayFastSignature(ipn as any, ipn.signature, fieldOrder)) {
      console.error("Invalid PayFast signature");
      return new Response("Signature verification failed", { status: 400 });
    }

    // Check payment status
    if (ipn.payment_status !== "COMPLETE") {
      console.log(`Payment not complete: ${ipn.payment_status}`);
      return new Response("Payment not complete", { status: 200 });
    }

    const email = (ipn.custom_str1 || ipn.email_address || "").trim().toLowerCase();
    const plan = (ipn.custom_str2 || "").trim().toLowerCase();
    const reference = ipn.m_payment_id;

    if (!email || !reference) {
      console.error("Missing required PayFast fields", { email, reference });
      return new Response("Missing required payment fields", { status: 400 });
    }

    if (!VALID_PLANS.has(plan)) {
      console.error("Invalid plan received from PayFast", { plan, reference, email });
      return new Response("Invalid plan in payment payload", { status: 400 });
    }

    // Check if payment already processed
    const { data: existing } = await supabase
      .from("payments")
      .select("id")
      .eq("reference", reference)
      .single();

    if (existing) {
      return new Response("Payment already processed", { status: 200 });
    }

    // Create payment record
    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .insert({
        email,
        reference,
        plan,
        amount_usd: parseFloat(ipn.amount_gross),
        amount_zar: parseFloat(ipn.amount_net),
        status: "completed",
        payfast_response: ipn,
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Payment insert error:", paymentError);
      return new Response("Failed to record payment", { status: 500 });
    }

    // Generate license key
    const licenseKey = await generateLicenseKey(plan, email, reference);

    // Calculate expiry
    let expiresAt = null;
    if (plan === "weekly") {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      expiresAt = date.toISOString();
    } else if (plan === "monthly") {
      const date = new Date();
      date.setMonth(date.getMonth() + 1);
      expiresAt = date.toISOString();
    }

    // Create license record
    const { data: licenseData, error: licenseError } = await supabase
      .from("licenses")
      .insert({
        payment_id: paymentData.id,
        email,
        license_key: licenseKey,
        plan,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (licenseError) {
      console.error("License insert error:", licenseError);
      return new Response("Failed to create license", { status: 500 });
    }

    console.log(`License created: ${email} - ${plan}`);

    return new Response("Payment processed successfully", { status: 200 });
  } catch (error) {
    console.error("Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
});
