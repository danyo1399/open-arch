/** What's shown when what failed says nothing about why. */
export const UNKNOWN_PROBLEM = "Something went wrong, and the browser didn't say what.";

/** What went wrong, to show: the message of what was thrown, or what was thrown when that's text. */
export function problemText(error: unknown): string {
  // Any object with a message, not only an Error from this page: one from a worker or a frame isn't.
  // Only spaces say nothing either.
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (typeof error === "string" && error.trim()) return error;
  return UNKNOWN_PROBLEM;
}

/** Whether what was thrown is a DOMException or error of this kind, such as "AbortError". Safe for anything thrown, even nothing. */
export const isProblem = (error: unknown, name: string) => (error as { name?: unknown } | null)?.name === name;
