/** A failure to report to the user. Code 1 = the command failed, 2 = it was used wrongly. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
