import { useEffect, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";

/**
 * The shared "pick it from a list" control — master rules C1/C2
 * (docs/UI_RULES.md; audit fix F6). The operator's 6/30 directive: "it
 * should be a matter of selecting the destination from a dropdown list,
 * which will automatically format the URL."
 *
 * One control, three sources (project pages, blog posts, CRM forms). It
 * fetches the project's real data, offers it as options, writes the
 * derived value (path, slug, or id), and keeps a "Custom…" escape hatch
 * (C1's "Other"). If the fetch fails, it degrades to a plain text input —
 * a broken list must never block editing. A stored value that matches no
 * option renders in Custom mode, so nothing saved ever breaks.
 */

export type BuilderPickerSource = "pages" | "posts" | "crm-forms";
export type BuilderPickerValueKind = "path" | "slug" | "id";

export type BuilderPickerOption = { label: string; path: string; slug: string; id: string };

/** Value a given option writes for the configured kind. */
export function pickerOptionValue(option: BuilderPickerOption, valueKind: BuilderPickerValueKind): string {
  if (valueKind === "path") return option.path;
  if (valueKind === "slug") return option.slug;
  return option.id;
}

/**
 * Pure state resolution — exported for tests. Given the loaded options and
 * the stored value: "" selects the none row; a value matching an option
 * selects it; anything else is Custom mode.
 */
export function resolvePickerSelection(
  options: BuilderPickerOption[],
  value: string,
  valueKind: BuilderPickerValueKind
): { mode: "none" | "option" | "custom"; selected?: BuilderPickerOption } {
  if (!value) return { mode: "none" };
  const selected = options.find((option) => pickerOptionValue(option, valueKind) === value);
  return selected ? { mode: "option", selected } : { mode: "custom" };
}

// One fetch per source per session — many pickers, zero duplicate requests.
const cache = new Map<BuilderPickerSource, Promise<BuilderPickerOption[]>>();

function loadOptions(source: BuilderPickerSource): Promise<BuilderPickerOption[]> {
  const existing = cache.get(source);
  if (existing) return existing;

  const promise = (async (): Promise<BuilderPickerOption[]> => {
    if (source === "pages") {
      const response = await builderAdminFetch("/api/admin/pages", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      const pages = Array.isArray(data?.pages) ? data.pages : [];
      return pages.map((page: { id?: string; name?: string; slug?: string }) => {
        const slug = String(page.slug ?? "").replace(/^\/+/, "");
        return {
          id: String(page.id ?? ""),
          label: String(page.name || slug || page.id || "Untitled page"),
          slug,
          path: `/${slug}`
        };
      });
    }
    if (source === "posts") {
      const response = await fetch("/api/blog/posts?status=published&limit=100", {
        credentials: "include",
        headers: starcasterScopedHeaders()
      });
      const data = await response.json().catch(() => null);
      const posts = Array.isArray(data?.posts) ? data.posts : [];
      return posts.map((post: { id?: string; title?: string; slug?: string }) => {
        const slug = String(post.slug ?? "");
        return {
          id: String(post.id ?? ""),
          label: String(post.title || slug || "Untitled post"),
          slug,
          path: `/${slug}`
        };
      });
    }
    const response = await fetch("/api/crm/forms", {
      credentials: "include",
      headers: starcasterScopedHeaders()
    });
    const data = await response.json().catch(() => null);
    const forms = Array.isArray(data?.forms) ? data.forms : Array.isArray(data?.data) ? data.data : [];
    return forms.map((form: { id?: string; name?: string }) => ({
      id: String(form.id ?? ""),
      label: String(form.name || form.id || "Untitled form"),
      slug: String(form.id ?? ""),
      path: String(form.id ?? "")
    }));
  })();

  // A failed fetch must not poison the session cache.
  cache.set(source, promise);
  promise.catch(() => cache.delete(source));
  return promise;
}

const CUSTOM = "__custom__";

type BuilderProjectDataPickerProps = {
  source: BuilderPickerSource;
  /** What gets stored: the page path ("/about"), the bare slug, or the record id. */
  valueKind: BuilderPickerValueKind;
  value: string;
  onChange: (value: string) => void;
  /** Label for the empty-value option (e.g. "Current page", "Default"). Omit to require a choice. */
  noneLabel?: string;
  /** Placeholder for the Custom text input. */
  placeholder?: string;
  ariaLabel?: string;
};

export function BuilderProjectDataPicker({
  source,
  valueKind,
  value,
  onChange,
  noneLabel,
  placeholder,
  ariaLabel
}: BuilderProjectDataPickerProps) {
  const [options, setOptions] = useState<BuilderPickerOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Sticky: once the operator picks Custom…, stay in custom mode even
  // while the input momentarily matches an option or goes empty.
  const [customPinned, setCustomPinned] = useState(false);

  useEffect(() => {
    let alive = true;
    loadOptions(source)
      .then((loaded) => {
        if (alive) setOptions(loaded);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [source]);

  // Fetch failed → degrade to the plain input the picker replaced.
  if (failed) {
    return (
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (options === null) {
    return (
      <select disabled aria-label={ariaLabel}>
        <option>Loading…</option>
      </select>
    );
  }

  const selection = resolvePickerSelection(options, value, valueKind);
  const customMode = customPinned || selection.mode === "custom";

  return (
    <span className="builder-project-data-picker">
      <select
        aria-label={ariaLabel}
        value={customMode ? CUSTOM : selection.mode === "none" ? "" : pickerOptionValue(selection.selected!, valueKind)}
        onChange={(event) => {
          if (event.target.value === CUSTOM) {
            setCustomPinned(true);
            return;
          }
          setCustomPinned(false);
          onChange(event.target.value);
        }}
      >
        {noneLabel !== undefined ? <option value="">{noneLabel}</option> : null}
        {options.map((option) => (
          <option key={option.id || pickerOptionValue(option, valueKind)} value={pickerOptionValue(option, valueKind)}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {customMode ? (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel ? `${ariaLabel} (custom value)` : "Custom value"}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </span>
  );
}
