"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Mode = "signin" | "register";

const inputClass =
  "mechanical w-full rounded-[6px] border border-[#1F1F21] bg-[#0C0C0D] px-3 py-2 text-sm outline-none focus:border-[#6366F1]";

export default function EmployeeAuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "register" && name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        mode === "signin" ? "/api/auth/employee/login" : "/api/auth/employee/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "signin" ? { email, password } : { name, email, password }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Something went wrong. Please try again.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0C0C0D] p-6 text-[#F5F5F5]">
      <div className="mx-auto mt-16 max-w-md">
        <Link href="/" className="text-[15px] font-semibold">
          HR AI AGENT
        </Link>
        <p className="mt-1 text-sm text-[#8C8C95]">Employee access to the HR policy assistant.</p>

        <div className="mt-6 rounded-[10px] border border-[#1F1F21] bg-[#141415] p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-[6px] border border-[#1F1F21] p-1">
            {(["signin", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchMode(item)}
                className={`mechanical rounded-[4px] py-2 text-sm ${
                  mode === item ? "bg-[#6366F1] text-white" : "text-[#8C8C95] hover:text-[#F5F5F5]"
                }`}
              >
                {item === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="grid gap-3">
            {mode === "register" ? (
              <label className="grid gap-1 text-xs text-[#8C8C95]">
                Full name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="Priya Sharma"
                  className={inputClass}
                  required
                />
              </label>
            ) : null}

            <label className="grid gap-1 text-xs text-[#8C8C95]">
              Work email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                className={inputClass}
                required
              />
            </label>

            <label className="grid gap-1 text-xs text-[#8C8C95]">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder={mode === "register" ? "At least 8 characters" : ""}
                className={inputClass}
                required
              />
            </label>

            {error ? (
              <div className="rounded-[6px] border border-[#7F1D1D] bg-[#2A1114] px-3 py-2 text-xs text-[#FCA5A5]">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mechanical mt-1 rounded-[6px] bg-[#6366F1] px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {submitting
                ? mode === "signin" ? "Signing in..." : "Creating account..."
                : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-[#8C8C95]">
          HR team?{" "}
          <Link href="/dashboard/admin" className="text-[#A5B4FC] hover:underline">
            Open the admin workspace
          </Link>
        </p>
      </div>
    </main>
  );
}
