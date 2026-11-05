/**
 * Where the share server keeps shared workspaces: the encrypted files, one per version, and what
 * it knows about each workspace and each upload. The handler only talks to a ShareStore, so the
 * same server runs on Cloudflare (R2 and D1, cloudflare.ts) and on Node with everything in memory
 * (node.ts, and the tests).
 */

export interface WorkspaceRecord {
  id: string;
  /** SHA-256 of the token that lets its owner change it. The token itself is never stored. */
  tokenHash: string;
  /** The hash of its latest version. */
  latest: string;
  /** Milliseconds since the epoch. */
  created: number;
  updated: number;
  /** When its owner stopped sharing it. Its files are gone. */
  deleted: number | null;
  /** When it was taken down for abuse. Its files are kept, but no longer served. */
  blocked: number | null;
}

/** Who sent a request, as far as the server can tell: kept with every upload, to find abuse. */
export interface Client {
  ip: string | null;
  country: string | null;
  city: string | null;
  /** The network the request came from: its autonomous system's number and organization. */
  asn: number | null;
  asOrganization: string | null;
  userAgent: string | null;
  /** The page the request came from, as the browser said. */
  origin: string | null;
  referer: string | null;
  /** Cloudflare's ID for the request, to find it in Cloudflare's logs. */
  ray: string | null;
}

/** One file uploaded: a workspace's first version, or a new one. */
export interface Upload extends Client {
  workspace: string;
  hash: string;
  action: "create" | "update";
  /** Bytes. */
  size: number;
  at: number;
}

export interface ShareStore {
  workspace(id: string): Promise<WorkspaceRecord | null>;
  /** Stores a new workspace's first version. */
  create(record: WorkspaceRecord, file: Uint8Array, upload: Upload): Promise<void>;
  /** Stores a new version of a workspace, and makes it the latest. */
  update(id: string, file: Uint8Array, upload: Upload): Promise<void>;
  /** Deletes a workspace's files, and marks it deleted. What's known about its uploads is kept. */
  remove(id: string, at: number): Promise<void>;
  /** The file of one version, or null if there isn't one. */
  file(id: string, hash: string): Promise<Uint8Array | null>;
  /** How many files were uploaded from an IP address since a time, for the rate limit. */
  uploadsSince(ip: string, since: number): Promise<number>;
  /** Whether uploads from an IP address were blocked for abuse. */
  ipBlocked(ip: string): Promise<boolean>;
}

/** Keeps everything in memory, for the local server and the tests. */
export class MemoryStore implements ShareStore {
  readonly workspaces = new Map<string, WorkspaceRecord>();
  readonly files = new Map<string, Uint8Array>();
  readonly uploads: Upload[] = [];
  readonly blockedIps = new Set<string>();

  async workspace(id: string): Promise<WorkspaceRecord | null> {
    const record = this.workspaces.get(id);
    return record ? { ...record } : null;
  }

  async create(record: WorkspaceRecord, file: Uint8Array, upload: Upload): Promise<void> {
    this.files.set(`${record.id}/${upload.hash}`, file);
    this.workspaces.set(record.id, { ...record });
    this.uploads.push(upload);
  }

  async update(id: string, file: Uint8Array, upload: Upload): Promise<void> {
    this.files.set(`${id}/${upload.hash}`, file);
    const record = this.workspaces.get(id)!;
    this.workspaces.set(id, { ...record, latest: upload.hash, updated: upload.at });
    this.uploads.push(upload);
  }

  async remove(id: string, at: number): Promise<void> {
    for (const key of [...this.files.keys()]) if (key.startsWith(`${id}/`)) this.files.delete(key);
    const record = this.workspaces.get(id);
    if (record) this.workspaces.set(id, { ...record, deleted: at });
  }

  async file(id: string, hash: string): Promise<Uint8Array | null> {
    return this.files.get(`${id}/${hash}`) ?? null;
  }

  async uploadsSince(ip: string, since: number): Promise<number> {
    return this.uploads.filter((u) => u.ip === ip && u.at >= since).length;
  }

  async ipBlocked(ip: string): Promise<boolean> {
    return this.blockedIps.has(ip);
  }
}
