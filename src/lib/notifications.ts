import type { HrTicket } from "./chat/types";

export async function notifyHrTicket(ticket: HrTicket): Promise<HrTicket["notificationStatus"]> {
  const webhookUrl = process.env.HR_ESCALATION_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return "not_configured";
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "hr_ticket_created",
        ticket,
      }),
    });

    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
