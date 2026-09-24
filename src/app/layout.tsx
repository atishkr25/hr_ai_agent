import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HR AI AGENT - Policy Q&A",
  description: "AI-powered HR policy assistant with citations and escalation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
