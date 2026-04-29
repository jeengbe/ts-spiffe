import { OauthbearerProviderResponse, SASLOptions } from 'kafkajs';
import { Middleware } from 'mappersmith';
import { SpiffeClient } from './impl';
import { SpiffeJwtClient } from './interface';

/**
 * Creates a Mappersmith middleware that adds an Authorization header with
 * a JWT-SVID bearer credential.
 */
export function createKafkajsAuthMiddleware(
  audience: string,
  hint?: string,
  spiffe: SpiffeJwtClient | (() => SpiffeJwtClient) = () => new SpiffeClient(),
): Middleware {
  const spiffeClient = typeof spiffe === 'function' ? spiffe() : spiffe;

  return () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __name: 'kafkajs-spiffe-auth-middleware',
    async prepareRequest(next) {
      const req = await next();

      return req.enhance({
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Bearer ${await spiffeClient.getJwt(audience, hint)}`,
        },
      });
    },
  });
}

export function createKafkajsSaslMechanism(
  audience: string,
  extensions?: Record<string, string>,
  hint?: string,
  spiffe: SpiffeJwtClient | (() => SpiffeJwtClient) = () => new SpiffeClient(),
): SASLOptions {
  const spiffeClient = typeof spiffe === 'function' ? spiffe() : spiffe;

  return {
    mechanism: 'oauthbearer',
    async oauthBearerProvider(): Promise<OauthbearerProviderResponse> {
      return {
        value: await spiffeClient.getJwt(audience, hint),
        // @ts-expect-error -- Untyped SASL extensions type
        extensions,
      };
    },
  };
}
