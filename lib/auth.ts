import { cookies } from "next/headers";

export async function createSession(userId: string) {
  cookies().set("session", userId, {
    httpOnly: true,
    secure: true,
    path: "/",
  });
}

export async function getSession() {
  return cookies().get("session")?.value || null;
}
