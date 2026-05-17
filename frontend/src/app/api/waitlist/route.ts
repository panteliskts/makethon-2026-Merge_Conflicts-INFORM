import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const { name, email, company } = await req.json();

  if (!name?.trim() || !email?.trim() || !company?.trim()) {
    return NextResponse.json({ error: "All fields are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("waitlist")
    .insert({ name: name.trim(), email: email.trim().toLowerCase(), company: company.trim() });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This email is already on the waitlist." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not save your submission." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
