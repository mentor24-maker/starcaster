"use client";

import type { BuilderTemplateModule } from "@/lib/builder-template";
import type { RichTextGalleryBinding } from "@/components/builder/builder-types";
import { BuilderRichTextEditor } from "@/components/builder-rich-text-editor";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderModuleChromeSlot } from "./builder-module-chrome-slot";
import { BuilderModuleField, BuilderModuleFieldStrip } from "./builder-module-field";
import { useState } from "react";

type Props = {
  module: BuilderTemplateModule;
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
  richTextGallery?: RichTextGalleryBinding;
};

type Section = "content" | "meta" | "taxonomy" | "seo" | "display";

const SECTION_LABELS: Record<Section, string> = {
  content:  "Content",
  meta:     "Meta",
  taxonomy: "Categories & Tags",
  seo:      "SEO",
  display:  "Display",
};

/*
 * A1 sort (2026-08-10): reviewed and unchanged. This editor is the post's
 * DATA — body, meta, taxonomy, SEO, and which of those fields the post view
 * shows. It carries no colour, border, radius, shadow or font control, so
 * there is nothing that overrides the theme and nothing to collapse into an
 * Advanced section. (The hex values below are the panel's own chrome — the
 * status badge and the section tabs — not module settings.) Still a
 * hand-rolled tabbed panel rather than a D8 axes schema; that conversion is
 * separate work.
 */
export function BuilderBlogPostModuleSettings({ module, onUpdateModule, richTextGallery }: Props) {
  const s = module.settings;
  const [section, setSection] = useState<Section>("content");

  function set(key: string, value: string) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value }
    }));
  }

  function setBody(value: string) {
    onUpdateModule((current) => ({ ...current, settings: { ...current.settings, body: value } }));
  }

  function showHideField(key: string, label: string, fallback: string) {
    return (
      <BuilderModuleField label={label} width="check">
        <input
          type="checkbox"
          checked={(s[key] ?? fallback) === "true"}
          onChange={(e) => set(key, e.target.checked ? "true" : "false")}
        />
      </BuilderModuleField>
    );
  }

  const currentStatus = s.status ?? "draft";

  return (
    <div className="builder-blog-post-settings">

      {/* The tab bar is the panel's own navigation, so it sits ABOVE the
          lattice column rather than inside it — a button dropped into that
          grid would take a label cell and put every row below it out of
          phase. It starts on the block's left edge, which is L8 rule 5.

          Its colours were eleven inline hex values chosen against a white
          panel; the editor's background is blue, and an unselected tab was
          rendering a mid grey-blue on it — "Meta", "SEO" and "Display" were
          close to invisible in the before screenshot. They take the editor's own
          heading token now, in `_builder-react-overrides.css`.

          These are deliberately PLAIN BUTTONS, and the ARIA tab roles that
          were here briefly have been taken back out. `role="tablist"` /
          `role="tab"` is a promise: a screen reader announces a tab list and
          tells the user to move through it with the arrow keys, and each tab
          is expected to point at a `role="tabpanel"` via `aria-controls`.
          None of that exists here — there is no panel element to point at and
          no roving-tabindex handling — so the roles announced a pattern the
          keyboard did not implement, which is worse than no roles at all. As
          five ordinary buttons, Tab and Enter do exactly what is announced.
          Adding the roles back means building the whole pattern with them. */}
      <div className="builder-settings-section-tabs">
        {(Object.keys(SECTION_LABELS) as Section[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`builder-settings-section-tab${section === key ? " is-active" : ""}`}
            onClick={() => setSection(key)}
          >
            {SECTION_LABELS[key]}
          </button>
        ))}
      </div>

      {/*
        ONE COLUMN, AND THE CHROME IS IN IT (W0's mechanism, and ticket
        86bbq065f's slot).

        This panel is hand-rolled rather than schema-driven, so each
        `BuilderModuleFieldStrip` used to be its own grid sitting directly in
        the panel, and the shared chrome (Label, Background, Alignment, the
        margins) was a third grid below them. Measured at 1440 before this
        change, that gave ONE panel three label widths and three control
        positions — Title 71/77, Body 76/82, the chrome 125/125 — which is
        Dane's original complaint in this ticket word for word: "the column
        width varies arbitrarily between the Settings fields and the Layout
        fields."

        Wrapping the strips in a `.builder-schema-panel-column` makes them
        `display: contents` children of one grid whose two `max-content`
        tracks measure the whole column at once, and rendering the chrome slot
        at the end of that column brings the chrome onto the same two tracks.
        No width is set on anything.

        The status row joins the column as an ordinary lattice field for the
        same reason: it was a bare select at x=83, 557px wide, on no lattice
        at all. Its coloured badge went with it — the badge printed the same
        word the select beside it already showed ("draft" / "Draft"), which is
        L3, and it was the only thing that needed the row to be a free-form
        strip rather than a labelled field.
      */}
      <div className="builder-schema-panel-columns">
        <div className="builder-schema-panel-column">

          <BuilderModuleFieldStrip>
            <BuilderModuleField label="Status" width="select-md">
              <select value={currentStatus} onChange={(e) => set("status", e.target.value)}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </BuilderModuleField>
          </BuilderModuleFieldStrip>

          {/* ── Content ── */}
          {section === "content" ? (
            <>
              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Title" width="full">
                  <input
                    type="text"
                    value={s.title ?? ""}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Post title"
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>

              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Body" width="full">
                  <BuilderRichTextEditor
                    value={s.body ?? ""}
                    onChange={setBody}
                    placeholder="Write your post here…"
                    {...richTextGallery}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
            </>
          ) : null}

          {/* ── Meta ── */}
          {section === "meta" ? (
            <>
              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Slug" width="text-md">
                  <input
                    type="text"
                    value={s.slug ?? ""}
                    onChange={(e) => set("slug", e.target.value)}
                    placeholder="my-post-title"
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Author" width="text-md">
                  <input
                    type="text"
                    value={s.author ?? ""}
                    onChange={(e) => set("author", e.target.value)}
                    placeholder="Author name"
                  />
                </BuilderModuleField>
                <BuilderModuleField label="Publish Date" width="text-md">
                  <input
                    type="text"
                    value={s.publishDate ?? ""}
                    onChange={(e) => set("publishDate", e.target.value)}
                    placeholder="Jun 22, 2026"
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>

              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Image" width="full">
                  <BuilderImagePickerField
                    value={s.featuredImageUrl ?? ""}
                    onChange={(url) => set("featuredImageUrl", url)}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>

              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Excerpt" width="full">
                  <textarea
                    className="builder-textarea"
                    value={s.excerpt ?? ""}
                    onChange={(e) => set("excerpt", e.target.value)}
                    placeholder="A short summary shown in post cards and feeds…"
                    rows={3}
                    style={{ resize: "vertical" }}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
            </>
          ) : null}

          {/* ── Taxonomy ── */}
          {section === "taxonomy" ? (
            <>
              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Categories" width="full">
                  <input
                    type="text"
                    value={s.categories ?? ""}
                    onChange={(e) => set("categories", e.target.value)}
                    placeholder="technology, design, ai"
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
              {/* Prose, not a row. `.builder-schema-bare` is the wrapper the
                  lattice already spans across both tracks — without it the
                  sentence takes a label cell and every pair below it runs half a
                  cell out of phase (the blog-search defect, 2026-09-08). */}
              <div className="builder-schema-bare">
                <p className="panel-copy builder-panel-field-note">
                  Comma-separated slugs matching your Category Filter module.
                </p>
              </div>

              <BuilderModuleFieldStrip>
                <BuilderModuleField label="Tags" width="full">
                  <input
                    type="text"
                    value={s.tags ?? ""}
                    onChange={(e) => set("tags", e.target.value)}
                    placeholder="react, typescript, tutorial"
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>
              <div className="builder-schema-bare">
                <p className="panel-copy builder-panel-field-note">Comma-separated tags.</p>
              </div>
            </>
          ) : null}

          {/* ── SEO ── */}
          {section === "seo" ? (
            <>
              <BuilderModuleFieldStrip>
                <BuilderModuleField label="SEO Title" width="full">
                  <input
                    type="text"
                    value={s.seoTitle ?? ""}
                    onChange={(e) => set("seoTitle", e.target.value)}
                    placeholder={s.title || "SEO page title"}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>

              <BuilderModuleFieldStrip>
                <BuilderModuleField label="SEO Description" width="full">
                  <textarea
                    className="builder-textarea"
                    value={s.seoDescription ?? ""}
                    onChange={(e) => set("seoDescription", e.target.value)}
                    placeholder="150–160 character description for search results…"
                    rows={3}
                    style={{ resize: "vertical" }}
                  />
                </BuilderModuleField>
              </BuilderModuleFieldStrip>

              {s.seoDescription ? (
                <div className="builder-schema-bare">
                  <p
                    className={`panel-copy builder-panel-field-note${
                      s.seoDescription.length > 160 ? " is-over" : " is-within"
                    }`}
                  >
                    {s.seoDescription.length} / 160 characters
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {/* ── Display ── */}
          {section === "display" ? (
            <BuilderModuleFieldStrip>
              {showHideField("showFeaturedImage", "Image", "true")}
              {showHideField("showExcerpt", "Excerpt", "true")}
              {showHideField("showAuthor", "Author", "true")}
              {showHideField("showDate", "Date", "true")}
              {showHideField("showCategories", "Categories", "true")}
              {showHideField("showTags", "Tags", "false")}
            </BuilderModuleFieldStrip>
          ) : null}

          {/* The shared chrome, rendered INTO this column so it reads the same
              two tracks. Without it the chrome is a second grid below the
              panel and the two disagree — which is what they did here. */}
          <BuilderModuleChromeSlot />
        </div>
      </div>
    </div>
  );
}
