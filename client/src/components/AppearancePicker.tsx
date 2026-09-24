import { useEffect, useState } from "react";
import { formatApiError } from "../api/errors";
import { usePrefs, type ThemeName } from "../lib/prefs";
import { useServerPrefs } from "../lib/serverPrefs";

const LOOKS: { theme: ThemeName; title: string; note: string }[] = [
  { theme: "light", title: "Light", note: "Photos" },
  { theme: "dark", title: "Dark", note: "Neon" },
];

/** One-time screen after login when the server says first-run is unfinished. */
export function AppearancePicker() {
  const { update } = usePrefs();
  const { finishFirstRun } = useServerPrefs();
  const [choice, setChoice] = useState<ThemeName | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Appearance — SeraFrame";
  }, []);

  function choose(theme: ThemeName) {
    setChoice(theme);
    setError(null);
    update({ theme });
  }

  async function finish() {
    if (!choice || pending) return;
    setPending(true);
    setError(null);
    try {
      await finishFirstRun(choice);
    } catch (err) {
      setError(formatApiError(err) || "Could not save appearance.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="appearance-gate" id="main">
      <div className="appearance-card">
        <h1>Appearance</h1>
        <p className="lede">Choose a look for the gallery. You can change it later in settings.</p>
        <div className="look-choices" role="radiogroup" aria-label="Appearance">
          {LOOKS.map((look) => {
            const selected = choice === look.theme;
            return (
              <button
                key={look.theme}
                type="button"
                role="radio"
                className={selected ? "look-card is-selected" : "look-card"}
                aria-checked={selected}
                disabled={pending}
                onClick={() => choose(look.theme)}
              >
                <span className={look.theme === "light" ? "look-swatch is-photos" : "look-swatch is-neon"} aria-hidden="true" />
                <span className="look-title">{look.title}</span>
                <span className="look-note">{look.note}</span>
              </button>
            );
          })}
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="btn primary wide" onClick={() => void finish()} disabled={!choice || pending}>
          {pending ? "Saving…" : "Continue"}
        </button>
      </div>
    </main>
  );
}
