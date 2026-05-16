import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/utils/supabase/admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { name, email, password, role } = body as Record<string, string>;

  if (!name?.trim() || !email?.trim() || !password?.trim()) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  const userRole = role === "admin" ? "admin" : "client";

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Database not configured. Contact support." },
      { status: 503 },
    );
  }

  // Check for duplicate email
  const { data: existing } = await supabase
    .from("app_users")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { error } = await supabase.from("app_users").insert({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password_hash,
    role: userRole,
  });

  if (error) {
    return NextResponse.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
