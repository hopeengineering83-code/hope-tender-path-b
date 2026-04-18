import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return <h1>Dashboard Working ✅</h1>;
}
