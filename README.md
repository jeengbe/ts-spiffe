<h1 align="center">@jeengbe/spiffe</h1>
<div align="center">

A TypeScript library for working with SPIFFE workload identities.

[![License](https://img.shields.io/npm/l/@jeengbe/spiffe)](https://github.com/jeengbe/spiffe/blob/LICENSE.md)
[![Version](https://img.shields.io/npm/v/@jeengbe/spiffe)](https://www.npmjs.com/package/@jeengbe/spiffe)
![Coverage Badge](https://img.shields.io/badge/Coverage-100%25-brightgreen)

</div>

This package provides convenient helpers for integrating SPIFFE workload identities into TypeScript applications. Instead of dealing with Workload API protocol details, you can enjoy ready-to-use credentials and trust bundles.

## Installation

The package is published as `@jeengbe/spiffe`. Versions follow Semantic Versioning.

## Usage

The client connects to the Workload API over gRPC. If no socket is provided, the client will attempt to connect to `process.env.SPIFFE_ENDPOINT_SOCKET`, or fall back to `unix:///tmp/spire-agent/public/api.sock`.

```ts
const spiffe = new SpiffeClient();
```

To specify a socket explicitly:

```ts
const spiffe = new SpiffeClient('unix:///path/to/api.sock');
```

For advanced gRPC configuration, pass a `GrpcOptions` object instead:

```ts
const spiffe = new SpiffeClient({
  host: 'unix:///path/to/api.sock',
  channelCredentials: ChannelCredentials.createInsecure(),
  meta: { 'workload.spiffe.io': 'true' },
});
```

`SpiffeClient` implements `AsyncDisposable`, so you can use `await using`:

```ts
await using spiffe = new SpiffeClient();
```

### JWT-SVIDs

`SpiffeClient` implements the `SpiffeJwtClient` interface.

Use `getJwt()` in client applications to fetch a JSON Web Token for the specified audience:

```ts
declare const spiffe: SpiffeJwtClient;

async function fetchData(url: string) {
  const token = await spiffe.getJwt('orders-api');

  return fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
}
```

Use `getJwtSvid()` instead to also get the SPIFFE ID and expiration time:

```ts
const svid = await spiffe.getJwtSvid('orders-api');
console.log(svid.spiffeId, svid.token, svid.expiresAtMs);
```

On the server, use `validateJwt()` to validate an incoming JWT-SVID bearer token. Returns `null` if the token is invalid.

```ts
declare const spiffe: SpiffeJwtClient;

async function authenticateRequest(req: Request) {
  const token = extractBearer(req.headers['Authorization']);

  const svid = await spiffe.validateJwt('orders-api', token);
  if (!svid) {
    throw new Error('Unauthorized');
  }

  return svid; // { spiffeId, claims }
}
```

Both `getJwt()` and `getJwtSvid()` accept an optional `hint` parameter to select a specific SVID when the agent issues more than one:

```ts
const token = await spiffe.getJwt('orders-api', 'my-service');
```

SVIDs are cached for half of their remaining TTL and concurrent requests for the same audience are deduplicated.

### Writing JWTs to Disk

`SpiffeHelper` manages JWT-SVIDs on disk with automatic refresh, useful for applications that read credentials from a file path (e.g. some gRPC implementations):

```ts
const helper = new SpiffeHelper(spiffe);
const handle = await helper.ensureJwtOnDisk('/tmp/svid.jwt', 'orders-api');

console.log(handle.path);      // '/tmp/svid.jwt'
console.log(handle.spiffeId);  // current SPIFFE ID

// The file is refreshed automatically at 50% of its TTL.
// Clean up when done:
await handle.close();
```

Files are written with `0600` permissions. Both `SpiffeHelper` and `JwtSvidDiskHandle` implement `AsyncDisposable`.

### Error handling

`getJwt()` and `getJwtSvid()` throw `NoSvidError` when the Workload API returns no SVIDs:

```ts
import { NoSvidError } from '@jeengbe/spiffe';

try {
  const token = await spiffe.getJwt('orders-api');
} catch (err) {
  if (err instanceof NoSvidError) {
    // No identity
  }
}
```

`validateJwt()` returns `null` for invalid tokens rather than throwing.

## Google Cloud Integration

The `@jeengbe/spiffe/google-auth-client` entry point integrates SPIFFE with Google Cloud's [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation).

`maybeCreateAuthClientFromAdc()` reads your Application Default Credentials and checks whether they contain a `credential_source.spiffe` field. This client introduces a **non-standard extension** to signal that a SPIFFE SVID should be used as the subject token. If that field is present, it returns a configured `IdentityPoolClient` that fetches tokens via SPIFFE; otherwise it returns `undefined`, so you can fall back to the standard ADC flow.

```ts
import { maybeCreateAuthClientFromAdc } from '@jeengbe/spiffe/google-auth-client';
import { BigQuery } from '@google-cloud/bigquery';

const authClient = await maybeCreateAuthClientFromAdc();
const bigQuery = new BigQuery({ authClient });
```

To use this, create an ADC file in the standard `external_account` format and add a `credential_source.spiffe` block. The `credential_source.spiffe` field is **not part of the official ADC spec**. It is interpreted by this library and ignored by other tooling.

```json
{
  "type": "external_account",
  "audience": "//iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
  "credential_source": {
    "spiffe": {
      "hint": "external-gcp"
    }
  }
}
```

The `hint` field is optional and selects which SVID to use when the agent issues more than one. Only the `urn:ietf:params:oauth:token-type:jwt` subject token type is supported.

ADC is discovered from `GOOGLE_APPLICATION_CREDENTIALS` (or `google_application_credentials`) or the standard gcloud paths (`~/.config/gcloud/application_default_credentials.json`).

## KafkaJS Integration

The `@jeengbe/spiffe/kafkajs` entry point provides helpers for authenticating KafkaJS clients and related services using SPIFFE JWT-SVIDs.

### SASL Authentication

Use `createKafkajsSaslMechanism()` to create a KafkaJS-compatible SASL `OAuthBearer` configuration. Pass it directly to the `sasl` option when constructing a `Kafka` instance:

```ts
import { createKafkajsSaslMechanism } from '@jeengbe/spiffe/kafkajs';
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  brokers: config.kafka.brokers,
  sasl: createKafkajsSaslMechanism('kafka-cluster'),
});
```

To pass SASL extensions (e.g. for Confluent Cloud logical cluster routing):

```ts
sasl: createKafkajsSaslMechanism('kafka-cluster', {
  logicalCluster: 'lkc-abc123',
  identityPoolId: 'pool-xyz',
}),
```

### Schema Registry Middleware

Use `createKafkajsAuthMiddleware()` to create a [Mappersmith](https://github.com/tulios/mappersmith) middleware that attaches a SPIFFE JWT-SVID as a bearer token on outgoing requests. This is useful for authenticating against services like the Confluent Schema Registry:

```ts
import { createKafkajsAuthMiddleware } from '@jeengbe/spiffe/kafkajs';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';

const schemaRegistry = new SchemaRegistry({
  host: config.kafka.schemaRegistry.url,
  clientId: config.kafka.schemaRegistry.clientId,
  middlewares: [createKafkajsAuthMiddleware('confluent-cloud')],
});
```
