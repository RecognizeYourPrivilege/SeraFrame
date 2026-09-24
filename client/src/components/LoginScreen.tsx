import { useState, type FormEvent } from "react";
import { formatApiError } from "../api/errors";
import { useAuth } from "../auth/AuthProvider";

const mocksOn = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== "false";

export function LoginScreen() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(formatApiError(err) || "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login" id="main">
      <div className="login-card">
        <p className="mark">
          <span className="mark-frame" aria-hidden="true" />
          SeraFrame
        </p>
        <h1>Sign in</h1>
        <p className="lede">Private stills and ComfyUI servers. One password, set on the host.</p>
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? (
            <p id="login-error" className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="btn primary wide" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {mocksOn ? (
          <p className="hint">
            Demo password <code>seraframe-demo</code>. Reload clears the mock session.
          </p>
        ) : null}
      </div>
    </main>
  );
}
