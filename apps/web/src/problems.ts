/** What went wrong, to show: an error's message, or what was thrown when that's text. */
export function problemText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Something went wrong, and the browser didn't say what.";
}
