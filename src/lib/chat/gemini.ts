const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta";

export function isGeminiProvider(): boolean {
  return (
    process.env.AI_PROVIDER?.trim().toLowerCase() === "gemini" ||
    Boolean(process.env.GEMINI_API_KEY?.trim())
  );
}

export function getGeminiApiKey(): string | null {
  const explicitKey = process.env.GEMINI_API_KEY?.trim();
  if (explicitKey) {
    return explicitKey;
  }

  // Backward compatibility for the existing local setup, where the Gemini
  // key was placed in OPENAI_API_KEY before a provider name was introduced.
  if (isGeminiProvider()) {
    return process.env.OPENAI_API_KEY?.trim() || null;
  }

  return null;
}

type GeminiTextPart = {
  text?: string;
  thought?: boolean;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiTextPart[];
    };
  }>;
  error?: {
    message?: string;
  };
};

function readGeminiText(payload: GeminiGenerateResponse): string {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

async function readGeminiError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const payload = JSON.parse(body) as GeminiGenerateResponse;
    return payload.error?.message || `Gemini request failed with status ${response.status}.`;
  } catch {
    return body.slice(0, 300) || `Gemini request failed with status ${response.status}.`;
  }
}

export async function generateGeminiJson(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(
    `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 2048,
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(await readGeminiError(response));
  }

  const payload = (await response.json()) as GeminiGenerateResponse;
  const text = readGeminiText(payload);
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}
