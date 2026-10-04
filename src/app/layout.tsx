import type { Metadata } from "next";
import type { ReactNode } from "react";
import { apps } from "@/apps";
import { getCurrentUser, listDemoUsers } from "@/platform/auth";
import { accessibleApps } from "@/platform/registry";
import { Header } from "@/platform/ui/Header";
import "./globals.css";

export const metadata: Metadata = { title: "Internal Tools" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [user, users] = await Promise.all([getCurrentUser(), listDemoUsers()]);
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <Header user={user} users={users} apps={accessibleApps(user, apps)} />
        <main className="mx-auto max-w-6xl p-6">{children}</main>
      </body>
    </html>
  );
}
