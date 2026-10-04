"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_USER_COOKIE } from "@/platform/auth";

export async function switchUser(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  (await cookies()).set(DEMO_USER_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}
