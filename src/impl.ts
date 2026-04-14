import { ChannelCredentials } from '@grpc/grpc-js';
import { TTLCache } from '@isaacs/ttlcache';
import { GrpcOptions, GrpcTransport } from '@protobuf-ts/grpc-transport';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { NoSvidError } from './error';
import {
  JwtSvid,
  ParsedJwtSvid,
  SpiffeJwtClient,
  ValidatedJwtSvid,
} from './interface';
import { Struct } from './proto/google/protobuf/struct';
import { SpiffeWorkloadAPIClient } from './proto/workloadapi.client';

export class SpiffeClient implements SpiffeJwtClient, AsyncDisposable {
  private readonly jwtSvidCache = new TTLCache<string, ParsedJwtSvid>();
  private readonly jwtSvidsInFlight = new Map<
    string,
    Promise<readonly JwtSvid[]>
  >();

  private readonly abortController = new AbortController();
  private readonly transport: GrpcTransport;
  private readonly api: SpiffeWorkloadAPIClient;

  /**
   * Constructs a SPIFFE Client instance with the given socket. If no socket is provided, the
   * `SPIFFE_ENDPOINT_SOCKET` environment variable will be used, and if neither are set, defaults
   * to `unix:///tmp/spire-agent/public/api.sock`.
   *
   * Format: `unix:///path/to/socket` for Unix domain sockets, or `tcp://host:port` for TCP sockets.
   *
   * @see https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Workload_Endpoint.md#4-locating-the-endpoint
   */
  constructor(socket?: string);

  /**
   * Constructs a SPIFFE Client instance with the given gRPC options.
   *
   * (Do not forget to set the `workload.spiffe.io` gRPC metadata to `true` in the options.)
   *
   * @see https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Workload_Endpoint.md
   */
  constructor(options: GrpcOptions);

  constructor(socketOrOptions?: string | GrpcOptions) {
    this.transport = new GrpcTransport(createGrpcOptions(socketOrOptions));
    this.api = new SpiffeWorkloadAPIClient(this.transport);
  }

  async getJwt(
    audience: string | readonly string[],
    hint?: string,
  ): Promise<string> {
    return (await this.getJwtSvid(audience, hint)).token;
  }

  async getJwtSvid(
    audience: string | readonly string[],
    hint?: string,
  ): Promise<ParsedJwtSvid> {
    const aud = typeof audience === 'string' ? [audience] : audience;
    const cacheKey = [aud.join('|'), hint ?? ''].join(':');

    const cached = this.jwtSvidCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const svid = (await this.listJwtSvids(cacheKey, aud, hint)).at(0);

    if (!svid) {
      throw new NoSvidError('JWT', hint);
    }

    const expiresAtMs = getJwtExpMs(svid.token);
    const parsed: ParsedJwtSvid = {
      ...svid,
      expiresAtMs,
    };

    const ttlRemainingMs = expiresAtMs - Date.now();
    if (ttlRemainingMs > 0) {
      this.jwtSvidCache.set(cacheKey, parsed, {
        ttl: ttlRemainingMs / 2,
      });
    }

    return parsed;
  }

  private async listJwtSvids(
    cacheKey: string,
    audience: readonly string[],
    hint?: string,
  ): Promise<readonly JwtSvid[]> {
    let inFlight = this.jwtSvidsInFlight.get(cacheKey);

    if (!inFlight) {
      inFlight = this._listJwtSvids(audience, hint);
      this.jwtSvidsInFlight.set(cacheKey, inFlight);

      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- We wait it further down below
      inFlight.finally(() => {
        this.jwtSvidsInFlight.delete(cacheKey);
      });
    }

    return await inFlight;
  }

  private async _listJwtSvids(
    audience: readonly string[],
    hint?: string,
  ): Promise<readonly JwtSvid[]> {
    let res;

    try {
      res = await this.api.fetchJWTSVID(
        {
          audience: [...audience],
          spiffeId: '',
        },
        { abort: this.abortController.signal },
      );
    } catch (err) {
      if (
        err instanceof RpcError &&
        (err.code === 'INVALID_ARGUMENT' || err.code === 'PERMISSION_DENIED')
      ) {
        return [];
      }

      throw err;
    }

    return res.response.svids
      .filter((svid) => !hint || svid.hint === hint)
      .map(
        (s): JwtSvid => ({
          spiffeId: s.spiffeId,
          token: s.svid,
        }),
      );
  }

  async validateJwt(
    expectedAudience: string,
    token: string,
  ): Promise<ValidatedJwtSvid | null> {
    let res;
    try {
      res = await this.api.validateJWTSVID(
        {
          audience: expectedAudience,
          svid: token,
        },
        { abort: this.abortController.signal },
      );
    } catch (err) {
      if (err instanceof RpcError && err.code === 'INVALID_ARGUMENT') {
        return null;
      }

      throw err;
    }

    return {
      spiffeId: res.response.spiffeId,
      claims: res.response.claims
        ? (Struct.toJson(res.response.claims) as Partial<
            Record<string, unknown>
          >)
        : {},
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    this.abortController.abort();
    this.transport.close();
  }
}

function getJwtExpMs(token: string): number {
  const parsedPayload = JSON.parse(
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Assume Workload API returns valid JWTs
    Buffer.from(token.split('.').at(1)!, 'base64url').toString('utf-8'),
  ) as { exp: number };

  return parsedPayload.exp * 1000;
}

function createGrpcOptions(
  socketOrOptions?: string | GrpcOptions,
): GrpcOptions {
  if (typeof socketOrOptions === 'object') {
    return socketOrOptions;
  }

  const host =
    socketOrOptions ??
    process.env.SPIFFE_ENDPOINT_SOCKET ??
    'unix:///tmp/spire-agent/public/api.sock';

  return {
    host,
    channelCredentials: ChannelCredentials.createInsecure(),
    meta: {
      'workload.spiffe.io': 'true',
    },
  };
}
