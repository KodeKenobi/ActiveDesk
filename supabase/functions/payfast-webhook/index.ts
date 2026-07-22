import { createClient } from "@supabase/supabase-js";
import * as crypto from "crypto";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// RSA private key for generating licenses (load from environment)
const PRIVATE_KEY = Deno.env.get("LICENSE_PRIVATE_KEY")!;

// PayFast merchant key for verification
const PAYFAST_MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;

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

async function generateLicenseKey(plan: string, email: string): Promise<string> {
  // Create a payload with plan, email, and timestamp
  const timestamp = new Date().toISOString();
  const payload = `${plan}|${email}|${timestamp}`;

  // Sign with RSA private key
  const signer = crypto.createSign("sha256");
  signer.update(payload);
  const signature = signer.sign(PRIVATE_KEY, "base64");

  // Return base64 encoded: plan|email|timestamp|signature
  const key = Buffer.from(`${payload}|${signature}`).toString("base64");
  return key;
}

function verifyPayFastSignature(data: Record<string, string>, signature: string): boolean {
  const sortedData: Record<string, string> = {};

  // Sort data alphabetically (excluding signature and source)
  Object.keys(data)
    .sort()
    .forEach((key) => {
      if (key !== "signature" && key !== "source") {
        sortedData[key] = data[key];
      }
    });

  // Build query string with merchant key
  const parts = [PAYFAST_MERCHANT_KEY];
  Object.entries(sortedData).forEach(([key, value]) => {
    parts.push(`${key}=${encodeURIComponent(value)}`);
  });

  const toSign = parts.join("&");
  const hash = crypto.createHash("md5").update(toSign).digest("hex");

  return hash === signature;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const formData = await req.formData();
    const ipn: PayFastIPN = {} as any;

    // Convert FormData to object
    formData.forEach((value, key) => {
      ipn[key as keyof PayFastIPN] = value as string;
    });

    // Verify signature
    if (!verifyPayFastSignature(ipn as any, ipn.signature)) {
      console.error("Invalid PayFast signature");
      return new Response("Signature verification failed", { status: 400 });
    }

    // Check payment status
    if (ipn.payment_status !== "COMPLETE") {
      console.log(`Payment not complete: ${ipn.payment_status}`);
      return new Response("Payment not complete", { status: 200 });
    }

    const email = ipn.custom_str1 || ipn.email_address;
    const plan = ipn.custom_str2 || "monthly";
    const reference = ipn.m_payment_id;

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
    const licenseKey = await generateLicenseKey(plan, email);

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
