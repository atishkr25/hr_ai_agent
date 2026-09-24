import type { Metadata } from "next";
import { redirect } from "next/navigation";
import EmployeeAuthForm from "@/components/auth/EmployeeAuthForm";
import { getServerSessionUser } from "@/lib/auth/server-session";

export const metadata: Metadata = {
  title: "Sign in - HR AI AGENT",
};

export default async function LoginPage() {
  const user = await getServerSessionUser();
  if (user && user.role !== "hr_admin") {
    redirect("/dashboard");
  }

  return <EmployeeAuthForm />;
}
