import { createClient } from "npm:@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface GenerateLicenseRequest {
  email: string;
  plan: "lifetime" | "weekly" | "monthly";
}

const VALID_PLANS = new Set(["lifetime", "weekly", "monthly"]);
const PLAN_PRICE_USD: Record<GenerateLicenseRequest["plan"], number> = {
  lifetime: 10,
  weekly: 2,
  monthly: 5,
};

function generateLicenseKey(): string {
  // Generate a simple UUID v4 as the license key
  return crypto.randomUUID();
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, x-client-info, x-api-key, User-Agent",
        "Access-Control-Max-Age": "3600",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
      },
    });
  }

  const adminToken = Deno.env.get("LICENSE_ADMIN_TOKEN") || "";
  const requestToken = req.headers.get("x-license-admin-token") || "";
  if (!adminToken || requestToken !== adminToken) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, x-license-admin-token",
      },
    });
  }

  try {
    const body = (await req.json()) as GenerateLicenseRequest;

    const email = (body.email || "").trim().toLowerCase();
    const plan = (body.plan || "").trim().toLowerCase() as GenerateLicenseRequest["plan"];

    console.log("Request received:", { email, plan });

    if (!email || !plan || !VALID_PLANS.has(plan)) {
      return new Response(JSON.stringify({ error: "Missing email or plan" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
        },
      });
    }

    // Generate license key
    console.log("Generating license key...");
    const licenseKey = generateLicenseKey();
    console.log("License key generated successfully");

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

    // Create payment + linked license so licenses cannot exist without payment context.
    const reference = `manual_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .insert({
        email,
        reference,
        plan,
        amount_usd: PLAN_PRICE_USD[plan],
        amount_zar: null,
        status: "completed",
        payfast_response: { source: "manual_generate_license" },
      })
      .select("id")
      .single();

    if (paymentError || !paymentData?.id) {
      console.error("Payment insert error:", paymentError);
      return new Response(JSON.stringify({ error: "Failed to create payment context" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, x-license-admin-token",
        },
      });
    }

    // Store in database
    console.log("Inserting into database...");
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

    console.log("Database insert result:", { licenseData, licenseError });

    if (licenseError) {
      console.error("License insert error:", licenseError);
      return new Response(JSON.stringify({ error: "Failed to create license" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization, x-license-admin-token",
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        license_key: licenseKey,
        plan,
        issued_at: new Date().toISOString(),
        expires_at: expiresAt,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",

        },
      }
    );
  } catch (error) {
    console.error("Error caught:", error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");
    return new Response(JSON.stringify({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
      },
    });
  }
});
