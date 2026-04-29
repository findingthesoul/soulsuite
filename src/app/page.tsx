import { redirect } from "next/navigation";
import { getCurrentAuthUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentAuthUser();
  redirect(user ? "/dashboard" : "/auth/signin");
}
