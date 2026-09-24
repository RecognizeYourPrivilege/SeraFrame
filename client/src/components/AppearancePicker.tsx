import { useEffect, useState } from "react";
import { usePrefs, type ThemeName } from "../lib/prefs";

const LOOKS: { theme: ThemeName; title: string; note: string }[] = [
  { theme: "light", title: "Light", note: "Photos" },
  { theme: "dark", title: "Dark", note: "Neon" },
];

/** One-time screen after the first password. Later changes stay in the profile menu. */
export function AppearancePicker() {
  const { update } = usePrefs();
  const [choice, setChoice] = useState<ThemeName | null>(null);

  useEffect(() => {
    document.title = "Appearance — SeraFrame";
  }, []);

  function choose(theme: ThemeName) {
    setChoice(theme);
    update({ theme });
  }

  function finish() {
    if (!choice) return;
    update({ theme: choice, firstRunAppearanceDone: true });
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
                onClick={() => choose(look.theme)}
              >
                <span className={look.theme === "light" ? "look-swatch is-photos" : "look-swatch is-neon"} aria-hidden="true" />
                <span className="look-title">{look.title}</span>
                <span className="look-note">{look.note}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn primary wide" onClick={finish} disabled={!choice}>
          Continue
        </button>
      </div>
    </main>
  );
}
