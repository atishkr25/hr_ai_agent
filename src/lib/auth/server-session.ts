import { cookies } from "next/headers";
import {
  EMPLOYEE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  verifyEmployeeToken,
  verifySessionToken,
} from "@/lib/chat/role";
import type { SessionUser } from "@/lib/chat/types";

/** Resolves the signed-in user for Server Components (employee first, then HR admin). */
export async function getServerSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const employee = verifyEmployeeToken(cookieStore.get(EMPLOYEE_COOKIE_NAME)?.value);
  if (employee) {
    return employee;
  }

  if (verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value) === "hr_admin") {
    return { id: "hr_admin", name: "HR Admin", email: "", role: "hr_admin" };
  }

  return null;
}
