import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { CreateSource } from "../api/types";
import { toCreateSource, type SourceDraft } from "../lib/forms";
import { Dialog } from "./Dialog";

const explanation =
  "A source is a directory of stills. A local source reads a path on the SeraFrame host, such as a ComfyUI output folder. An SFTP source reads a directory on another machine. A password or private key is sent once and is not shown again.";

type AddSourceDialogProps = {
  onClose: () => void;
  onCreate: (body: CreateSource) => Promise<void>;
};

export function AddSourceDialog({ onClose, onCreate }: AddSourceDialogProps) {
  const [draft, setDraft] = useState<SourceDraft>({ type: "local", rootPath: "", label: "" });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api
      .sourceSuggestions({ signal: controller.signal })
      .then((res) => setSuggestions(res.paths))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setSuggestError(formatApiError(err) || "Suggestions are unavailable.");
      });
    return () => controller.abort();
  }, []);

  function patch(partial: object) {
    setDraft((current) => ({ ...current, ...partial }) as SourceDraft);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = toCreateSource(draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate(parsed.body);
      onClose();
    } catch (err) {
      setError(formatApiError(err) || "Could not add the source.");
      setPending(false);
    }
  }

  return (
    <Dialog title="Add source" description={explanation} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <fieldset className="choice">
          <legend>Source type</legend>
          <label>
            <input
              type="radio"
              name="source-type"
              checked={draft.type === "local"}
              onChange={() => setDraft({ type: "local", rootPath: "", label: draft.label })}
            />
            Local path
          </label>
          <label>
            <input
              type="radio"
              name="source-type"
              checked={draft.type === "sftp"}
              onChange={() =>
                setDraft({
                  type: "sftp",
                  host: "",
                  port: "",
                  username: "",
                  remotePath: "",
                  password: "",
                  privateKey: "",
                  label: draft.label,
                })
              }
            />
            SFTP
          </label>
        </fieldset>

        <div className="suggestions">
          <h3>Suggested local paths</h3>
          <p>Host directories matching /opt/comfyui_*. Choosing one fills the local path. It is not added until you save.</p>
          {suggestError ? <p role="alert">{suggestError}</p> : null}
          {suggestions.length === 0 && !suggestError ? <p>No matching directories were reported.</p> : null}
          {suggestions.length > 0 ? (
            <ul>
              {suggestions.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => setDraft({ type: "local", rootPath: path, label: draft.label })}
                  >
                    <span className="visually-hidden">Use suggested path </span>
                    <span translate="no">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {draft.type === "local" ? (
          <div className="field">
            <label htmlFor="root-path">Local path</label>
            <input
              id="root-path"
              value={draft.rootPath}
              required
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="/opt/comfyui_output"
              translate="no"
              onChange={(event) => patch({ rootPath: event.target.value })}
            />
          </div>
        ) : (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="sftp-host">Host</label>
                <input
                  id="sftp-host"
                  value={draft.host}
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => patch({ host: event.target.value })}
                />
              </div>
              <div className="field port">
                <label htmlFor="sftp-port">Port</label>
                <input
                  id="sftp-port"
                  inputMode="numeric"
                  value={draft.port}
                  placeholder="22"
                  onChange={(event) => patch({ port: event.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="sftp-user">Username</label>
              <input
                id="sftp-user"
                value={draft.username}
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="sftp-path">Remote path</label>
              <input
                id="sftp-path"
                value={draft.remotePath}
                required
                spellCheck={false}
                autoCapitalize="off"
                translate="no"
                placeholder="/srv/stills"
                onChange={(event) => patch({ remotePath: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="sftp-password">Password</label>
              <input
                id="sftp-password"
                type="password"
                autoComplete="off"
                value={draft.password}
                onChange={(event) => patch({ password: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="sftp-key">Private key</label>
              <textarea
                id="sftp-key"
                rows={4}
                spellCheck={false}
                autoComplete="off"
                value={draft.privateKey}
                onChange={(event) => patch({ privateKey: event.target.value })}
              />
              <p className="field-hint">Provide a password, a private key, or both.</p>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="source-label">Label (optional)</label>
          <input
            id="source-label"
            value={draft.label}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Adding…" : "Add source"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
