import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import crypto from "crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = body?.email?.toLowerCase().trim();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Valid email required." }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  }

  // Check the user exists (via the SECURITY DEFINER function)
  const { data } = await supabase.rpc("get_user_by_email", { p_email: email });
  const user = Array.isArray(data) ? data[0] : data;

  // Always return success to avoid email enumeration
  if (!user) return NextResponse.json({ ok: true });

  // Invalidate any existing unused tokens for this email
  await supabase
    .from("password_reset_tokens")
    .update({ used: true })
    .eq("email", email)
    .eq("used", false);

  // Create a new token (expires in 1 hour)
  const token = crypto.randomBytes(32).toString("hex");
  const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await supabase.from("password_reset_tokens").insert({ email, token, expires_at });

  // Send email via Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "Email service not configured." }, { status: 503 });
  }

  const appUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${token}`;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "INFORM <noreply@inform.app>";

  const resend = new Resend(resendKey);
  const { error: emailError } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Reset your INFORM password",
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f6f4ef;border-radius:12px;">
        <div style="background:#d4572a;width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:24px;">
          <span style="color:#fff;font-size:18px;font-weight:900;">I</span>
        </div>
        <h1 style="font-size:22px;font-weight:800;color:#1c1a17;margin:0 0 8px;">Reset your password</h1>
        <p style="color:#635d54;font-size:15px;margin:0 0 24px;line-height:1.6;">
          We received a request to reset the password for <strong>${email}</strong>.
          Click the button below to choose a new password. The link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#d4572a;color:#fff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;margin-bottom:24px;">
          Reset password
        </a>
        <p style="color:#8a8278;font-size:13px;margin:0;line-height:1.6;">
          If you didn't request this, you can safely ignore this email.<br>
          This link will expire on ${new Date(expires_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC.
        </p>
      </div>
    `,
  });

  if (emailError) {
    return NextResponse.json({ error: "Failed to send email." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
