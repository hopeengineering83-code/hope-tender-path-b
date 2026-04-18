import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (email === "admin@hope.local" && password === "admin123") {
    await createSession("admin");
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid" }, { status: 401 });
}
