/** Confirmed notes stay scoped to a resume and matching task in this browser tab. */
function key(taskId: string, resumeId: string): string {
  return `offer-interview-tips:${JSON.stringify([taskId, resumeId])}`;
}

export function readInterviewTips(taskId: string, resumeId: string): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key(taskId, resumeId)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, tips]) =>
      Array.isArray(tips) && tips.every((tip: unknown) => typeof tip === "string")));
  } catch { return {}; }
}

export function saveInterviewTips(taskId: string, resumeId: string, tips: Record<string, string[]>): void {
  try { sessionStorage.setItem(key(taskId, resumeId), JSON.stringify(tips)); }
  catch { /* Keep the current page usable if storage is unavailable. */ }
}
