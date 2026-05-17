import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { token, password } = (body ?? {}) as Record<string, string>;

  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  }

  // Look up the token
  const { data: rows } = await supabase
    .from("password_reset_tokens")
    .select("id, email, expires_at, used")
    .eq("token", token)
    .limit(1);

  const row = rows?.[0];

  if (!row) {
    return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
  }
  if (row.used) {
    return NextResponse.json({ error: "This reset link has already been used." }, { status: 400 });
  }
  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json({ error: "This reset link has expired. Please request a new one." }, { status: 400 });
  }

  // Hash the new password and update the user
  const password_hash = await bcrypt.hash(password, 10);
  const { error: updateError } = await supabase
    .from("app_users")
    .update({ password_hash })
    .eq("email", row.email);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update password." }, { status: 500 });
  }

  // Mark token as used
  await supabase
    .from("password_reset_tokens")
    .update({ used: true })
    .eq("id", row.id);

  return NextResponse.json({ ok: true });
}
