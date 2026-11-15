/** What went wrong, to show: the message of what was thrown, or what was thrown when that's text. */
export function problemText(error: unknown): string {
  // Any object with a message, not only an Error from this page: one from a worker or a frame isn't.
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  return "Something went wrong, and the browser didn't say what.";
}
