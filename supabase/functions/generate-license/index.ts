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

  try {
    const body = (await req.json()) as GenerateLicenseRequest;

    const { email, plan } = body;

    console.log("Request received:", { email, plan });

    if (!email || !plan) {
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

    // Store in database
    console.log("Inserting into database...");
    const { data: licenseData, error: licenseError } = await supabase
      .from("licenses")
      .insert({
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
          "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
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
