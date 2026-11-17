'use strict';

/**
 * The agent read-out of Assets › Context (ticket SC-810, slice 3 of 3).
 *
 * `npm run context` (scripts/context.mjs) reads a project's context entries
 * and prints them as plain text an agent session can read in one go. This file
 * is the part of it that does not touch a database, so the tests can reach
 * every branch: turning the page's rich text (HTML) into Markdown, finding the
 * project that was named, and the verdicts.
 *
 * THREE VERDICTS, NEVER TWO. "This project has no entries" (exit 0) and "this
 * project could not be read" (exit 2) must never print the same thing, or an
 * agent session told there is no context would carry on without the material
 * that was supposed to guide it. A table that is not in the database yet is
 * the second kind, and says which SQL file creates it.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { formatFileSize } = require('./contextFileTypes');

const SQL_FILE = 'docs/SQL/context_entries_setup.sql';

// ------------------------------------------------------------ rich text → Markdown

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre',
  'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'figcaption',
]);

function collapse(text) {
  return String(text || '').replace(/[ \t\r\n\f ]+/g, ' ');
}

/** Inline content of a node: text, bold, italics, code, links, line breaks. */
function inline($, node, ctx = {}) {
  let out = '';
  $(node).contents().each((_, child) => {
    if (child.type === 'text') {
      out += collapse(child.data);
      return;
    }
    if (child.type !== 'tag') return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    if (tag === 'br') { out += '\n'; return; }
    if (tag === 'img') { out += imageText($, child); return; }
    if (BLOCK_TAGS.has(tag)) {
      // A block inside inline content (a list inside a paragraph, which some
      // editors produce): keep it on its own lines rather than losing it.
      out += `\n${blocks($, child, ctx).join('\n\n')}\n`;
      return;
    }
    const inner = inline($, child, ctx);
    if (!inner.trim()) { out += inner; return; }
    if (tag === 'strong' || tag === 'b') out += wrap(inner, '**');
    else if (tag === 'em' || tag === 'i') out += wrap(inner, '*');
    else if (tag === 's' || tag === 'del' || tag === 'strike') out += wrap(inner, '~~');
    else if (tag === 'code') out += codeSpan(inner.trim());
    else if (tag === 'a') {
      const href = String($(child).attr('href') || '').trim();
      out += href && href !== inner.trim() ? `[${inner.trim()}](${href})` : inner;
    } else out += inner;
  });
  return out;
}

// Inline code whose text holds a backtick needs a longer fence than its
// longest backtick run, and a space inside when it starts or ends with one,
// or the Markdown breaks ("`a`b`").
function codeSpan(text) {
  const runs = String(text).match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

// Markdown emphasis must hug the words: "** bold **" is not bold.
function wrap(text, mark) {
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  return `${lead}${mark}${text.trim()}${mark}${trail}`;
}

function cleanInline(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function imageText($, node) {
  const alt = String($(node).attr('alt') || '').trim();
  const src = String($(node).attr('src') || '').trim();
  return src ? `![${alt}](${src})` : (alt ? `[image: ${alt}]` : '');
}

function indent(text, prefix) {
  return text.split('\n').map((line, i) => (i === 0 ? line : (line ? `${prefix}${line}` : line))).join('\n');
}

function listBlock($, node, ordered, ctx = {}) {
  const items = [];
  // start="0" is a real start, not a missing one.
  const start = Number.parseInt(String($(node).attr('start') ?? ''), 10);
  let n = Number.isFinite(start) ? start : 1;
  $(node).children('li').each((_, li) => {
    const marker = ordered ? `${n}. ` : '- ';
    n += 1;
    // Each part is { text, block }. A paragraph, code block or other block
    // inside an item is made by blocks() on the child ITSELF, so a <pre> keeps
    // its line breaks, and is set off by a blank line so two paragraphs stay
    // two (review of PR #1017). Plain text and a nested list stay tight.
    const parts = [];
    let text = '';
    const flushText = () => {
      if (text.trim()) parts.push({ text: cleanInline(text), block: false });
      text = '';
    };
    $(li).contents().each((__, child) => {
      const tag = child.type === 'tag' ? child.tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') {
        flushText();
        parts.push({ text: listBlock($, child, tag === 'ol', ctx), block: false });
      } else if (tag && BLOCK_TAGS.has(tag) && tag !== 'li') {
        flushText();
        const wrapper = $('<div></div>').append($(child).clone());
        parts.push({ text: blocks($, wrapper, ctx).join('\n\n'), block: true });
      } else if (child.type === 'tag' || child.type === 'text') {
        const wrapper = $('<span></span>').append($(child).clone());
        text += inline($, wrapper, ctx);
      }
    });
    flushText();
    let body = '';
    for (const part of parts.filter((p) => p.text)) {
      if (body) body += part.block ? '\n\n' : '\n';
      body += part.text;
    }
    items.push(`${marker}${indent(body, ' '.repeat(marker.length))}`);
  });
  return items.join('\n');
}

function tableBlock($, node, ctx = {}) {
  const rows = [];
  $(node).find('tr').each((_, tr) => {
    const cells = [];
    $(tr).children('th,td').each((__, cell) => {
      cells.push(cleanInline(inline($, cell, ctx)).replace(/\n/g, ' ').replace(/\|/g, '\\|'));
    });
    if (cells.length) rows.push(cells);
  });
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (cells) => `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
  const out = [line(rows[0]), line(Array.from({ length: width }, () => '---'))];
  for (const row of rows.slice(1)) out.push(line(row));
  return out.join('\n');
}

/**
 * The Markdown blocks a node's children make, in order. `ctx.headingShift`
 * pushes every heading this many levels down (capped at six); it is applied
 * HERE, where a heading is made, so a "#" inside a code block or a paragraph
 * is never mistaken for one (review of PR #1017).
 */
function blocks($, node, ctx = {}) {
  const out = [];
  let pending = '';
  const flush = () => {
    const text = cleanInline(pending);
    if (text) out.push(text);
    pending = '';
  };
  $(node).contents().each((_, child) => {
    if (child.type === 'text') { pending += collapse(child.data); return; }
    if (child.type !== 'tag') return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    if (!BLOCK_TAGS.has(tag)) {
      if (tag === 'br') { pending += '\n'; return; }
      const wrapper = $('<span></span>').append($(child).clone());
      pending += inline($, wrapper, ctx);
      return;
    }
    flush();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const text = cleanInline(inline($, child, ctx)).replace(/\n/g, ' ');
      const level = Math.min(6, Number(heading[1]) + (Number(ctx.headingShift) || 0));
      if (text) out.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'ul' || tag === 'ol') {
      const list = listBlock($, child, tag === 'ol', ctx);
      if (list) out.push(list);
    } else if (tag === 'blockquote') {
      const inner = blocks($, child, ctx).join('\n\n');
      if (inner) out.push(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
    } else if (tag === 'pre') {
      const code = $(child).text().replace(/\n+$/, '');
      if (code) out.push(`\`\`\`\n${code}\n\`\`\``);
    } else if (tag === 'hr') {
      out.push('---');
    } else if (tag === 'table') {
      const table = tableBlock($, child, ctx);
      if (table) out.push(table);
    } else {
      out.push(...blocks($, child, ctx));
    }
  });
  flush();
  return out;
}

/**
 * The page's rich text as readable Markdown: headings, lists, quotes, code,
 * tables and links kept; no HTML tags left. Entities are decoded.
 * `headingShift` moves every heading down that many levels (dump nests each
 * note's headings under its "##" title).
 */
function htmlToText(html, { headingShift = 0 } = {}) {
  const source = String(html || '');
  if (!source.trim()) return '';
  const $ = cheerio.load(`<div id="ctx-root">${source}</div>`, null, false);
  return blocks($, $('#ctx-root').get(0), { headingShift }).join('\n\n').trim();
}

// ------------------------------------------------------------ the project named

/**
 * Which project did they mean? Matched on id, then slug, then name (all
 * exactly, the last two ignoring case). `{ ok, project }` or `{ ok: false,
 * message }` naming what was asked for. Two projects sharing a name is said
 * so, never answered with one of them.
 */
function resolveProject(projects, wanted, where = '') {
  const place = where ? ` in ${where}` : '';
  const asked = String(wanted || '').trim();
  if (!asked) return { ok: false, message: 'Which project? Add --project <slug or id>.' };
  const list = Array.isArray(projects) ? projects : [];
  const lower = asked.toLowerCase();
  const byId = list.filter((p) => String(p.id) === asked);
  if (byId.length === 1) return { ok: true, project: byId[0] };
  const bySlug = list.filter((p) => String(p.slug || '').toLowerCase() === lower);
  if (bySlug.length === 1) return { ok: true, project: bySlug[0] };
  const byName = list.filter((p) => String(p.name || '').trim().toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, project: byName[0] };
  if (byName.length > 1) {
    return {
      ok: false,
      message: `More than one project is called ${asked}${place}: ${byName.map((p) => `${p.slug} (${p.id})`).join(', ')}. Name it by slug or id.`,
    };
  }
  return { ok: false, message: `Could not find project ${asked}${place}.` };
}

function projectLabel(project) {
  if (!project) return '';
  const name = String(project.name || '').trim();
  const slug = String(project.slug || '').trim();
  if (name && slug && name.toLowerCase() !== slug.toLowerCase()) return `${name} (${slug})`;
  return name || slug || String(project.id || '');
}

// ------------------------------------------------------------ database errors

/**
 * A database read that failed, as a sentence. "Not there yet" (the table was
 * never created in this database) names the SQL file; anything else says the
 * read failed. Either way the caller exits 2: nothing was read.
 */
function describeReadFailure(error, where) {
  const text = String(error || '');
  const place = where ? ` in ${where}` : '';
  if (/context_entries/.test(text) && /does not exist/i.test(text)) {
    return `The context entries table is not in ${where || 'this database'} yet, so there is nothing to read. `
      + `It is created by ${SQL_FILE}.`;
  }
  return `Could not read the context entries${place}: ${text || 'the database did not say why'}`;
}

// ------------------------------------------------------------ the read rule

const READ_RULE = 'starcaster_readonly_select';

/**
 * Can the read-only login actually see the rows? Production reads under
 * row-level security, where a login with no read rule gets zero rows and no
 * error, so a missing rule would print "No context entries" on every project
 * with exit 0. `answer` is `{ table, rule }` (both booleans) from the
 * database; anything else is "could not tell". `{ ok }` or `{ ok: false,
 * message }`; the caller exits 2 either way it is not ok (review of PR #1017).
 */
function readRuleVerdict(answer, where) {
  const place = where || 'this database';
  if (!answer || typeof answer.table !== 'boolean' || typeof answer.rule !== 'boolean') {
    return { ok: false, message: `Could not tell whether the read-only login may read the context entries in ${place}, so nothing was read.` };
  }
  if (!answer.table) return { ok: false, message: describeReadFailure('relation "context_entries" does not exist', where) };
  if (!answer.rule) {
    return {
      ok: false,
      message: `The read rule is missing in ${place}: the read-only login would see no entries at all, `
        + `so every project would look empty. Run ${SQL_FILE} again (it is safe to re-run) to add it.`,
    };
  }
  return { ok: true };
}

// ------------------------------------------------------------ printing

function day(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value || '');
  // Mountain time, as everything shown to Dane is.
  return d.toLocaleString('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/^(\d\d)\/(\d\d)\/(\d{4}),?/, '$3-$1-$2') + ' MT';
}

function emptyLine(project) {
  return `No context entries in ${projectLabel(project)}`;
}

/**
 * Which tools are switched on to read an entry (SC-826): "reel-spinner", or
 * "read by no tool". Spelled out rather than left blank, so an empty column is
 * never mistaken for one that could not be read.
 */
function usedByText(entry) {
  const uses = Array.isArray(entry.usedBy) ? entry.usedBy : [];
  return uses.length ? uses.join(',') : 'read by no tool';
}

/** One line per entry: id, title, kind, last updated, which tools read it. */
function formatList(entries, project) {
  if (!entries.length) return emptyLine(project);
  return entries
    .map((e) => [e.id, e.title, e.kind, day(e.updatedAt), usedByText(e)].join('\t'))
    .join('\n');
}

function fileLines(entry, savedPath) {
  const lines = [
    `File: ${entry.fileName || '(no name)'}`,
    `Type: ${entry.fileType || '(unknown)'}`,
    `Size: ${entry.fileSize == null ? '(unknown)' : formatFileSize(entry.fileSize)}`,
    `Download: ${entry.fileUrl || '(no address recorded)'}`,
  ];
  if (savedPath) lines.push(`Saved to: ${savedPath}`);
  return lines;
}

/** One entry in full: title, then its text as Markdown, then its file. */
function formatEntry(entry, { project = null, savedPath = '' } = {}) {
  const head = [`# ${entry.title}`, '', ''];
  const meta = [`Kind: ${entry.kind}`, `Updated: ${day(entry.updatedAt)}`, `Id: ${entry.id}`, `Used by: ${usedByText(entry)}`];
  if (project) meta.unshift(`Project: ${projectLabel(project)}`);
  const parts = [head.join('\n') + meta.join('\n')];
  if (entry.kind === 'file') parts.push(fileLines(entry, savedPath).join('\n'));
  const text = htmlToText(entry.bodyHtml);
  if (text) parts.push(text);
  else if (entry.kind === 'note') parts.push('(This note has no text.)');
  return parts.join('\n\n');
}

/**
 * Every note in full, in one Markdown document; files are listed at the end
 * by name and address (their contents are not text this command can print).
 */
function formatDump(entries, project, { saved = {} } = {}) {
  if (!entries.length) return emptyLine(project);
  const notes = entries.filter((e) => e.kind !== 'file');
  const files = entries.filter((e) => e.kind === 'file');
  const out = [
    `# Context for ${projectLabel(project)}`,
    `${notes.length} note${notes.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'}.`,
  ];
  for (const note of notes) {
    // Each note is a "##" section, so its own headings start at "###"
    // (a note's h1 becomes ###), never level with the note titles. The shift
    // happens where headings are made, never by rewriting the text afterwards,
    // which also rewrote "#" lines inside code blocks.
    const text = htmlToText(note.bodyHtml, { headingShift: 2 }) || '(This note has no text.)';
    out.push(`## ${note.title}\n\nUpdated ${day(note.updatedAt)} · id ${note.id} · used by: ${usedByText(note)}\n\n${text}`);
  }
  if (files.length) {
    const lines = ['## Files'];
    for (const f of files) {
      const desc = htmlToText(f.bodyHtml);
      lines.push(`- **${f.title}**: ${f.fileName || '(no name)'}, ${f.fileType || 'unknown type'}, `
        + `${f.fileSize == null ? 'unknown size' : formatFileSize(f.fileSize)}, used by: ${usedByText(f)}. ${f.fileUrl || '(no address recorded)'}`
        + (saved[f.id] ? `\n  Saved to: ${saved[f.id]}` : '')
        + (desc ? `\n  ${desc.replace(/\n/g, '\n  ')}` : ''));
    }
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

// ------------------------------------------------------------ saving files

/** A file name safe to write into the --save folder, kept unique by id. */
function saveName(entry) {
  const base = String(entry.fileName || entry.title || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[_.]+|_+$/g, '') || 'file';
  return `${String(entry.id).slice(0, 8)}_${base}`;
}

/**
 * Is this --save folder outside the repository? Context files are a
 * project's own material and must never be committed by accident (the
 * repository is public).
 */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  // "..ctx" is a folder INSIDE; only ".." itself or "../…" climbs out.
  return !(rel === '..' || rel.startsWith(`..${path.sep}`));
}

/**
 * The folder with every symlink resolved, even though it may not exist yet:
 * the nearest parent that does exist is resolved, and the rest re-appended.
 * Returns that resolved path and the existing parent it started from.
 */
function realFolder(folder) {
  let existing = path.resolve(folder);
  const rest = [];
  while (!fs.existsSync(existing)) {
    const up = path.dirname(existing);
    if (up === existing) break;
    rest.unshift(path.basename(existing));
    existing = up;
  }
  let real = existing;
  try { real = fs.realpathSync(existing); } catch (_) { /* keep as given */ }
  return { real: path.join(real, ...rest), existing: real };
}

module.exports = {
  SQL_FILE,
  htmlToText,
  resolveProject,
  projectLabel,
  describeReadFailure,
  formatList,
  usedByText,
  formatEntry,
  formatDump,
  formatFileSize,
  saveName,
  isInside,
  realFolder,
  readRuleVerdict,
  READ_RULE,
};
