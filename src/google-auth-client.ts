import assert from 'assert';
import * as fs from 'fs/promises';
import {
  AuthClient,
  ExternalAccountSupplierContext,
  IdentityPoolClient,
  IdentityPoolClientOptions,
  SubjectTokenSupplier,
} from 'google-auth-library';
import { AuthClientOptions } from 'google-auth-library/build/src/auth/authclient';
import os from 'os';
import * as path from 'path';
import { SpiffeJwtClient } from './interface';

export class SpiffeJwtGoogleSubjectTokenSupplier
  implements SubjectTokenSupplier
{
  constructor(
    private readonly spiffe: SpiffeJwtClient,
    private readonly hint?: string,
  ) {}

  async getSubjectToken(
    context: ExternalAccountSupplierContext,
  ): Promise<string> {
    assert(
      context.subjectTokenType === 'urn:ietf:params:oauth:token-type:jwt',
      "SpiffeJwtGoogleSubjectTokenSupplier can only provide 'urn:ietf:params:oauth:token-type:jwt' subject tokens",
    );

    return await this.spiffe.getJwt(context.audience, this.hint);
  }
}

/**
 * Attempts to create a Google {@link AuthClient} from Application Default
 * Credentials (ADC) when the local ADC file is configured for external-account
 * authentication using JWT subject tokens and a SPIFFE credential source.
 *
 * If no ADC file is configured, or `.credential_source.spiffe` is not set in
 * the ADC, the function returns `undefined`. The value of `.credential_source.spiffe.hint`
 * is used as hint to the SPIFFE Client when retrieving the SVID.
 *
 * Throws if the discovered ADC file contains invalid JSON.
 *
 * @example
 *
 * ```json
 * {
 *   "type": "external_account",
 *   "audience": "//iam.googleapis.com/projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>",
 *   "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
 *   "credential_source": {
 *     "spiffe": {
 *       "hint": "external-gcp"
 *     }
 *   }
 * }
 * ```
 *
 * If the configured credential source is not `spiffe`, the function returns `undefined`, so that the
 * regular ADC flow can be used as a fallback.
 *
 * ```ts
 * import { BigQuery } from '@google-cloud/bigquery';
 * import { SpiffeClient } from '@jeengbe/spiffe';
 * import { maybeCreateAuthClientFromAdc } from '@jeengbe/spiffe/google-auth-client';
 *
 * const bigQuery = new BigQuery({
 *   authClient: await maybeCreateAuthClientFromAdc(() => new SpiffeClient()),
 * });
 * ```
 */
export async function maybeCreateAuthClientFromAdc(
  spiffe: SpiffeJwtClient | (() => SpiffeJwtClient),
  clientOptions?: AuthClientOptions,
): Promise<AuthClient | undefined> {
  const adcFileContent = await getAdcFileContent();
  if (!adcFileContent) return undefined;

  const adc = JSON.parse(adcFileContent);

  if (typeof adc !== 'object' || adc === null) return undefined;

  if (!('type' in adc) || adc.type !== 'external_account') return undefined;

  if (
    !('subject_token_type' in adc) ||
    adc.subject_token_type !== 'urn:ietf:params:oauth:token-type:jwt'
  ) {
    return undefined;
  }

  if (
    !('credential_source' in adc) ||
    typeof adc.credential_source !== 'object' ||
    adc.credential_source === null
  ) {
    return undefined;
  }

  if (
    !('spiffe' in adc.credential_source) ||
    typeof adc.credential_source.spiffe !== 'object' ||
    adc.credential_source.spiffe === null
  ) {
    return undefined;
  }

  const spiffeHint =
    'hint' in adc.credential_source.spiffe &&
    typeof adc.credential_source.spiffe.hint === 'string'
      ? adc.credential_source.spiffe.hint
      : undefined;

  delete adc.credential_source;
  if ('credentialSource' in adc) {
    delete adc.credentialSource;
  }

  return new IdentityPoolClient({
    ...adc,
    subjectTokenSupplier: new SpiffeJwtGoogleSubjectTokenSupplier(
      typeof spiffe === 'function' ? spiffe() : spiffe,
      spiffeHint,
    ),
    ...clientOptions,
  } as unknown as IdentityPoolClientOptions);
}

/**
 * Discovers and reads the contents of the Google Application Default Credentials file.
 *
 * Follows standard GCP resolution order:
 * 1. `GOOGLE_APPLICATION_CREDENTIALS` environment variable.
 * 2. Windows: `%APPDATA%/gcloud/application_default_credentials.json`
 * 3. Unix/Linux/macOS: `$HOME/.config/gcloud/application_default_credentials.json`
 */
async function getAdcFileContent(): Promise<string | null> {
  const credentialsPath =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Also fall back on empty string
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.google_application_credentials;

  if (credentialsPath) {
    try {
      return await fs.readFile(credentialsPath, 'utf-8');
    } catch {
      return null;
    }
  }

  let location: string | undefined;
  if (os.platform().startsWith('win')) {
    location = process.env.APPDATA;
  } else {
    const home = process.env.HOME;
    if (home) {
      location = path.join(home, '.config');
    }
  }

  if (location) {
    location = path.join(
      location,
      'gcloud',
      'application_default_credentials.json',
    );

    try {
      return await fs.readFile(location, 'utf-8');
    } catch {
      return null;
    }
  }

  return null;
}
