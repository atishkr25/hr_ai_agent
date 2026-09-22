"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const demoQuestion = "How many days of annual leave do I get in my first year?";
const demoAnswer =
  "You are entitled to 21 annual leave days per calendar year after probation. [Policy: Annual Leave Policy, Section: 3.2 Entitlement, Page: 14]";

export default function Home() {
  const [typedQuestion, setTypedQuestion] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");

  useEffect(() => {
    let questionIndex = 0;
    let answerIndex = 0;
    let answerTimer: ReturnType<typeof setInterval> | null = null;

    const questionTimer = setInterval(() => {
      questionIndex += 1;
      setTypedQuestion(demoQuestion.slice(0, questionIndex));
      if (questionIndex >= demoQuestion.length) {
        clearInterval(questionTimer);

        answerTimer = setInterval(() => {
          answerIndex += 1;
          setTypedAnswer(demoAnswer.slice(0, answerIndex));
          if (answerIndex >= demoAnswer.length && answerTimer) {
            clearInterval(answerTimer);
          }
        }, 20);
      }
    }, 35);

    return () => {
      clearInterval(questionTimer);
      if (answerTimer) {
        clearInterval(answerTimer);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#0C0C0D] text-[#F5F5F5]">
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-[-0.03em] md:text-7xl">
            HR questions, answered instantly.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-[#8C8C95]">
            Stop forwarding the same email. HR AI AGENT reads your policies and answers employees in seconds with citations from the exact source.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="mechanical rounded-[6px] bg-[#6366F1] px-5 py-3 text-sm text-white hover:opacity-90"
            >
              Launch Chat
            </Link>
            <Link
              href="/dashboard/admin"
              className="mechanical rounded-[6px] border border-[#1F1F21] px-5 py-3 text-sm text-[#C2C2CA] hover:bg-[#1A1A1C]"
            >
              Open Admin
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="mt-12 rounded-[10px] border border-[#1F1F21] bg-[#141415] p-5"
        >
          <p className="mb-2 text-xs text-[#8C8C95]">Live chat demo</p>
          <div className="space-y-3">
            <div className="ml-auto max-w-[70%] rounded-[8px] border border-[#2D2D3F] bg-[#1E1E2E] px-4 py-3 text-sm">
              {typedQuestion}
            </div>
            <div className="max-w-[85%] border-l-2 border-l-[#6366F1] pl-4 text-sm leading-7">
              {typedAnswer}
              {typedAnswer.length < demoAnswer.length ? <span className="blink-cursor ml-1">▋</span> : null}
            </div>
          </div>
        </motion.div>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {[
            {
              title: "Policy-grounded",
              body: "Answers only from your actual HR documents with explicit citation formatting.",
            },
            {
              title: "Always escalates",
              body: "Knows when confidence is low and routes uncertain requests to HR reviewers.",
            },
            {
              title: "Audit-ready",
              body: "Every query includes role, timestamp, and trace context for enterprise controls.",
            },
          ].map((card) => (
            <article key={card.title} className="rounded-[10px] border border-[#1F1F21] bg-[#141415] p-4">
              <h3 className="text-base font-medium">{card.title}</h3>
              <p className="mt-2 text-sm text-[#8C8C95]">{card.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
