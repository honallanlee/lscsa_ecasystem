/** An error whose message is safe and useful to show on screen. */
export class UserError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const bad = (message: string) => new UserError('BAD', message);
