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
  return () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __name: 'kafkajs-spiffe-auth-middleware',
    async prepareRequest(next) {
      const req = await next();

      return req.enhance({
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          Authorization: `Bearer ${await (typeof spiffe === 'function' ? spiffe() : spiffe).getJwt(audience, hint)}`,
        },
      });
    },
  });
}
