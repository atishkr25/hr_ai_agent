import { redirect } from "next/navigation";
import ChatInterface from "@/components/chat/ChatInterface";
import { getServerSessionUser } from "@/lib/auth/server-session";

export default async function DashboardPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <ChatInterface user={user} />;
}
