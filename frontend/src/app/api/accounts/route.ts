import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { encryptPassword } from "@/lib/account-crypto";

// GET /api/accounts — return saved accounts for the current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ accounts: [] });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ accounts: [] });

  const { data } = await supabase
    .from("user_saved_accounts")
    .select("linked_email, linked_name, linked_role, linked_image")
    .eq("owner_email", session.user.email)
    .order("created_at", { ascending: false })
    .limit(5);

  const accounts = (data ?? []).map((r) => ({
    email: r.linked_email,
    name: r.linked_name,
    role: r.linked_role,
    image: r.linked_image ?? undefined,
  }));

  return NextResponse.json({ accounts });
}

// POST /api/accounts — upsert a saved account
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.email) return NextResponse.json({ error: "Missing email" }, { status: 400 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "DB not configured" }, { status: 503 });

  const row: Record<string, unknown> = {
    owner_email:  session.user.email,
    linked_email: body.email,
    linked_name:  body.name ?? body.email,
    linked_role:  body.role ?? "client",
    linked_image: body.image ?? null,
  };
  if (body.password) {
    row.linked_password_enc = encryptPassword(body.password);
  }

  await supabase.from("user_saved_accounts").upsert(row, { onConflict: "owner_email,linked_email" });

  return NextResponse.json({ ok: true });
}

// DELETE /api/accounts?email=... — remove a saved account
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = new URL(req.url).searchParams.get("email");
  if (!email) return NextResponse.json({ error: "Missing email param" }, { status: 400 });

  const supabase = createAdminClient();
  if (!supabase) return NextResponse.json({ error: "DB not configured" }, { status: 503 });

  await supabase
    .from("user_saved_accounts")
    .delete()
    .eq("owner_email", session.user.email)
    .eq("linked_email", email);

  return NextResponse.json({ ok: true });
}
