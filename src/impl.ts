import 'reflect-metadata';

import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcOptions, GrpcTransport } from '@protobuf-ts/grpc-transport';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { NoSvidError } from './error';
import {
  JwtSvid,
  SpiffeJwtClient,
  SvidFilter,
  ValidatedJwtSvid,
} from './interface';
import { Struct } from './proto/google/protobuf/struct';
import { SpiffeWorkloadAPIClient } from './proto/workloadapi.client';

export class SpiffeClientImpl implements SpiffeJwtClient, Disposable {
  private readonly abortController = new AbortController();
  private readonly transport: GrpcTransport;
  private readonly api: SpiffeWorkloadAPIClient;

  /**
   * Constructs a SpiffeClientImpl with the given socket. If no socket is provided, the
   * `SPIFFE_ENDPOINT_SOCKET` environment variable will be used.
   *
   * Format: `unix:///path/to/socket` for Unix domain sockets, or `tcp://host:port` for TCP sockets.
   *
   * @see https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Workload_Endpoint.md#4-locating-the-endpoint
   */
  constructor(socket?: string);

  /**
   * Constructs a SpiffeClientImpl with the given gRPC options.
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
    filter?: SvidFilter,
  ): Promise<string> {
    const svids = await this.listJwtSvids(
      typeof audience === 'string' ? [audience] : audience,
      filter,
    );

    const svid = svids.at(0);

    if (!svid) {
      throw new NoSvidError('JWT', filter);
    }

    return svid.token;
  }

  private async listJwtSvids(
    audience: readonly string[],
    filter?: SvidFilter,
  ): Promise<readonly JwtSvid[]> {
    let res;

    try {
      res = await this.api.fetchJWTSVID({
        audience: [...audience],
        spiffeId: filter?.spiffeId ?? '',
      });
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
      .filter((svid) => {
        // We can already filter by SPIFFE ID in the API request, so only hint-based needed here.
        if (filter?.hint !== undefined && svid.hint !== filter.hint) {
          return false;
        }

        return true;
      })
      .map(
        (s): JwtSvid => ({
          spiffeId: s.spiffeId,
          hint: s.hint || null, // '||' to collapse gRPC-empty string to null
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
      res = await this.api.validateJWTSVID({
        audience: expectedAudience,
        svid: token,
      });
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

  [Symbol.dispose](): void {
    this.close();
  }

  close(): void {
    this.abortController.abort();
    this.transport.close();
  }
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
