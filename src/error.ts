export class NoSvidError extends Error {
  constructor(
    type: 'JWT' | 'X509',
    readonly hint?: string,
  ) {
    super(`No ${type}-SVID found.`);
    this.name = 'NoSvidError';
    Error.captureStackTrace(this, NoSvidError);
  }
}
