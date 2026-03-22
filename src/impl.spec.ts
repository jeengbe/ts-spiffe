import {
  ChannelCredentials,
  Server,
  ServerCredentials,
  status,
  UntypedHandleCall,
} from '@grpc/grpc-js';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import * as fs from 'fs/promises';
import { NoSvidError } from './error';
import { SpiffeClientImpl } from './impl';
import { Struct } from './proto/google/protobuf/struct';
import {
  ISpiffeWorkloadAPI,
  spiffeWorkloadAPIDefinition,
} from './proto/workloadapi.grpc-server';

describe('SpiffeClientImpl', () => {
  let socketUri: string;
  let fakeService: FakeSpiffeWorkloadAPI;
  let server: Server;
  let client: SpiffeClientImpl;

  beforeAll(async () => {
    socketUri = `unix://${await fs.mkdtemp('/tmp/spiffe-client-test-')}/socket.sock`;

    server = new Server();

    await new Promise<void>((resolve, reject) => {
      server.bindAsync(socketUri, ServerCredentials.createInsecure(), (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.tryShutdown((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

  beforeEach(async () => {
    fakeService = new FakeSpiffeWorkloadAPI();
    server.addService(spiffeWorkloadAPIDefinition, fakeService);

    client = new SpiffeClientImpl({
      host: socketUri,
      channelCredentials: ChannelCredentials.createInsecure(),
      clientOptions: {
        'grpc-node.retry_max_attempts_limit': 0,
      },
    });
  });

  afterEach(() => {
    server.removeService(spiffeWorkloadAPIDefinition);
  });

  describe('SpiffeJwtClient', () => {
    describe('getJwt', () => {
      it('should return JWT for the specified audience', async () => {
        fakeService.fetchJWTSVID.mockImplementationOnce((_, callback) => {
          callback(null, {
            svids: [
              {
                spiffeId: 'spiffe://example.org/test',
                svid: 'fake-svid',
                hint: '',
              },
            ],
          });
        });

        expect(await client.getJwt('test-audience')).toBe('fake-svid');
      });

      it('should request multiple audiences', async () => {
        fakeService.fetchJWTSVID.mockImplementationOnce((_, callback) => {
          callback(null, {
            svids: [
              {
                spiffeId: 'spiffe://example.org/test',
                svid: 'fake-svid',
                hint: '',
              },
            ],
          });
        });

        expect(await client.getJwt('test-audience')).toBe('fake-svid');
      });

      it('should throw NoSvidError if no SVIDs are returned', async () => {
        fakeService.fetchJWTSVID.mockImplementationOnce((_, callback) => {
          callback(null, { svids: [] });
        });

        await expect(client.getJwt('test-audience')).rejects.toThrow(
          NoSvidError,
        );
      });

      it('should throw NoSvidError if call fails with INVALID_ARGUMENT', async () => {
        fakeService.fetchJWTSVID.mockImplementationOnce((_, callback) => {
          callback(
            {
              code: status.INVALID_ARGUMENT,
            },
            null,
          );
        });

        await expect(client.getJwt('test-audience')).rejects.toThrow(
          NoSvidError,
        );
      });

      it('should throw NoSvidError if call fails with PERMISSION_DENIED', async () => {
        fakeService.fetchJWTSVID.mockImplementationOnce((_, callback) => {
          callback(
            {
              code: status.PERMISSION_DENIED,
            },
            null,
          );
        });

        await expect(client.getJwt('test-audience')).rejects.toThrow(
          NoSvidError,
        );
      });
    });

    describe('validateJwt', () => {
      it('should return a decoded valid SVID', async () => {
        fakeService.validateJWTSVID.mockImplementationOnce((_, callback) => {
          callback(null, {
            spiffeId: 'fake-spiffe-id',
            claims: Struct.fromJson({
              sub: 'fake',
              aud: ['fake'],
              exp: 1234,
            }),
          });
        });

        expect(await client.validateJwt('test-audience', 'test-token')).toEqual(
          {
            spiffeId: 'fake-spiffe-id',
            claims: {
              sub: 'fake',
              aud: ['fake'],
              exp: 1234,
            },
          },
        );
      });

      it('should return null if the API returns INVALID_ARGUMENT', async () => {
        fakeService.validateJWTSVID.mockImplementationOnce((_, callback) => {
          callback(
            {
              code: status.INVALID_ARGUMENT,
            },
            null,
          );
        });

        expect(await client.validateJwt('test-audience', 'test-token')).toBe(
          null,
        );
      });
    });
  });
});

class FakeSpiffeWorkloadAPI implements ISpiffeWorkloadAPI {
  fetchX509SVID = jest.fn<
    ReturnType<ISpiffeWorkloadAPI['fetchX509SVID']>,
    Parameters<ISpiffeWorkloadAPI['fetchX509SVID']>
  >((call) => call.destroy(new RpcError('Not implemented', 'UNIMPLEMENTED')));

  fetchX509Bundles = jest.fn<
    ReturnType<ISpiffeWorkloadAPI['fetchX509Bundles']>,
    Parameters<ISpiffeWorkloadAPI['fetchX509Bundles']>
  >((call) => call.destroy(new RpcError('Not implemented', 'UNIMPLEMENTED')));

  fetchJWTSVID = jest.fn<
    ReturnType<ISpiffeWorkloadAPI['fetchJWTSVID']>,
    Parameters<ISpiffeWorkloadAPI['fetchJWTSVID']>
  >((_, callback) => {
    callback(
      {
        code: status.UNIMPLEMENTED,
      },
      null,
    );
  });

  fetchJWTBundles = jest.fn<
    ReturnType<ISpiffeWorkloadAPI['fetchJWTBundles']>,
    Parameters<ISpiffeWorkloadAPI['fetchJWTBundles']>
  >((call) => call.destroy(new RpcError('Not implemented', 'UNIMPLEMENTED')));

  validateJWTSVID = jest.fn<
    ReturnType<ISpiffeWorkloadAPI['validateJWTSVID']>,
    Parameters<ISpiffeWorkloadAPI['validateJWTSVID']>
  >((_, callback) => {
    callback(
      {
        code: status.UNIMPLEMENTED,
      },
      null,
    );
  });

  // Weird type, hmm...
  [name: string]: UntypedHandleCall;
}
