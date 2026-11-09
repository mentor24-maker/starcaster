/**
 * Site Import — read an imported form's source HTML (task 86bcynjvc).
 *
 * When Site Import meets a form on a source site it keeps a screenshot plus
 * the form's original markup (`settings.importSourceHtml`, map.ts). This file
 * READS that markup and works out what the form actually asks: its questions,
 * their types, which are required, the choices, and the button wording — and
 * says plainly what it left out and why.
 *
 * Pure: a string in, a plain object out. Nothing is written anywhere; the
 * next ticket (86bcynjx2) turns the result into a Starcaster form.
 *
 * "Keep useful, list the rest" (Dane, 2026-11-04): spam traps, security
 * tokens, plugin plumbing and CAPTCHA widgets are DROPPED and named; a hidden
 * field whose value means something to a person is KEPT as information; an
 * input the reader does not recognise becomes a `text` field plus a note.
 * Every control in the form lands in exactly one of `fields`, `kept` or
 * `dropped` — nothing vanishes silently, and a test counts them.
 */

import * as cheerio from "cheerio";

type CheerioApi = ReturnType<typeof cheerio.load>;
// cheerio's own node types are not part of its stable surface; type what we touch.
type El = { type: string; name?: string; attribs?: Record<string, string>; parent?: El | null; children?: El[]; data?: string };

export type FormFieldType =
  | "text" | "email" | "tel" | "url" | "number" | "textarea" | "select" | "date"
  | "boolean" | "radio" | "checkboxes" | "multiselect";

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  /** The source control's `name` attribute (radio/checkbox groups share one). */
  sourceName?: string;
  /** How many source controls this question was read from (a radio group's options are one each). */
  controls: number;
}

export interface KeptItem { name: string; value: string; why: string }

export interface DroppedItem {
  what: string;
  why: string;
  /** The source control's `name`, when the dropped thing was a form control. */
  name?: string;
  /** True for something that is not a form control (a CAPTCHA widget box). */
  widget?: boolean;
  /** How many source controls this entry accounts for, when more than one (a trapped group). */
  controls?: number;
}

export interface Note { what: string; why: string }

export interface DataCaptureForm {
  kind: "data-capture";
  heading?: string;
  submitLabel: string;
  fields: FormField[];
  kept: KeptItem[];
  dropped: DroppedItem[];
  /** Things the reader guessed about, e.g. an input type it does not know. */
  notes: Note[];
}

export interface NotDataCaptureForm { kind: "not-data-capture"; reason: string }

export type SourceFormReading = DataCaptureForm | NotDataCaptureForm;

/* ---------------------------------------------------------------- helpers */

function attr(el: El, name: string): string {
  return (el.attribs && el.attribs[name]) || "";
}

function tag(el: El): string {
  return (el.name || "").toLowerCase();
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Text of a node, skipping form controls, scripts and styles. */
function textOf(el: El): string {
  let out = "";
  const walk = (n: El) => {
    if (n.type === "text") { out += n.data || ""; return; }
    const t = tag(n);
    if (t === "script" || t === "style" || t === "select" || t === "textarea" || t === "template") return;
    for (const c of n.children || []) walk(c);
  };
  walk(el);
  return clean(out);
}

/** Strip the trailing required marker and colon from a label. */
function stripLabel(s: string): { text: string; starred: boolean } {
  let text = clean(s);
  let starred = false;
  for (;;) {
    const before = text;
    text = text.replace(/\s*\((required)\)\s*$/i, () => { starred = true; return ""; });
    text = text.replace(/\s*\*\s*$/, () => { starred = true; return ""; });
    text = text.replace(/\s*:\s*$/, "");
    if (text === before) break;
  }
  return { text: text.trim(), starred };
}

function ancestors(el: El, stop: El | null): El[] {
  const out: El[] = [];
  let p = el.parent || null;
  while (p && p !== stop && p.type !== "root") { out.push(p); p = p.parent || null; }
  return out;
}

function styleHides(el: El): boolean {
  const style = attr(el, "style").toLowerCase().replace(/\s+/g, "");
  if (/display:none|visibility:hidden/.test(style)) return true;
  // Classic honeypot positioning: shoved far off-screen.
  if (/position:absolute/.test(style) && /(left|top):-\d{3,}px/.test(style)) return true;
  return false;
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/g, "");
}

function humanize(name: string): string {
  const base = name.replace(/\[\]$/, "").replace(/^.*\[([^\]]+)\]$/, "$1");
  return clean(base.replace(/[_\-.]+/g, " ")).replace(/^./, (c) => c.toUpperCase());
}

/* ---------------------------------------------------------------- rules */

const CAPTCHA_CLASS: Array<[RegExp, string]> = [
  [/\bg-recaptcha\b|\bgrecaptcha\b/, "reCAPTCHA"],
  [/\bh-captcha\b/, "hCaptcha"],
  [/\bcf-turnstile\b/, "Cloudflare Turnstile"],
];
const CAPTCHA_NAME: Array<[RegExp, string]> = [
  [/^g-recaptcha-response$/i, "reCAPTCHA"],
  [/^h-captcha-response$/i, "hCaptcha"],
  [/^cf-turnstile-response$/i, "Cloudflare Turnstile"],
];

const TRAP_TEXT = /leave (this|the) field (empty|blank)|leave (this )?(empty|blank)|should be left (unchanged|empty|blank)|for validation purposes|if you are (a )?human|do not fill/i;

const TOKEN_NAME = /(^|[_\-\[])(token|nonce|csrf|xsrf|authenticity_token|_wpnonce|hash)([_\-\]]|$)|^_token$|nonce/i;

/** Hidden fields that are known plugin plumbing, by name. */
const PLUMBING_NAME = /^(action|api_version|endpoint|form_id|data\[form_id\]|mailpoet_method|redirect|_redirect|redirect_to|return|_wp_http_referer|referer|referrer|submitted|is_submit_\d+|state_\d+|gform_[a-z_\d]*|_wpcf7[a-z_]*|hs_context|u|id|formid|form_name|form-name|page_id|post_id|wpforms\[[a-z_]+\]|_gotcha)$/i;

/** Hidden fields whose value is information for a person, by name. */
const MEANINGFUL_NAME = /(^|[_\-\[])(list|lists|list_name|source|lead_?source|signup_?source|tag|tags|campaign|segment|group|groups|interest|interests|utm_[a-z]+|audience|category)([_\-\]]|$)/i;

function looksLikeOpaqueValue(v: string): boolean {
  if (!v) return true;
  if (/^\d+$/.test(v)) return true; // a bare id number means nothing to a person
  if (/^[a-f0-9]{8,}$/i.test(v)) return true; // hex id / hash
  if (/^[A-Za-z0-9+/=_\-]{16,}$/.test(v) && !/\s/.test(v)) return true; // token-shaped
  if (/^\{.*\}$|^\[.*\]$/.test(v.trim())) return true; // JSON blob (hs_context)
  return false;
}

/* ---------------------------------------------------------------- reader */

const CONTROL_SELECTOR = "input, select, textarea";
const BUTTON_INPUT_TYPES = new Set(["submit", "button", "reset", "image"]);

const SIMPLE_INPUT_TYPES: Record<string, FormFieldType> = {
  text: "text", email: "email", tel: "tel", url: "url", number: "number", date: "date",
  search: "text",
};

/**
 * Read one form out of a fragment of source HTML.
 *
 * The fragment is whatever map.ts stored — usually the form's outer HTML,
 * sometimes a wrapper around it (an embed's container). The first `<form>`
 * is read; with none, the whole fragment is (a rendered HubSpot embed, say).
 */
export function readSourceForm(html: string): SourceFormReading {
  const $: CheerioApi = cheerio.load(html || "");
  const forms = $("form").toArray() as unknown as El[];
  const root: El = (forms[0] || ($.root().get(0) as unknown as El));
  const $root = $(root as never);

  const controls = $root.find(CONTROL_SELECTOR).toArray() as unknown as El[];
  const fillable = controls.filter((c) => !(tag(c) === "input" && BUTTON_INPUT_TYPES.has(attr(c, "type").toLowerCase())));

  /* ---- not a data-capture form? ---- */
  const notCapture = classifyNonCapture($, root, fillable);
  if (notCapture) return { kind: "not-data-capture", reason: notCapture };

  const fields: FormField[] = [];
  const kept: KeptItem[] = [];
  const dropped: DroppedItem[] = [];
  const notes: Note[] = [];

  if (forms.length > 1) {
    notes.push({ what: `${forms.length - 1} further form(s) in the same block`, why: "only the first form in an imported block is read" });
  }

  /* ---- CAPTCHA widgets (boxes, not controls) ---- */
  const captchaSeen = new Set<string>();
  $root.find("[class], iframe").each((_i, node) => {
    const el = node as unknown as El;
    const cls = attr(el, "class");
    let provider = "";
    for (const [re, p] of CAPTCHA_CLASS) if (re.test(cls)) provider = p;
    if (!provider && tag(el) === "iframe") {
      const src = attr(el, "src");
      if (/recaptcha/.test(src)) provider = "reCAPTCHA";
      else if (/hcaptcha/.test(src)) provider = "hCaptcha";
      else if (/challenges\.cloudflare\.com/.test(src)) provider = "Cloudflare Turnstile";
    }
    if (provider && !captchaSeen.has(provider)) {
      captchaSeen.add(provider);
      dropped.push({ what: `${provider} widget`, why: "CAPTCHA — Starcaster forms carry their own spam protection", widget: true });
    }
  });

  /* ---- label lookup ---- */
  const labelFor = new Map<string, El>();
  $root.find("label[for]").each((_i, n) => {
    const el = n as unknown as El;
    if (!labelFor.has(attr(el, "for"))) labelFor.set(attr(el, "for"), el);
  });

  const wrappingLabel = (c: El): El | null => ancestors(c, root).find((a) => tag(a) === "label") || null;

  const controlLabel = (c: El): { text: string; starred: boolean } => {
    const id = attr(c, "id");
    const candidates: string[] = [];
    if (id && labelFor.has(id)) candidates.push(textOf(labelFor.get(id) as El));
    const wrap = wrappingLabel(c);
    if (wrap) candidates.push(textOf(wrap));
    const fieldset = ancestors(c, root).find((a) => tag(a) === "fieldset");
    if (fieldset) {
      const legend = (fieldset.children || []).find((k) => tag(k) === "legend");
      if (legend) candidates.push(textOf(legend));
    }
    candidates.push(attr(c, "aria-label"), attr(c, "title"), attr(c, "placeholder"));
    for (const cand of candidates) {
      const s = stripLabel(cand || "");
      if (s.text) return s;
    }
    return { text: "", starred: false };
  };

  /** Label of a radio / checkbox GROUP, which its options' labels are not. */
  const groupLabel = (members: El[]): { text: string; starred: boolean } => {
    const first = members[0];
    const anc = ancestors(first, root);
    const fieldset = anc.find((a) => tag(a) === "fieldset");
    if (fieldset) {
      const legend = (fieldset.children || []).find((k) => tag(k) === "legend");
      if (legend) { const s = stripLabel(textOf(legend)); if (s.text) return s; }
    }
    const group = anc.find((a) => /^(radiogroup|group)$/.test(attr(a, "role")) && (attr(a, "aria-label") || attr(a, "aria-labelledby")));
    if (group) {
      const by = attr(group, "aria-labelledby");
      const byEl = by ? ($root.find(`#${by.split(/\s+/)[0].replace(/([^\w-])/g, "\\$1")}`).get(0) as unknown as El | undefined) : undefined;
      const s = stripLabel(byEl ? textOf(byEl) : attr(group, "aria-label"));
      if (s.text) return s;
    }
    // A <label> that points at the group's container (Gravity Forms / CF7 style).
    for (const a of anc) {
      const id = attr(a, "id");
      if (id && labelFor.has(id)) { const s = stripLabel(textOf(labelFor.get(id) as El)); if (s.text) return s; }
    }
    return stripLabel(attr(first, "aria-label") || attr(first, "title"));
  };

  const optionLabel = (c: El): string => {
    const id = attr(c, "id");
    if (id && labelFor.has(id)) { const t = textOf(labelFor.get(id) as El); if (t) return t; }
    const wrap = wrappingLabel(c);
    if (wrap) { const t = textOf(wrap); if (t) return t; }
    return clean(attr(c, "value"));
  };

  const isRequired = (c: El): boolean =>
    c.attribs !== undefined && ("required" in c.attribs
      || attr(c, "aria-required").toLowerCase() === "true"
      // Parsley's documented form is the bare attribute; only an explicit
      // "false" switches it off.
      || ("data-parsley-required" in c.attribs && attr(c, "data-parsley-required").toLowerCase() !== "false"));

  const isTrap = (c: El): boolean => {
    if (styleHides(c)) return true;
    // A hidden LABEL is not a trap on its own: themes hide labels and show the
    // placeholder instead (Divi does it to every WordPress comment box, which
    // made Name, Email, Website and Comment read as spam traps — task
    // 86bcz5g7a). A honeypot hides the box itself or what holds it; both are
    // caught here and in the ancestor walk below.
    if (attr(c, "tabindex") === "-1" && /off|nope/.test(attr(c, "autocomplete"))) return true;
    if (/^b_[a-f0-9]+_[a-f0-9]+$/i.test(attr(c, "name"))) return true; // Mailchimp honeypot
    for (const a of ancestors(c, root)) {
      if (styleHides(a)) return true;
      if (attr(a, "aria-hidden") === "true") return true;
      if (/(^|[\s_-])(hp|honeypot|gform_validation_container)([\s_-]|$)|_hp_/i.test(attr(a, "class"))) return true;
    }
    const lbl = controlLabel(c).text;
    if (TRAP_TEXT.test(lbl)) return true;
    if (/(^|[\s_-])(hp|honeypot)([\s_-]|$)/i.test(attr(c, "class"))) return true;
    return false;
  };

  const captchaFor = (c: El): string => {
    const name = attr(c, "name");
    for (const [re, p] of CAPTCHA_NAME) if (re.test(name)) return p;
    for (const a of ancestors(c, root)) for (const [re, p] of CAPTCHA_CLASS) if (re.test(attr(a, "class"))) return p;
    return "";
  };

  /* ---- walk the controls in source order, grouping radio/checkbox by name ---- */
  const usedKeys = new Set<string>();
  const claimKey = (preferred: string, fallback: string): string => {
    let base = preferred && !usedKeys.has(preferred) ? preferred : (slug(fallback) || "field");
    let key = base;
    for (let n = 2; usedKeys.has(key); n++) key = `${base}_${n}`;
    usedKeys.add(key);
    return key;
  };

  // Radio buttons and tick boxes are grouped by shared name. Gravity Forms
  // gives each tick box of one question its own name sharing a prefix
  // (input_5.1, input_5.2), so those are one question too. Tick boxes that
  // merely sit in the same fieldset are NOT grouped: two separately named
  // consent boxes are two yes/no questions (round-1 review, PR #965).
  const grouped = new Set<El>();
  const sameType = (m: El, type: string) => tag(m) === "input" && attr(m, "type").toLowerCase() === type;
  const SUBFIELD = /^(.+)\.\d+$/;
  const groupMembers = (c: El, type: string): El[] => {
    const name = attr(c, "name");
    if (name) {
      const byName = fillable.filter((m) => sameType(m, type) && attr(m, "name") === name);
      if (byName.length > 1 || type === "radio") return byName;
    }
    if (type === "checkbox") {
      const prefix = SUBFIELD.exec(name)?.[1];
      if (prefix) {
        const siblings = fillable.filter((m) => sameType(m, type) && !grouped.has(m)
          && SUBFIELD.exec(attr(m, "name"))?.[1] === prefix);
        if (siblings.length > 1) return siblings;
      }
    }
    return [c];
  };
  const describeControl = (c: El): string => {
    const t = tag(c) === "input" ? `${attr(c, "type").toLowerCase() || "text"} input` : tag(c);
    const name = attr(c, "name");
    return name ? `${t} "${name}"` : t;
  };

  for (const c of fillable) {
    const t = tag(c);
    const type = attr(c, "type").toLowerCase() || "text";
    const name = attr(c, "name");

    if (t === "input" && (type === "radio" || type === "checkbox")) {
      if (grouped.has(c)) continue;
      const members = groupMembers(c, type);
      for (const m of members) grouped.add(m);
      if (members.every(isTrap)) { dropped.push({ what: describeControl(c), why: "spam trap — a box hidden from people that only robots fill in", name, controls: members.length }); continue; }
      if (type === "checkbox" && members.length === 1) {
        const s = controlLabel(c);
        const label = s.text || humanize(name);
        fields.push({ key: claimKey("", label), label, type: "boolean", required: isRequired(c) || s.starred, options: [], sourceName: name || undefined, controls: 1 });
        continue;
      }
      const s = groupLabel(members);
      const label = s.text || humanize(name);
      if (!s.text) notes.push({ what: `question "${label}"`, why: "the source gave this group of choices no visible question, so its name was used" });
      fields.push({
        key: claimKey("", label), label,
        type: type === "radio" ? "radio" : "checkboxes",
        required: members.some(isRequired) || s.starred,
        options: members.map(optionLabel),
        sourceName: name || undefined,
        controls: members.length,
      });
      continue;
    }

    const captcha = captchaFor(c);
    if (captcha) {
      if (!captchaSeen.has(captcha)) { captchaSeen.add(captcha); }
      dropped.push({ what: `${captcha} answer (${describeControl(c)})`, why: "CAPTCHA — Starcaster forms carry their own spam protection", name });
      continue;
    }

    if (t === "input" && type === "hidden") {
      const value = attr(c, "value");
      if (TOKEN_NAME.test(name)) { dropped.push({ what: `hidden "${name}"`, why: "security token — it is only valid on the original site", name }); continue; }
      // Plumbing first: "_wpcf7_unit_tag" carries the word "tag" and is still plumbing.
      if (PLUMBING_NAME.test(name)) { dropped.push({ what: `hidden "${name}"`, why: "form plugin plumbing — it only meant something to the original site's software", name }); continue; }
      if (MEANINGFUL_NAME.test(name) && !looksLikeOpaqueValue(value)) {
        kept.push({ name, value, why: "a hidden value that says something about the signup (a list, source or tag)" });
        continue;
      }
      if (!value) { dropped.push({ what: `hidden "${name}"`, why: "an empty hidden field — it carries nothing", name }); continue; }
      if (looksLikeOpaqueValue(value)) { dropped.push({ what: `hidden "${name}"`, why: "an internal id or code the original site's software used", name }); continue; }
      kept.push({ name, value, why: "a hidden value that reads as information; kept so it can be shown" });
      continue;
    }

    if (isTrap(c)) { dropped.push({ what: describeControl(c), why: "spam trap — a box hidden from people that only robots fill in", name: name || undefined }); continue; }
    if (TOKEN_NAME.test(name)) { dropped.push({ what: describeControl(c), why: "security token — it is only valid on the original site", name }); continue; }

    const s = controlLabel(c);
    const required = isRequired(c) || s.starred;
    let fieldType: FormFieldType;
    let options: string[] = [];
    if (t === "textarea") fieldType = "textarea";
    else if (t === "select") {
      fieldType = c.attribs && "multiple" in c.attribs ? "multiselect" : "select";
      options = ($(c as never).find("option").toArray() as unknown as El[])
        .filter((o) => !(attr(o, "value") === "" && ((o.attribs && ("disabled" in o.attribs || "selected" in o.attribs)) || /^(--|—|select|choose|please|pick)/i.test(textOf(o)) || !textOf(o))))
        .map((o) => textOf(o) || clean(attr(o, "value")));
    } else if (SIMPLE_INPUT_TYPES[type]) fieldType = SIMPLE_INPUT_TYPES[type];
    else {
      fieldType = "text";
      notes.push({ what: describeControl(c), why: `Starcaster forms have no "${type}" question, so it was read as plain text` });
    }

    const auto = attr(c, "autocomplete").toLowerCase();
    let preferred = "";
    if (fieldType === "email" || auto === "email" || /^e-?mail$|\[e-?mail\]$|^your-email$/i.test(name)) { preferred = "email"; if (fieldType === "text") fieldType = "email"; }
    else if (auto === "given-name" || /(^|[_\-\[])(first[_\- ]?name|fname|given[_\- ]?name)([_\-\]]|$)/i.test(name)) preferred = "first_name";
    else if (auto === "family-name" || /(^|[_\-\[])(last[_\- ]?name|lname|family[_\- ]?name|surname)([_\-\]]|$)/i.test(name)) preferred = "last_name";
    else if (fieldType === "tel" || auto === "tel" || /(^|[_\-\[])(phone|tel|telephone|mobile)([_\-\]]|$)/i.test(name)) { preferred = "phone"; if (fieldType === "text") fieldType = "tel"; }

    const label = s.text || humanize(name) || "Untitled question";
    if (!s.text) notes.push({ what: `question "${label}"`, why: "the source gave this box no visible label, so its name was used" });
    fields.push({ key: claimKey(preferred, label), label, type: fieldType, required, options, sourceName: name || undefined, controls: 1 });
  }

  return {
    kind: "data-capture",
    // The heading often sits in the embed's wrapper, outside the <form> itself.
    heading: readHeading($, $.root().get(0) as unknown as El),
    submitLabel: readSubmitLabel($, root),
    fields, kept, dropped, notes,
  };
}

function classifyNonCapture($: CheerioApi, root: El, fillable: El[]): string | null {
  const selfAndUp = [root, ...ancestors(root, null)];
  if (selfAndUp.some((e) => attr(e, "role") === "search") || $(root as never).find("[role=search]").length) {
    return "a site search box (marked role=search) — it searches the old site, it does not collect anything";
  }
  if (isWordPressCommentForm(root, fillable)) {
    return "a blog comment box — Starcaster blog posts have their own comments";
  }
  if (fillable.some((c) => attr(c, "type").toLowerCase() === "password")) {
    return "a sign-in form (it has a password box) — Starcaster has its own sign-in, so this stays as it was imported";
  }
  const isCard = (c: El) => /^cc-/.test(attr(c, "autocomplete").toLowerCase())
    || /(^|[_\-\[])(card[_\-]?number|cc[_\-]?(number|num)|cvv|cvc|card[_\-]?cvc|expiry|exp[_\-]?date)([_\-\]]|$)/i.test(attr(c, "name"));
  const action = attr(root, "action").toLowerCase();
  if (fillable.some(isCard) || /checkout|\/cart|paypal\.com|stripe\.com/.test(action) || /\bcheckout\b|woocommerce-cart/.test(attr(root, "class"))) {
    return "a checkout or payment form — taking payments is not something an imported form can do, so it stays as it was imported";
  }
  const visible = fillable.filter((c) => {
    const t = attr(c, "type").toLowerCase();
    return t !== "hidden";
  });
  if (visible.length === 1) {
    const only = visible[0];
    const name = attr(only, "name").toLowerCase();
    if (attr(only, "type").toLowerCase() === "search" || /^(s|q|query|search|search_query|keyword|keywords)$/.test(name)) {
      return `a site search box (a single "${attr(only, "name") || "search"}" box) — it searches the old site, it does not collect anything`;
    }
  }
  if (!visible.length) return "it has no boxes a visitor fills in";
  return null;
}

/**
 * WordPress's reply box ("Leave a Reply" — comment, name, email, website):
 * it posts to wp-comments-post.php and carries comment_post_ID. It is a
 * comment thread, not a signup, so it is not rebuilt as a form (task 86bcz5g7a).
 */
function isWordPressCommentForm(root: El, fillable: El[]): boolean {
  if (/wp-comments-post\.php/i.test(attr(root, "action"))) return true;
  if (fillable.some((c) => attr(c, "name") === "comment_post_ID")) return true;
  return attr(root, "id") === "commentform" && /(^|\s)comment-form(\s|$)/.test(attr(root, "class"));
}

function readHeading($: CheerioApi, root: El): string | undefined {
  const h = $(root as never).find("h1, h2, h3, h4, h5, h6, .gform_title, .mailpoet_form_heading, .hs-form-title").first();
  if (h.length) { const t = clean(h.text()); if (t) return t; }
  return undefined;
}

function readSubmitLabel($: CheerioApi, root: El): string {
  const $r = $(root as never);
  const input = $r.find("input[type=submit], input[type=image]").first();
  if (input.length) {
    const v = clean(input.attr("value") || input.attr("alt") || "");
    if (v) return v;
  }
  const button = ($r.find("button").toArray() as unknown as El[]).find((b) => {
    const t = attr(b, "type").toLowerCase();
    return t === "" || t === "submit";
  });
  if (button) { const t = textOf(button) || clean(attr(button, "aria-label")); if (t) return t; }
  return "Submit";
}
