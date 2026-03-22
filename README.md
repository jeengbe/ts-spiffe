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

The client connects to the Workload API over gRPC. If no host parameter is provided, the client will attempt to connect to `process.env.SPIFFE_ENDPOINT_SOCKET`, or fall back to `unix:///tmp/spire-agent/public/api.sock` if that also isn't available.

```ts
const spiffe = new SpiffeClientImpl();
```

### JWT-SVIDs

To work with JWT-SVIDs, the client implements the `SpiffeJwtClient` interface.

Use `getJwt()` in client applications to fetch a JSON Web Token for the specified audience. The token is cached in the client instance and automatically rotated once it is close to expiring.

```ts
declare const spiffe: SpiffeJwtClient;

async function fetchData(url) {
  const token = await spiffe.getJwt('orders-api');

  return await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
}
```

On the server, use `validateJwt()` to validate an incoming JWT-SVID bearer token.

```ts
declare const spiffe: SpiffeJwtClient;

async function authenticateRequest(req) {
  const token = extractBearer(req.headers['Authorization']);

  return spiffe.validateJwt('orders-api', token);
}
```

### X509-SVIDs

The Node.js ecosystem is not ready for short-lived rotating X.509 client certificates yet.

TODO: Contribute upstream (https://github.com/nodejs/TSC/issues/1843)
