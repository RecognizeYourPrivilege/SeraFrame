import { useState, type FormEvent } from "react";
import { formatApiError } from "../api/errors";
import { toCreateServer } from "../lib/forms";
import { Dialog } from "./Dialog";

type AddServerDialogProps = {
  onClose: () => void;
  onCreate: (body: { name: string; url: string }) => Promise<void>;
};

export function AddServerDialog({ onClose, onCreate }: AddServerDialogProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = toCreateServer(name, url);
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
      setError(formatApiError(err) || "Could not add the server.");
      setPending(false);
    }
  }

  return (
    <Dialog
      title="Add server"
      description="A server is a ComfyUI URL. It opens in a sandboxed frame on this page. If the site refuses to be embedded, use Open externally. Nothing is proxied."
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="server-name">Name</label>
          <input
            id="server-name"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="server-url">URL</label>
          <input
            id="server-url"
            type="url"
            inputMode="url"
            required
            placeholder="http://127.0.0.1:8188"
            spellCheck={false}
            autoCapitalize="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
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
            {pending ? "Adding…" : "Add server"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
