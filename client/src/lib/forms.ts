import type { CreateSource } from "../api/types";

export type LocalDraft = {
  type: "local";
  rootPath: string;
  label: string;
};

export type SftpDraft = {
  type: "sftp";
  host: string;
  port: string;
  username: string;
  remotePath: string;
  password: string;
  privateKey: string;
  label: string;
};

export type SourceDraft = LocalDraft | SftpDraft;

export type ValidationResult<T> = { ok: true; body: T } | { ok: false; message: string };

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function parseHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return trimmed;
}

export function toCreateSource(draft: SourceDraft): ValidationResult<CreateSource> {
  const label = draft.label.trim();
  const labelField = label ? { label } : {};

  if (draft.type === "local") {
    const rootPath = draft.rootPath.trim();
    if (!rootPath) return { ok: false, message: "Enter a local path." };
    if (!isAbsolutePath(rootPath)) {
      return { ok: false, message: "Enter an absolute path, such as /opt/comfyui_output." };
    }
    return { ok: true, body: { type: "local", rootPath, ...labelField } };
  }

  const host = draft.host.trim();
  const username = draft.username.trim();
  const remotePath = draft.remotePath.trim();
  const privateKey = draft.privateKey.trim();
  const password = draft.password;
  if (!host) return { ok: false, message: "Enter the SFTP host." };
  if (!username) return { ok: false, message: "Enter the SFTP username." };
  if (!remotePath) return { ok: false, message: "Enter the remote path." };
    if (!remotePath.startsWith("/")) {
      return { ok: false, message: "Remote path must be absolute, such as /srv/stills." };
    }
  if (!password && !privateKey) {
    return { ok: false, message: "Provide a password or a private key." };
  }

  let port: number | undefined;
  const portText = draft.port.trim();
  if (portText) {
    if (!/^\d+$/.test(portText)) {
      return { ok: false, message: "Port must be an integer from 1 to 65535." };
    }
    const parsed = Number(portText);
    if (parsed < 1 || parsed > 65535) {
      return { ok: false, message: "Port must be an integer from 1 to 65535." };
    }
    port = parsed;
  }

  return {
    ok: true,
    body: {
      type: "sftp",
      host,
      username,
      remotePath,
      ...(port != null ? { port } : {}),
      ...(password ? { password } : {}),
      ...(privateKey ? { privateKey } : {}),
      ...labelField,
    },
  };
}

export function toCreateServer(name: string, url: string): ValidationResult<{ name: string; url: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) return { ok: false, message: "Enter a name." };
  const parsed = parseHttpUrl(url);
  if (!parsed) return { ok: false, message: "Enter an http or https URL." };
  return { ok: true, body: { name: trimmedName, url: parsed } };
}
