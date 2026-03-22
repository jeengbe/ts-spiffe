import { SvidFilter } from './interface';

export class NoSvidError extends Error {
  constructor(
    type: 'JWT' | 'X509',
    readonly filter?: SvidFilter,
  ) {
    super(`No ${type}-SVID found for the specified filter`);
    this.name = 'NoSvidError';
    Error.captureStackTrace(this, NoSvidError);
  }
}
