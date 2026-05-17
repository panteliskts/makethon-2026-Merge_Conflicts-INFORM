import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { decryptPassword } from "@/lib/account-crypto";

// POST /api/accounts/switch — returns decrypted password for a saved account so the
// client can call signIn without prompting the user again.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.linkedEmail) {
    return NextResponse.json({ error: "Missing linkedEmail" }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const { data } = await supabase
    .from("user_saved_accounts")
    .select("linked_password_enc")
    .eq("owner_email", session.user.email)
    .eq("linked_email", body.linkedEmail)
    .single();

  if (!data?.linked_password_enc) {
    return NextResponse.json({ error: "No stored credentials" }, { status: 404 });
  }

  try {
    const password = decryptPassword(data.linked_password_enc);
    return NextResponse.json({ password });
  } catch {
    return NextResponse.json({ error: "Failed to decrypt" }, { status: 500 });
  }
}
