import { useEffect, useState } from "react";
import { builderAdminFetch } from "@/lib/builder-admin-fetch";
import { starcasterScopedHeaders } from "@/lib/adapters/starcaster-app";
import { sortPagesByName } from "../../public/shared/pageSort.js";
import { makePageLink, parsePageLink } from "@/lib/page-link";

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

/** The copied address an option stands for, in the configured kind. */
function pickerOptionAddress(option: BuilderPickerOption, valueKind: BuilderPickerValueKind): string {
  if (valueKind === "path") return option.path;
  if (valueKind === "slug") return option.slug;
  return option.id;
}

/**
 * Value a given option writes for the configured kind.
 *
 * A PAGE is stored by reference — its id, with today's address kept only as
 * a fallback (lib/builder-client/page-link.js, task 86bcxmrw2) — so renaming
 * the page or changing its address can never break the link. Posts and CRM
 * forms keep the value they always wrote.
 */
export function pickerOptionValue(
  option: BuilderPickerOption,
  valueKind: BuilderPickerValueKind,
  source: BuilderPickerSource = "pages"
): string {
  const address = pickerOptionAddress(option, valueKind);
  if (source === "pages" && valueKind !== "id" && option.id) return makePageLink(option.id, address);
  return address;
}

/**
 * Pure state resolution — exported for tests. Given the loaded options and
 * the stored value: "" selects the none row; a page reference selects its page
 * by id (whatever the page's address is now), or reports the page as missing;
 * an old copied address that matches an option selects it; anything else is
 * Custom mode.
 */
export function resolvePickerSelection(
  options: BuilderPickerOption[],
  value: string,
  valueKind: BuilderPickerValueKind,
  source: BuilderPickerSource = "pages"
): { mode: "none" | "option" | "custom" | "missing"; selected?: BuilderPickerOption; fallback?: string } {
  if (!value) return { mode: "none" };
  const reference = parsePageLink(value);
  if (reference) {
    const selected = options.find((option) => option.id === reference.pageId);
    return selected ? { mode: "option", selected } : { mode: "missing", fallback: reference.fallback };
  }
  const selected = options.find((option) => pickerOptionAddress(option, valueKind) === value);
  return selected ? { mode: "option", selected } : { mode: "custom" };
}

// One fetch per source per session — many pickers, zero duplicate requests.
const cache = new Map<BuilderPickerSource, Promise<BuilderPickerOption[]>>();

export function loadPickerOptions(source: BuilderPickerSource): Promise<BuilderPickerOption[]> {
  const existing = cache.get(source);
  if (existing) return existing;

  const promise = (async (): Promise<BuilderPickerOption[]> => {
    if (source === "pages") {
      const response = await builderAdminFetch("/api/admin/pages", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      const pages = Array.isArray(data?.pages) ? data.pages : [];
      // A-Z by the name the operator reads, before the mapping flattens name
      // and slug into one label — sorting after it would file an unnamed page
      // under "Untitled page" instead of sending it to the end.
      return sortPagesByName(pages).map((page: { id?: string; name?: string; slug?: string }) => {
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
const MISSING = "__missing__";

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
    loadPickerOptions(source)
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

  const selection = resolvePickerSelection(options, value, valueKind, source);
  const missing = !customPinned && selection.mode === "missing";
  const customMode = customPinned || selection.mode === "custom";
  // The <select> is keyed by what an option IS, never by the stored string:
  // an old copied address and a reference to the same page select one row.
  const optionKey = (option: BuilderPickerOption) => option.id || pickerOptionAddress(option, valueKind);

  return (
    <span className="builder-project-data-picker">
      <select
        aria-label={ariaLabel}
        value={
          missing ? MISSING
            : customMode ? CUSTOM
              : selection.mode === "none" ? ""
                : optionKey(selection.selected!)
        }
        onChange={(event) => {
          const next = event.target.value;
          if (next === MISSING) return;
          if (next === CUSTOM) {
            setCustomPinned(true);
            return;
          }
          setCustomPinned(false);
          if (!next) {
            onChange("");
            return;
          }
          const option = options.find((entry) => optionKey(entry) === next);
          if (option) onChange(pickerOptionValue(option, valueKind, source));
        }}
      >
        {noneLabel !== undefined ? <option value="">{noneLabel}</option> : null}
        {missing ? <option value={MISSING}>Missing page ({selection.fallback || "no saved address"})</option> : null}
        {options.map((option) => (
          <option key={optionKey(option)} value={optionKey(option)}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {missing ? (
        <span className="builder-project-data-picker-missing" role="note">
          The page this linked to no longer exists. Visitors are sent to its old address
          {selection.fallback ? ` (${selection.fallback})` : ""}; choose another page.
        </span>
      ) : null}
      {customMode ? (
        <input
          type="text"
          value={parsePageLink(value) ? "" : value}
          placeholder={placeholder}
          aria-label={ariaLabel ? `${ariaLabel} (custom value)` : "Custom value"}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </span>
  );
}
