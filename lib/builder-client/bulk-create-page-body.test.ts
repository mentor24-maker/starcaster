import { describe, expect, it } from "vitest";
import { buildBulkCreatePageBody } from "./bulk-create-page-body";

/**
 * The DEFAULT Bulk Create path — no content model — posts each page to the
 * single create route from the browser. It sent the chosen template as
 * `templateId` only, so the server wrote it to the legacy layout-name column
 * and left `page_template_id` NULL: every page in the batch read "No template"
 * in Page Details (task 86bbve4kp, found in review of PR #635).
 */

const base = {
  name: "Court Fees",
  slug: "court-fees",
  templateId: "47",
  pageBackground: {},
  theme: {},
  layoutSections: [],
};

describe("buildBulkCreatePageBody", () => {
  it("sends the chosen page template", () => {
    expect(buildBulkCreatePageBody(base).pageTemplateId).toBe("47");
  });

  it("still sends the legacy templateId it always has", () => {
    // This path has always put the chosen id in template_id too. Anything
    // reading that column must see exactly what it saw before the fix.
    expect(buildBulkCreatePageBody(base).templateId).toBe("47");
  });

  it("carries a built-in template id, not just a numeric row id", () => {
    // BUILT_IN_PAGE_TEMPLATES ids are legal page_template_id values, so the
    // body must not assume digits.
    const body = buildBulkCreatePageBody({ ...base, templateId: "standard-right-form" });
    expect(body.pageTemplateId).toBe("standard-right-form");
    expect(body.templateId).toBe("standard-right-form");
  });

  it("omits an unset theme rather than sending an empty string", () => {
    // JSON.stringify drops undefined; an empty string would be written as a
    // real themeId of "".
    expect(buildBulkCreatePageBody({ ...base, themeId: "" }).themeId).toBeUndefined();
    expect(buildBulkCreatePageBody({ ...base, themeId: "9" }).themeId).toBe("9");
  });

  it("passes the template's sections, background and theme through untouched", () => {
    const sections = [{ id: "s1" }];
    const background = { type: "color", value: "#fff" };
    const theme = { typography: { body: "Inter" } };
    const body = buildBulkCreatePageBody({
      ...base,
      layoutSections: sections,
      pageBackground: background,
      theme,
    });
    expect(body.layoutSections).toBe(sections);
    expect(body.pageBackground).toBe(background);
    expect(body.theme).toBe(theme);
    expect(body.templateKind).toBe("modular");
  });
});
