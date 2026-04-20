import { cookies } from "next/headers";

export async function createSession(userId: string) {
  const store = await cookies();
  store.set("session", userId, {
    httpOnly: true,
    path: "/",
  });
}

export async function getSession() {
  const store = await cookies();
  return store.get("session")?.value || null;
}

export async function destroySession() {
  const store = await cookies();
  store.delete("session");
}
