This is an HR Policy Q&A agent built with Next.js App Router.

## Problem Statement Criteria Coverage

- Answer accuracy with citations: responses include inline citations in this format `"[Policy: TITLE, Section: SECTION, Page: PAGE]"`.
- Escalation for uncertain queries: low-confidence or missing-context responses return an escalation flag and are written to audit logs.
- Tone and inclusivity: prompts enforce warm and inclusive language.
- Security (role-based access): API routes enforce role checks with `x-user-role` (`employee`, `manager`, `hr_admin`).
- Maintenance of policy updates: HR admin can ingest PDF/DOCX documents and upsert policy chunks.

## Suggested Tech Stack Alignment

- LLM: OpenAI or Azure OpenAI (server-side).
- UI: Next.js + React.
- Backend API: Next.js route handlers (Node runtime for ingestion).
- Retrieval: in-memory retrieval over policy chunks (RAG-lite).
- Doc parsing: `pdf-parse` + `mammoth`.

## LLM Configuration

Set one of these in `.env.local`:

### OpenAI

```bash
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
```

### Azure OpenAI

```bash
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2024-10-21
```

If no API key is configured, the app falls back to a local deterministic answer engine so the UI remains functional.

## Admin Auth Configuration

To protect admin upload/update actions, set these in `.env.local`:

```bash
HR_ADMIN_PASSWORD=your_strong_admin_password
AUTH_SESSION_SECRET=your_random_long_secret
```

Notes:

- `HR_ADMIN_PASSWORD` is required for `/dashboard/admin` sign-in.
- `AUTH_SESSION_SECRET` signs the HTTP-only session cookie.
- In production, do not use default/dev values.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
