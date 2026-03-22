// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { NoSvidError } from './error';

export interface SpiffeJwtClient {
  /**
   * Fetches a JWT-SVID for the specified audience and returns the JWT string.
   * If the workload is entitled to multiple SVIDs, the first one returned by the
   * Workload API is used.
   *
   * @example
   *
   * ```ts
   * const token = await spiffe.getJwt(['orders-api']);
   *
   * await fetch(url, {
   *   headers: { authorization: `Bearer ${token}` },
   * });
   * ```
   *
   * @throws {NoSvidError} if the API returns no SVIDs for the specified filter.
   */
  getJwt(
    audience: string | readonly string[],
    filter?: SvidFilter,
  ): Promise<string>;

  /**
   * Validates a JWT-SVID and returns the validated payload if accepted, or null if
   * the token is malformed or not untrusted.
   */
  validateJwt(
    expectedAudience: string,
    token: string,
  ): Promise<ValidatedJwtSvid | null>;
}

export interface SvidFilter {
  /**
   * Returns the SVID for the specified SPIFFE ID.
   */
  spiffeId?: string;

  /**
   * Returns only SVIDs whose hint matches the specified value. (SVIDs with an empty
   * hint are not returned.)
   */
  hint?: string;
}

export interface JwtSvid {
  spiffeId: string;
  hint: string | null;
  token: string;
}

export interface ValidatedJwtSvid {
  spiffeId: string;

  /**
   * Claims of the decoded JWT.
   */
  claims: Partial<Record<string, unknown>>;
}
