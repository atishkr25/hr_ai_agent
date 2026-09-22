"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Citation, PolicyChunk, UserRole } from "@/lib/chat/types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: Citation[];
  confidence?: number;
  escalated?: boolean;
  requestId?: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatMessage[];
};

type AnswerResponse = {
  chunks: PolicyChunk[];
  requestId: string;
  role: UserRole;
  query: string;
  answer: string;
  citations: Citation[];
  escalated: boolean;
  confidence: number;
  provider: "openai" | "azure-openai" | "local-fallback";
};

function createConversation(): Conversation {
  return {
    id: `conv_${Date.now()}`,
    title: "New conversation",
    createdAt: new Date().toISOString(),
    messages: [],
  };
}

function createMessage(role: "user" | "assistant", content: string): ChatMessage {
  return {
    id: `msg_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function groupLabel(dateIso: string): "Today" | "Yesterday" | "This Week" | "Older" {
  const now = new Date();
  const date = new Date(dateIso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor(
    (startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays <= 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays <= 7) {
    return "This Week";
  }
  return "Older";
}

function confidenceBadge(confidence = 0, escalated = false) {
  if (escalated || confidence < 0.6) {
    return {
      label: "Escalated to HR",
      className: "bg-[#2A1114] text-[#EF4444]",
    };
  }
  if (confidence <= 0.8) {
    return {
      label: "Review recommended",
      className: "bg-[#2A2110] text-[#F59E0B]",
    };
  }
  return {
    label: "High confidence",
    className: "bg-[#102315] text-[#22C55E]",
  };
}

export default function ChatInterface() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "conv_seed",
      title: "Leave policy Q",
      createdAt: new Date().toISOString(),
      messages: [],
    },
  ]);
  const [conversationId, setConversationId] = useState("conv_seed");
  const [role, setRole] = useState<UserRole>("employee");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamCitations, setStreamCitations] = useState<Citation[]>([]);
  const [streamConfidence, setStreamConfidence] = useState(0);
  const [streamEscalated, setStreamEscalated] = useState(false);
  const [streamRequestId, setStreamRequestId] = useState<string | undefined>(undefined);
  const [openCitationIds, setOpenCitationIds] = useState<Record<string, boolean>>({});
  const [offline, setOffline] = useState(false);
  const [showNoPolicyBanner, setShowNoPolicyBanner] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const syncOnline = () => setOffline(!navigator.onLine);
    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversations, streamText, isStreaming]);

  const currentConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) ?? conversations[0],
    [conversations, conversationId],
  );

  const groupedConversations = useMemo(() => {
    const groups: Record<string, Conversation[]> = {
      Today: [],
      Yesterday: [],
      "This Week": [],
      Older: [],
    };

    for (const conv of conversations) {
      groups[groupLabel(conv.createdAt)].push(conv);
    }

    return groups;
  }, [conversations]);

  function resetStreamState() {
    setStreamText("");
    setStreamCitations([]);
    setStreamConfidence(0);
    setStreamEscalated(false);
    setStreamRequestId(undefined);
  }

  function updateConversationMessages(convId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.id === convId
          ? {
              ...conv,
              messages: updater(conv.messages),
            }
          : conv,
      ),
    );
  }

  function updateInputHeight() {
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = "auto";
    const maxHeight = 24 * 5;
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`;
  }

  function newConversation() {
    const conv = createConversation();
    setConversations((prev) => [conv, ...prev]);
    setConversationId(conv.id);
    setSidebarOpen(false);
    resetStreamState();
  }

  async function sendMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed || isStreaming || offline) {
      return;
    }

    setShowNoPolicyBanner(false);
    setModelError(null);
    setIsStreaming(true);
    resetStreamState();

    const userMessage = createMessage("user", trimmed);
    updateConversationMessages(conversationId, (messages) => [...messages, userMessage]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const answerResponse = await fetch("/api/chat/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-role": role,
        },
        body: JSON.stringify({
          query: trimmed,
          conversationId,
        }),
      });

      const answerData = (await answerResponse.json()) as AnswerResponse | { error: string };
      if (!answerResponse.ok || "error" in answerData) {
        throw new Error("Unable to generate policy answer.");
      }

      setStreamRequestId(answerData.requestId);

      if (!answerData.chunks.length) {
        setShowNoPolicyBanner(true);
      }

      const tokens = answerData.answer.split(/(\s+)/).filter(Boolean);
      for (const token of tokens) {
        setStreamText((prev) => prev + token);
      }

      const assistantMessage = createMessage("assistant", answerData.answer);
      assistantMessage.citations = answerData.citations;
      assistantMessage.confidence = answerData.confidence;
      assistantMessage.escalated = answerData.escalated;
      assistantMessage.requestId = answerData.requestId;
      updateConversationMessages(conversationId, (messages) => [...messages, assistantMessage]);
      setStreamCitations(answerData.citations);
      setStreamConfidence(answerData.confidence);
      setStreamEscalated(answerData.escalated);
      setOpenCitationIds((prev) => ({ ...prev, [assistantMessage.id]: false }));
    } catch {
      setModelError("OpenAI is temporarily unavailable. Please try again.");
      const fallback = createMessage(
        "assistant",
        "Something went wrong. Please try again in a moment.",
      );
      fallback.escalated = false;
      fallback.confidence = 0;
      fallback.requestId = streamRequestId;
      updateConversationMessages(conversationId, (messages) => [...messages, fallback]);
    } finally {
      setIsStreaming(false);
      setStreamText("");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  const suggestionChips = [
    "How many days of annual leave do I get?",
    "What is the WFH policy?",
    "How does the medical benefits work?",
    "What is the notice period for resignation?",
  ];

  return (
    <main className="h-screen bg-[#0C0C0D] text-[#F5F5F5]">
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[#1F1F21] bg-[#0C0C0D]/90 px-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="mechanical inline-flex h-8 w-8 items-center justify-center border border-[#1F1F21] text-xs md:hidden"
            aria-label="Toggle conversations"
          >
            |||
          </button>
          <p className="text-[15px] font-semibold">HR AI AGENT</p>
        </div>

        <div className="flex items-center gap-3">
          {process.env.NODE_ENV !== "production" ? (
            <div className="hidden items-center gap-2 md:flex">
              <span className="text-[11px] text-[#8C8C95]">Role:</span>
              {(["employee", "manager", "hr_admin"] as UserRole[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={`mechanical rounded-[999px] border px-3 py-1 text-[11px] ${
                    role === item
                      ? "border-[#6366F1] bg-[#6366F1] text-white"
                      : "border-[#1F1F21] text-[#8C8C95]"
                  }`}
                >
                  {item.replace("_", " ")}
                </button>
              ))}
            </div>
          ) : null}

          <span className="rounded-[999px] border border-[#1F1F21] px-2 py-1 text-[10px] text-[#8C8C95]">
            {role}
          </span>
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#1F1F21] text-xs">
            U
          </span>
          <button className="text-xs text-[#8C8C95]">Logout</button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-48px)] grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside
          className={`absolute inset-y-12 left-0 z-20 w-[260px] border-r border-[#1F1F21] bg-[#0C0C0D] p-3 md:static md:inset-auto md:block ${
            sidebarOpen ? "block" : "hidden"
          }`}
        >
          <button
            type="button"
            onClick={newConversation}
            className="mechanical mb-4 h-9 w-full rounded-[6px] border border-[#1F1F21] text-sm hover:bg-[#1A1A1C]"
          >
            + New Chat
          </button>

          {(["Today", "Yesterday", "This Week", "Older"] as const).map((group) => {
            const items = groupedConversations[group];
            if (!items.length) {
              return null;
            }

            return (
              <div key={group} className="mb-4">
                <p className="mb-2 px-1 text-[11px] text-[#8C8C95]">{group}</p>
                <div className="space-y-1">
                  {items.map((conv) => (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => {
                        setConversationId(conv.id);
                        setSidebarOpen(false);
                      }}
                      className={`mechanical flex h-9 w-full items-center border-l-2 px-2 text-left text-[13px] ${
                        conv.id === conversationId
                          ? "border-l-[#6366F1] bg-[#1A1A1C]"
                          : "border-l-transparent hover:bg-[#1A1A1C]"
                      }`}
                    >
                      <span className="truncate">{conv.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <Link
            href="/dashboard/admin"
            className="mechanical mt-2 block rounded-[6px] border border-[#1F1F21] px-3 py-2 text-center text-xs text-[#8C8C95] hover:bg-[#1A1A1C]"
          >
            Open Admin Panel
          </Link>
        </aside>

        <section className="relative flex min-h-0 flex-col">
          <div className="flex-1 overflow-y-auto px-4 pb-40 pt-6 md:px-8">
            {offline ? (
              <div className="mb-4 border-l-4 border-[#EF4444] bg-[#2A1114] px-4 py-3 text-sm text-[#FCA5A5]">
                You appear offline. Connect to the internet to continue.
              </div>
            ) : null}

            {modelError ? (
              <div className="mb-4 border-l-4 border-[#F59E0B] bg-[#2A2110] px-4 py-3 text-sm text-[#FCD34D]">
                {modelError}
              </div>
            ) : null}

            {showNoPolicyBanner ? (
              <div className="mb-4 border-l-4 border-[#F59E0B] bg-[#1C1500] px-4 py-3 text-sm text-[#FCD34D]">
                No policy found for this query.
              </div>
            ) : null}

            {!currentConversation?.messages.length && !isStreaming ? (
              <div className="mx-auto mt-20 max-w-2xl text-center">
                <h2 className="text-2xl font-medium">What do you want to know about HR policy?</h2>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {suggestionChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setInput(chip)}
                      className="mechanical rounded-[6px] border border-[#1F1F21] px-3 py-2 text-[13px] text-[#C8C8CC] hover:bg-[#1A1A1C]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mx-auto max-w-3xl space-y-6">
              <AnimatePresence>
                {currentConversation?.messages.map((message) => {
                  const badge = confidenceBadge(message.confidence, message.escalated);
                  const citationsOpen = openCitationIds[message.id] ?? false;

                  return (
                    <motion.article
                      key={message.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className={message.role === "user" ? "ml-auto max-w-[70%]" : "max-w-[90%]"}
                    >
                      {message.role === "user" ? (
                        <div className="rounded-[8px] border border-[#2D2D3F] bg-[#1E1E2E] px-4 py-3 text-sm leading-7">
                          {message.content}
                        </div>
                      ) : (
                        <div className="border-l-2 border-l-[#6366F1] pl-4">
                          <p className="text-sm leading-7">{message.content}</p>

                          {typeof message.confidence === "number" ? (
                            <span className={`mt-3 inline-block rounded-[20px] px-2 py-[2px] text-[10px] ${badge.className}`}>
                              {badge.label}
                            </span>
                          ) : null}

                          {message.citations?.length ? (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenCitationIds((prev) => ({
                                    ...prev,
                                    [message.id]: !citationsOpen,
                                  }))
                                }
                                className="mechanical text-xs text-[#8C8C95]"
                              >
                                {message.citations.length} policy sources {citationsOpen ? "v" : ">"}
                              </button>

                              {citationsOpen ? (
                                <div className="mt-2 space-y-2">
                                  {message.citations.map((citation, index) => (
                                    <div
                                      key={`${message.id}-${index}`}
                                      className="rounded-[8px] border border-[#1F1F21] bg-[#141415] p-3"
                                    >
                                      <p className="text-sm">{citation.title}</p>
                                      <p className="text-xs text-[#8C8C95]">
                                        Section {citation.section} · Page {citation.page}
                                      </p>
                                      <p className="mono mt-1 line-clamp-2 text-xs text-[#B7B7C0]">
                                        Reference extracted from policy context.
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {message.escalated ? (
                            <div className="mt-3 rounded-r-[6px] border-l-[3px] border-l-[#F59E0B] bg-[#1C1500] px-4 py-3 text-sm text-[#FCD34D]">
                              This query has been flagged for HR review. Your HR team will follow up.
                            </div>
                          ) : null}
                        </div>
                      )}
                    </motion.article>
                  );
                })}
              </AnimatePresence>

              {isStreaming ? (
                <motion.article
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-[90%] border-l-2 border-l-[#6366F1] pl-4"
                >
                  {streamText ? (
                    <p className="text-sm leading-7">
                      {streamText}
                      <span className="blink-cursor ml-1 inline-block">▋</span>
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-[#8C8C95]">
                      <span>HR AI AGENT is thinking</span>
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6366F1] [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6366F1] [animation-delay:200ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6366F1] [animation-delay:400ms]" />
                      </span>
                    </div>
                  )}

                  {streamText && streamCitations.length ? (
                    <p className="mt-2 text-xs text-[#8C8C95]">
                      {streamCitations.length} policy sources ready
                    </p>
                  ) : null}

                  {streamRequestId ? (
                    <p className="mono mt-2 text-[10px] text-[#8C8C95]">Request {streamRequestId}</p>
                  ) : null}

                  {streamText ? (
                    <span
                      className={`mt-3 inline-block rounded-[20px] px-2 py-[2px] text-[10px] ${
                        confidenceBadge(streamConfidence, streamEscalated).className
                      }`}
                    >
                      {confidenceBadge(streamConfidence, streamEscalated).label}
                    </span>
                  ) : null}
                </motion.article>
              ) : null}
              <div ref={endRef} />
            </div>
          </div>

          <form
            onSubmit={onSubmit}
            className="absolute inset-x-0 bottom-0 border-t border-[#1F1F21] bg-[#0C0C0D] px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 md:px-8"
          >
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2 rounded-[6px] border border-[#1F1F21] bg-[#141415] p-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    updateInputHeight();
                  }}
                  onKeyDown={onInputKeyDown}
                  rows={1}
                  placeholder="Ask your HR policy question"
                  className="mechanical max-h-[120px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-[#8C8C95]"
                />
                <button
                  type="submit"
                  disabled={isStreaming || offline}
                  className="mechanical rounded-[6px] bg-[#6366F1] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[#8C8C95]">
               HR AI AGENT · Answers grounded in policy
              </p>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
