import { useEffect, useState } from "react";
import { googleFontFamily, googleFontKey, isGoogleFontKey } from "@/lib/builder-google-fonts";
import { BUILDER_HEADING_FONTS } from "./builder-utils";

const GOOGLE_OPTION = "__google__";

/**
 * Font picker: the ten built-in fonts, plus "Google font…", which takes any
 * Google Fonts family by name and stores it as "gf:<Family>" (task 86bce9wwv).
 * A name that is not a valid family is refused with a message rather than
 * saved — the normalizer would blank it anyway, which reads as the font
 * "not taking".
 */
export function BuilderFontSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
}) {
  const isGoogle = isGoogleFontKey(value);
  const [editing, setEditing] = useState(isGoogle);
  const [name, setName] = useState(googleFontFamily(value));
  const [error, setError] = useState("");

  useEffect(() => {
    setName(googleFontFamily(value));
    if (isGoogleFontKey(value)) setEditing(true);
  }, [value]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Type the font's name as Google Fonts shows it, e.g. Open Sans.");
      return;
    }
    const key = googleFontKey(trimmed);
    if (!key) {
      setError(`"${trimmed}" is not a font name — use letters, numbers and spaces only, e.g. Open Sans.`);
      return;
    }
    setError("");
    if (key !== value) onChange(key);
  }

  return (
    <div className="builder-font-select">
      <select
        aria-label={ariaLabel}
        value={editing ? GOOGLE_OPTION : value}
        onChange={(event) => {
          const next = event.target.value;
          if (next === GOOGLE_OPTION) {
            setEditing(true);
            setError("");
            return;
          }
          setEditing(false);
          setError("");
          onChange(next);
        }}
      >
        {BUILDER_HEADING_FONTS.map((font) => (
          <option key={font.key} value={font.key}>
            {font.label}
          </option>
        ))}
        <option value={GOOGLE_OPTION}>{isGoogle ? `Google font: ${googleFontFamily(value)}` : "Google font…"}</option>
      </select>
      {editing ? (
        <input
          type="text"
          className="builder-font-select-google"
          aria-label={ariaLabel ? `${ariaLabel}: Google font name` : "Google font name"}
          placeholder="Google font name, e.g. Open Sans"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
      ) : null}
      {error ? <p className="builder-font-select-error" role="alert">{error}</p> : null}
    </div>
  );
}
