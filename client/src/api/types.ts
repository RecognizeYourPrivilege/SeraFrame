/** Integration contract v1. Field names match the wire format. */

export type Source = {
  id: string;
  type: "local" | "sftp";
  label: string;
  rootPath?: string;
  host?: string;
  port?: number;
  username?: string;
  remotePath?: string;
  hasPrivateKey?: boolean;
  hasPassword?: boolean;
};

export type CreateSource =
  | { type: "local"; rootPath: string; label?: string }
  | {
      type: "sftp";
      host: string;
      port?: number;
      username: string;
      remotePath: string;
      password?: string;
      privateKey?: string;
      label?: string;
    };

export type TreeEntry =
  | { kind: "dir"; name: string; relPath: string; stillCount?: number }
  | { kind: "still"; name: string; relPath: string };

export type Still = {
  sourceId: string;
  relPath: string;
  name: string;
  thumbUrl: string;
  fullUrl: string;
};

export type Server = {
  id: string;
  name: string;
  url: string;
};

export type Ok = { ok: true };

export type CsrfResponse = { csrfToken: string };

export type MeResponse = { authenticated: true };
