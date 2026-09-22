const NON_INCLUSIVE_PATTERNS = [
  /you guys/gi,
  /maternity only/gi,
  /normal employees/gi,
];

export function normalizeInclusiveTone(answer: string): string {
  let normalized = answer.trim();

  for (const pattern of NON_INCLUSIVE_PATTERNS) {
    normalized = normalized.replace(pattern, "team members");
  }

  if (!/[.!?]$/.test(normalized)) {
    normalized = `${normalized}.`;
  }

  return normalized;
}

export function isInclusiveTone(answer: string): boolean {
  return !NON_INCLUSIVE_PATTERNS.some((pattern) => pattern.test(answer));
}
