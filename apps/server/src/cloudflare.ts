/**
 * The share server on Cloudflare Workers (wrangler.jsonc): each version's encrypted file in an R2
 * bucket, and the records of workspaces and uploads in a D1 database (migrations/), through the
 * same store as on Node (sql.ts). Only the parts of Workers' API it uses are declared, so it
 * needs no Cloudflare packages to build.
 */
import { DEFAULT_MAX_BYTES, DEFAULT_UPLOADS_PER_HOUR, handle } from "./handler.js";
import { SqlStore, type Bucket, type SqlDatabase } from "./sql.js";
import type { Client } from "./store.js";

export interface Env {
  /** The R2 bucket. */
  FILES: Bucket;
  /** The D1 database. */
  DB: SqlDatabase;
  MAX_BYTES?: string;
  UPLOADS_PER_HOUR?: string;
}

/** What Cloudflare tells a Worker about where a request came from. */
interface CfProperties {
  country?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
}

/** Who sent a request, from what Cloudflare adds to it. CF-Connecting-IP is set by Cloudflare, so a client can't choose it. */
export function cloudflareClient(request: Request): Client {
  const cf = ((request as { cf?: CfProperties }).cf ?? {}) as CfProperties;
  const header = (name: string) => request.headers.get(name);
  return {
    ip: header("CF-Connecting-IP"),
    country: cf.country ?? null,
    city: cf.city ?? null,
    asn: cf.asn ?? null,
    asOrganization: cf.asOrganization ?? null,
    userAgent: header("User-Agent"),
    origin: header("Origin"),
    referer: header("Referer"),
    ray: header("CF-Ray"),
  };
}

const numberVar = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      store: new SqlStore(env.FILES, env.DB),
      client: cloudflareClient(request),
      maxBytes: numberVar(env.MAX_BYTES, DEFAULT_MAX_BYTES),
      uploadsPerHour: numberVar(env.UPLOADS_PER_HOUR, DEFAULT_UPLOADS_PER_HOUR),
    });
  },
};
