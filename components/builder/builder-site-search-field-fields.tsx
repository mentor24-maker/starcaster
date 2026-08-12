"use client";

import type { BuilderSchemaField } from "./builder-settings-schema";

/**
 * The style controls for the Site Search BOX.
 *
 * The box is rendered by one component (`SiteSearchField`) but reached from
 * two panels — the Site Search module, and the Site Search Results module,
 * which carries its own copy of the box. Two hand-written copies of these
 * strips is exactly how a control ends up on one panel and not the other, so
 * they are declared once here and spread into both.
 *
 * Every `rendersVia` names something that genuinely consumes the setting
 * (doctrine E7): `siteSearchFieldVars` turns each of these into a CSS custom
 * property on the form, and `_builder-react-overrides.css` reads them.
 */

/** Wording and visibility — what the box actually says. Lives on Content. */
export function siteSearchLabelContentFields(): BuilderSchemaField[] {
  return [
    {
      key: "showLabel",
      label: "Show Label",
      width: "check",
      control: "checkbox",
      rendersVia: "SiteSearchField"
    },
    {
      key: "labelText",
      label: "Label Text",
      width: "text-md",
      control: "text",
      placeholder: "Search",
      rendersVia: "SiteSearchField"
    },
    {
      key: "labelPosition",
      label: "Label Position",
      width: "select-sm",
      control: "select",
      options: [
        { value: "above", label: "Above" },
        { value: "inline", label: "Beside" }
      ],
      rendersVia: "SiteSearchField"
    }
  ];
}

/**
 * The Text axis: how the label and the button's wording are set.
 *
 * A6 — text colour is basic and belongs here with size and weight, not tucked
 * away behind the colour controls that paint boxes.
 */
export function siteSearchTypeFields(): BuilderSchemaField[] {
  return [
    {
      key: "labelColor",
      label: "Label Color",
      width: "color",
      control: "theme-color",
      dialogLabel: "Label color",
      themeDefault: "#000000",
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "labelFontSize",
      label: "Label Size",
      width: "num",
      control: "number",
      min: 8,
      max: 48,
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "labelBold",
      label: "Label Bold",
      width: "check",
      control: "checkbox",
      rendersVia: "siteSearchFieldVars"
    }
  ];
}

/** The button's own wording style — same axis, its own strip. */
export function siteSearchButtonTypeFields(): BuilderSchemaField[] {
  return [
    {
      key: "buttonTextColor",
      label: "Button Text Color",
      width: "color",
      control: "theme-color",
      dialogLabel: "Button text color",
      themeDefault: "#ffffff",
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "buttonFontSize",
      label: "Button Text Size",
      width: "num",
      control: "number",
      min: 8,
      max: 48,
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "buttonBold",
      label: "Button Bold",
      width: "check",
      control: "checkbox",
      rendersVia: "siteSearchFieldVars"
    }
  ];
}

/**
 * The field's own size. D9 rung: Width changes the shape of the whole row, so
 * it leads; Height only makes the same row taller.
 */
export function siteSearchFieldSizeFields(): BuilderSchemaField[] {
  return [
    {
      key: "fieldWidth",
      label: "Field Width",
      width: "num",
      control: "number",
      min: 0,
      max: 1200,
      // Counts in fives (operator, 2026-08-12). At step 1 this dropdown held
      // 1,201 options and scrolling it to 400 was the worst control in the
      // panel; nobody sets a field width to the nearest pixel. 241 now.
      step: 5,
      // 0 is the default and means "grow to fill the row" — the behaviour
      // every existing search box already has, so an untouched module does
      // not move.
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "fieldHeight",
      label: "Field Height",
      width: "num",
      control: "number",
      min: 24,
      max: 96,
      rendersVia: "siteSearchFieldVars"
    }
  ];
}

/**
 * The button's fill and border. Border Width gates the two controls that only
 * matter once there is a border, so they sit beside it (D9).
 */
export function siteSearchButtonFrameFields(): BuilderSchemaField[] {
  return [
    {
      key: "accentColor",
      label: "Button Color",
      width: "color",
      control: "theme-color",
      dialogLabel: "Button color",
      themeDefault: "#0f4f8f",
      rendersVia: "siteSearchAccent"
    },
    {
      key: "buttonBorderWidth",
      label: "Button Border",
      width: "num",
      control: "number",
      min: 0,
      max: 12,
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "buttonBorderStyle",
      label: "Border Style",
      width: "select-sm",
      control: "select",
      options: [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" },
        { value: "double", label: "Double" }
      ],
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "buttonBorderColor",
      label: "Border Color",
      width: "color",
      control: "theme-color",
      dialogLabel: "Button border color",
      themeDefault: "#000000",
      rendersVia: "siteSearchFieldVars"
    },
    {
      key: "borderRadius",
      label: "Radius",
      width: "num",
      control: "number",
      min: 0,
      max: 40,
      // One radius for the field and the button on purpose: they sit edge to
      // edge, and two different corner sizes on one row reads as a mistake.
      rendersVia: "siteSearchRadius"
    }
  ];
}
