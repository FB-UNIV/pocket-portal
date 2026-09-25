import { readPocketIdOidc } from "@/lib/config";

// PocketID OIDC client config for portal login (ADR-0004).
// Reference: https://pocket-id.org/docs/api — verified live against a real
// instance: discovery at /.well-known/openid-configuration, PKCE (S256) and
// a "groups" claim/scope are both supported.

export interface PocketIdOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
}

export function getPocketIdOidcConfig(): PocketIdOidcConfig {
  return readPocketIdOidc();
}
