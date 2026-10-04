'use strict';

/**
 * Export a StarCaster site as a WordPress site built with Divi.
 *
 * WHAT IT PRODUCES
 * One WordPress import file (WXR — "WordPress eXtended RSS", the XML that
 * WordPress's own Tools → Import → WordPress reads). It carries:
 *
 *   - every public page, its sections/columns/modules written as Divi
 *     shortcodes ([et_pb_section][et_pb_row][et_pb_column][et_pb_text]…),
 *   - the header and footer as Divi Theme Builder layouts on the default
 *     website template, with copies in the Divi Library as a fallback,
 *   - blog posts with tags and featured images,
 *   - every image those reference, as attachments the importer downloads
 *     (its "Download and import file attachments" box) — the importer then
 *     rewrites the old image addresses in page content to the new ones,
 *   - the main navigation as a WordPress menu ("Main Menu").
 *
 * COMPLETENESS OVER FIDELITY — the same rule Site Import runs the other way
 * (docs/site-import/02-mapping.md). Every module either lands as a Divi module
 * or is named in the report as not exported, with its page and reason.
 * Nothing disappears without being listed; an export the operator hands a
 * client must say what it left behind.
 *
 * Pure: no I/O, no database. `buildWordPressExport(input)` takes plain records
 * and returns { xml, report }. routes/siteExport.js does the reading.
 */

const { slugify } = require('./slugify');

const DIVI_VERSION = '4.27.4';

/* Post ids are fixed and high so the meta that points from one post to
 * another (Theme Builder → template → header layout) survives import: the
 * WordPress importer keeps an item's original id whenever it is free, which
 * on a fresh site it is. Each kind gets its own band. */
const ID = {
  themeBuilder: 900001,
  template: 900002,
  headerLayout: 900003,
  footerLayout: 900004,
  libraryHeader: 900005,
  libraryFooter: 900006,
  pageBase: 901000,
  postBase: 905000,
  menuItemBase: 908000,
  attachmentBase: 910000,
  menuTermId: 9001,
  tagTermBase: 9100,
};

/* ---------------------------------------------------------------- helpers */

// XML 1.0 forbids most control characters; a stray one makes the whole file
// unreadable to the importer, so strip them everywhere text enters the file.
function xmlSafe(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

function escXml(value) {
  return xmlSafe(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cdata(value) {
  return `<![CDATA[${xmlSafe(value).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Divi stores module settings as shortcode attributes, and encodes the three
 * characters that would end the attribute or the shortcode: " → %22,
 * [ → %91, ] → %93. */
function escAttr(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '%22')
    .replace(/\[/g, '%91')
    .replace(/]/g, '%93');
}

/* Content between shortcode tags is HTML, but a literal [ or ] would be read
 * as the start of a shortcode — WordPress renders &#91;/&#93; identically. */
function escContent(html) {
  return String(html ?? '').replace(/\[/g, '&#91;').replace(/]/g, '&#93;');
}

function attrs(map) {
  return Object.entries(map)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join('');
}

function shortcode(tag, attributes, content) {
  const open = `[${tag}${attrs({ _builder_version: DIVI_VERSION, ...attributes })}]`;
  return content === undefined ? `${open}[/${tag}]` : `${open}${content}[/${tag}]`;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function on(value) {
  return value === true || value === 'true' ? 'on' : 'off';
}

function looksLikeHtml(text) {
  return /<[a-z!/][^>]*>/i.test(String(text || ''));
}

function wpDate(value) {
  const d = value ? new Date(value) : new Date(0);
  const safe = Number.isNaN(d.getTime()) ? new Date(0) : d;
  return safe.toISOString().replace('T', ' ').slice(0, 19);
}

function rfc822(value) {
  const d = value ? new Date(value) : new Date(0);
  return (Number.isNaN(d.getTime()) ? new Date(0) : d).toUTCString();
}

/* ------------------------------------------------------------- columns */

const LAYOUT_RATIOS = {
  single: [1],
  'two-column': [1, 1], 'two-four': [2, 4], 'four-two': [4, 2],
  'one-five': [1, 5], 'five-one': [5, 1], 'one-three': [1, 3], 'three-one': [3, 1],
  'two-three': [2, 3], 'three-two': [3, 2],
  'three-column': [1, 1, 1], 'one-four-one': [1, 4, 1], 'one-three-one': [1, 3, 1],
  'one-two-one': [1, 2, 1], 'two-one-one': [2, 1, 1], 'one-one-two': [1, 1, 2],
  'three-one-one': [3, 1, 1], 'one-one-three': [1, 1, 3],
  'four-column': [1, 1, 1, 1], 'five-column': [1, 1, 1, 1, 1], 'six-column': [1, 1, 1, 1, 1, 1],
};

// The builder's own column keys (builder-template.ts LAYOUT_SPECS): past three
// columns they EXTEND the three-column set. A module whose column is not one
// of these lands in the first, the same rule the builder applies
// (resolveModuleColumnForLayout).
const COLUMN_KEYS = {
  1: ['main'],
  2: ['left', 'right'],
  3: ['left', 'center', 'right'],
  4: ['left', 'center', 'right', 'col4'],
  5: ['left', 'center', 'right', 'col4', 'col5'],
  6: ['left', 'center', 'right', 'col4', 'col5', 'col6'],
};

function columnKeysFor(count) {
  return COLUMN_KEYS[count] || COLUMN_KEYS[1];
}

// The column widths Divi offers. Every StarCaster layout reduces to these
// exactly; an unknown layout falls back to equal columns.
const DIVI_FRACTIONS = new Set(['4_4', '1_2', '1_3', '2_3', '1_4', '3_4', '1_5', '2_5', '3_5', '4_5', '1_6', '5_6']);

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function diviColumnTypes(layout) {
  const ratios = LAYOUT_RATIOS[layout] || [1];
  const total = ratios.reduce((s, r) => s + r, 0);
  const types = ratios.map((r) => {
    if (r === total) return '4_4';
    const g = gcd(r, total);
    return `${r / g}_${total / g}`;
  });
  if (types.every((t) => DIVI_FRACTIONS.has(t))) return types;
  const n = ratios.length;
  return Array.from({ length: n }, () => (n === 1 ? '4_4' : `1_${n}`));
}

/* ------------------------------------------------------------- images */

class MediaRegistry {
  constructor(origin) {
    this.origin = String(origin || '').replace(/\/+$/, '');
    this.byUrl = new Map();
  }

  absolute(url) {
    const value = String(url || '').trim();
    if (!value || value.startsWith('data:')) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/') && this.origin) return `${this.origin}${value}`;
    return '';
  }

  /** Register an image and return the absolute URL to write into content. */
  add(url, alt) {
    const abs = this.absolute(url);
    if (!abs) return String(url || '');
    if (!this.byUrl.has(abs)) {
      this.byUrl.set(abs, { id: ID.attachmentBase + this.byUrl.size, url: abs, alt: String(alt || '') });
    }
    return abs;
  }

  idFor(url) {
    const abs = this.absolute(url);
    return abs && this.byUrl.has(abs) ? this.byUrl.get(abs).id : 0;
  }

  /** Register every <img src> in an HTML string and make each absolute. */
  rewriteHtml(html) {
    return String(html || '').replace(/(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi, (whole, pre, quote, src) => {
      const abs = this.add(src);
      return `${pre}${quote}${abs}${quote}`;
    });
  }

  list() {
    return [...this.byUrl.values()];
  }
}

/* ------------------------------------------------------------- modules */

const SOCIAL_NETWORKS = {
  facebook: 'facebook', x: 'twitter', twitter: 'twitter', linkedin: 'linkedin',
  instagram: 'instagram', youtube: 'youtube', pinterest: 'pinterest', tiktok: 'tiktok',
  vimeo: 'vimeo', tumblr: 'tumblr', github: 'github', skype: 'skype', dribbble: 'dribbble',
  flickr: 'flikr', rss: 'rss', email: 'email', whatsapp: 'whatsapp', telegram: 'telegram',
  snapchat: 'snapchat', reddit: 'reddit', yelp: 'yelp', discord: 'discord',
};

/* The label is often a handle ("DelrayTennis"), so the address and the icon
 * file are read too — facebook.com and facebook.svg both say Facebook. */
const SOCIAL_HOSTS = {
  'facebook.com': 'facebook', 'fb.com': 'facebook', 'x.com': 'twitter', 'twitter.com': 'twitter',
  'linkedin.com': 'linkedin', 'instagram.com': 'instagram', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
  'pinterest.com': 'pinterest', 'tiktok.com': 'tiktok', 'vimeo.com': 'vimeo', 'github.com': 'github',
  'yelp.com': 'yelp', 'reddit.com': 'reddit', 'discord.gg': 'discord', 'discord.com': 'discord',
  'wa.me': 'whatsapp', 't.me': 'telegram', 'snapchat.com': 'snapchat', 'tumblr.com': 'tumblr',
  'dribbble.com': 'dribbble', 'flickr.com': 'flikr',
};

function socialNetworkFor(item) {
  const byLabel = SOCIAL_NETWORKS[slugify(item?.label).replace(/-/g, '')];
  if (byLabel) return byLabel;
  const href = String(item?.href || '');
  if (/^mailto:/i.test(href)) return 'email';
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
    if (SOCIAL_HOSTS[host]) return SOCIAL_HOSTS[host];
  } catch { /* not a URL — try the icon */ }
  const icon = String(item?.iconUrl || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase();
  return SOCIAL_NETWORKS[icon] || '';
}

/* Modules that only mean something inside StarCaster: admin tools, polls,
 * live data feeds with no WordPress counterpart, effects. They are reported,
 * never written as a placeholder — a placeholder would ship to the client's
 * visitors (CLAUDE.md landmine 16). */
const NOT_EXPORTED_REASON = {
  galaxy: 'animated effect with no Divi equivalent',
  confetti: 'animated effect with no Divi equivalent',
  'speech-bubble': 'interactive StarCaster effect',
  'floating-image': 'overlay positioning has no Divi equivalent',
  'headline-rotator': 'animated effect with no Divi equivalent',
  reminder: 'StarCaster reminder sign-up',
  'player-portal': 'StarCaster member login',
  merch: 'StarCaster merch storefront',
  'current-poll': 'StarCaster polls', 'previous-results': 'StarCaster polls',
  'poll-category-list': 'StarCaster polls', 'social-share': 'StarCaster poll sharing',
  'crm-contacts-table': 'admin tool', 'media-manager': 'admin tool',
  'event-manager': 'admin tool', 'blog-post-create': 'admin tool',
  'blog-post-manager': 'admin tool', 'blog-category-manager': 'admin tool',
  'blog-card-manager': 'admin tool', 'bug-report': 'admin tool',
  'site-search-results': 'WordPress shows its own search results page — the Search module sends visitors there',
  'blog-search-results': 'WordPress shows its own search results page — the Search module sends visitors there',
};

function moduleLabel(mod) {
  return String(mod?.name || '').trim() || String(mod?.type || 'module');
}

/**
 * One StarCaster module → Divi shortcode string, or null when it does not
 * export. `note(kind, mod, reason)` records it for the report.
 */
function moduleToDivi(mod, ctx) {
  const s = mod.settings || {};
  const type = String(mod.type || 'text');
  const media = ctx.media;

  switch (type) {
    case 'text':
    case 'textarea':
    case 'headline':
    case 'pitch': {
      const html = looksLikeHtml(mod.text) ? mod.text : `<p>${escHtml(mod.text)}</p>`;
      if (!String(mod.text || '').trim()) return null;
      return shortcode('et_pb_text', {}, escContent(media.rewriteHtml(html)));
    }
    case 'heading':
    case 'header': {
      if (!String(mod.text || '').trim()) return null;
      const level = /^h[1-6]$/.test(String(s.level)) ? s.level : 'h2';
      const inner = looksLikeHtml(mod.text) ? mod.text : escHtml(mod.text);
      const align = ['left', 'center', 'right'].includes(s.textAlign) ? s.textAlign : '';
      return shortcode('et_pb_text', { text_orientation: align },
        escContent(`<${level}>${media.rewriteHtml(inner)}</${level}>`));
    }
    case 'quote': {
      if (!String(mod.text || '').trim()) return null;
      const inner = looksLikeHtml(mod.text) ? mod.text : `<p>${escHtml(mod.text)}</p>`;
      return shortcode('et_pb_text', {}, escContent(`<blockquote>${media.rewriteHtml(inner)}</blockquote>`));
    }
    case 'code': {
      if (!String(mod.text || '').trim()) return null;
      return shortcode('et_pb_code', {}, escContent(media.rewriteHtml(mod.text)));
    }
    case 'image': {
      if (!s.url) return null;
      return shortcode('et_pb_image', {
        src: media.add(s.url, s.alt),
        alt: s.alt,
        title_text: s.alt,
        url: s.linkUrl,
        url_new_window: s.linkUrl ? on(s.newTab) : '',
        align: ['left', 'center', 'right'].includes(s.alignment) ? s.alignment : 'center',
      });
    }
    case 'button': {
      const label = String(mod.text || '').trim();
      if (!label) return null;
      const bg = s.buttonBackgroundColor || s.buttonColor;
      return shortcode('et_pb_button', {
        button_text: label,
        button_url: s.href,
        url_new_window: on(s.newTab),
        button_alignment: ['left', 'center', 'right'].includes(s.alignment) ? s.alignment : 'left',
        custom_button: 'on',
        button_bg_color: bg,
        button_text_color: s.textColor,
        button_border_color: s.borderColor,
        button_border_radius: s.borderRadius ? `${parseInt(s.borderRadius, 10) || 0}px` : '',
        button_bg_color_hover: s.buttonHoverColor,
        button_text_color_hover: s.textHoverColor,
      }, '');
    }
    case 'video': {
      if (!s.url) return null;
      return shortcode('et_pb_video', { src: s.url });
    }
    case 'navigation':
    case 'tractor-nav': {
      // Divi's Menu module with no menu chosen shows the theme's Primary
      // Menu, which is where the exported "Main Menu" goes — so the module
      // works the moment the menu is assigned, without an id that the
      // importer would renumber.
      return shortcode('et_pb_menu', { menu_style: 'left_aligned', logo: ctx.logoUrl ? media.add(ctx.logoUrl) : '' });
    }
    case 'social': {
      const items = parseJson(s.socialItems, []);
      const networks = [];
      for (const item of Array.isArray(items) ? items : []) {
        const network = socialNetworkFor(item);
        if (!network || !item?.href) {
          ctx.note(mod, `social link "${item?.label || '?'}" — Divi has no "${item?.label || '?'}" network`);
          continue;
        }
        networks.push(shortcode('et_pb_social_media_follow_network', {
          social_network: network, url: item.href,
        }, escContent(network)));
      }
      if (!networks.length) return null;
      return shortcode('et_pb_social_media_follow', {
        url_new_window: 'on',
        icon_color: s.iconColor,
        module_alignment: ['left', 'center', 'right'].includes(s.alignment) ? s.alignment : '',
      }, networks.join(''));
    }
    case 'carousel': {
      const items = parseJson(s.items, []);
      const slides = (Array.isArray(items) ? items : [])
        .filter((it) => it && (it.imageUrl || it.title || it.body))
        .map((it) => shortcode('et_pb_slide', {
          heading: it.title,
          background_image: it.imageUrl ? media.add(it.imageUrl, it.imageAlt) : '',
          button_text: it.linkUrl ? (it.linkLabel || 'Learn more') : '',
          button_link: it.linkUrl,
        }, it.body ? escContent(`<p>${escHtml(it.body)}</p>`) : ''));
      if (!slides.length) return null;
      return shortcode('et_pb_slider', { show_arrows: 'on', show_pagination: 'on', auto: 'on',
        auto_speed: s.intervalMs || '5000' }, slides.join(''));
    }
    case 'feature-cards': {
      const cards = parseJson(s.cards, []);
      const blurbs = (Array.isArray(cards) ? cards : [])
        .filter((c) => c && (c.title || c.body || c.imageUrl))
        .map((c) => shortcode('et_pb_blurb', {
          title: c.title,
          url: c.linkUrl,
          image: c.imageUrl ? media.add(c.imageUrl, c.imageAlt) : '',
          alt: c.imageAlt,
        }, c.body ? escContent(`<p>${escHtml(c.body)}</p>`) : ''));
      if (!blurbs.length) return null;
      return blurbs.join('');
    }
    case 'program-list': {
      const html = programsToHtml(parseJson(s.programs, []));
      if (!html) return null;
      return shortcode('et_pb_text', {}, escContent(html));
    }
    case 'table': {
      const html = tableToHtml(s);
      if (!html) return null;
      return shortcode('et_pb_text', {}, escContent(media.rewriteHtml(html)));
    }
    case 'contact-form':
    case 'crm-form': {
      // A standard Divi contact form: it emails the site admin. The CRM link
      // (where StarCaster files a submission) cannot come along, and the
      // report says so.
      ctx.note(mod, 'rebuilt as a standard Divi contact form — submissions go to the WordPress admin email, not the StarCaster CRM', 'changed');
      const field = (id, title, fieldType) => shortcode('et_pb_contact_field',
        { field_id: id, field_title: title, field_type: fieldType, fullwidth_field: fieldType === 'text' ? 'on' : 'off' }, '');
      return shortcode('et_pb_contact_form', { title: s.title || '', email: '' },
        field('Name', 'Name', 'input') + field('Email', 'Email Address', 'email') + field('Message', 'Message', 'text'));
    }
    case 'blog-post-list':
    case 'blog-latest-posts':
      return shortcode('et_pb_blog', {
        posts_number: s.postsPerPage || '9',
        fullwidth: s.layout === 'list' ? 'on' : 'off',
        show_thumbnail: 'on', show_excerpt: 'on', show_pagination: 'on',
      });
    case 'blog-search':
    case 'site-search':
      return shortcode('et_pb_search', {});
    default: {
      const reason = NOT_EXPORTED_REASON[type]
        || (type.startsWith('admin-') ? 'admin tool'
          : type.startsWith('blog-') ? 'StarCaster blog feature with no Divi module — WordPress shows this on the post itself'
            : 'no Divi equivalent');
      ctx.note(mod, reason);
      return null;
    }
  }
}

/* A club's class schedule as plain headings, times and prices — the card
 * styling stays behind, the information comes along. */
function programsToHtml(programs) {
  const list = (Array.isArray(programs) ? programs : []).filter((p) => p && String(p.title || '').trim());
  return list.map((p) => {
    let html = `<h3>${escHtml(p.title)}</h3>`;
    const sub = [p.subtitle, p.levelBadge].map((v) => String(v || '').trim()).filter(Boolean);
    if (sub.length) html += `<p><em>${escHtml(sub.join(' · '))}</em></p>`;
    const sessions = (Array.isArray(p.sessions) ? p.sessions : [])
      .map((x) => [x?.day, [x?.startTime, x?.endTime].filter(Boolean).join('–')].filter(Boolean).join(' '))
      .filter(Boolean);
    if (sessions.length) html += `<ul>${sessions.map((x) => `<li>${escHtml(x)}</li>`).join('')}</ul>`;
    const prices = (Array.isArray(p.pricing) ? p.pricing : [])
      .map((x) => [x?.amount, x?.appliesTo].filter(Boolean).join(' — ')).filter(Boolean);
    if (prices.length) html += `<p>${prices.map(escHtml).join('<br />')}</p>`;
    const bullets = (Array.isArray(p.bullets) ? p.bullets : [])
      .map((b) => (typeof b === 'string' ? b : b?.text)).filter(Boolean);
    if (bullets.length) html += `<ul>${bullets.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>`;
    return html;
  }).join('');
}

function cellToHtml(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return looksLikeHtml(cell) ? cell : escHtml(cell);
  if (Array.isArray(cell)) {
    return cell.map((m) => {
      if (!m || typeof m !== 'object') return '';
      const text = String(m.text || '');
      if (m.type === 'button' && m.settings?.href) {
        return `<a href="${escHtml(m.settings.href)}">${escHtml(text)}</a>`;
      }
      if (m.type === 'image' && m.settings?.url) {
        return `<img src="${escHtml(m.settings.url)}" alt="${escHtml(m.settings.alt || '')}" />`;
      }
      return looksLikeHtml(text) ? text : escHtml(text);
    }).join(' ');
  }
  if (typeof cell === 'object') return cellToHtml(cell.text ?? cell.value ?? '');
  return escHtml(String(cell));
}

function tableToHtml(s) {
  const data = parseJson(s.tableData, null);
  if (!data || typeof data !== 'object') return '';
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const cells = data.cells && typeof data.cells === 'object' ? data.cells : {};
  let rows = parseInt(s.rowsCount, 10) || 0;
  let cols = headers.length || parseInt(s.columns, 10) || 0;
  for (const key of Object.keys(cells)) {
    const [r, c] = key.split('-').map((n) => parseInt(n, 10));
    if (Number.isFinite(r)) rows = Math.max(rows, r + 1);
    if (Number.isFinite(c)) cols = Math.max(cols, c + 1);
  }
  if (!rows || !cols) return '';
  const showHeaders = headers.some((h) => String(h || '').trim() && !/^column \d+$/i.test(String(h).trim()));
  let html = '<table>';
  if (s.caption) html += `<caption>${escHtml(s.caption)}</caption>`;
  if (showHeaders) {
    html += `<thead><tr>${Array.from({ length: cols }, (_, c) => `<th>${escHtml(headers[c] || '')}</th>`).join('')}</tr></thead>`;
  }
  html += '<tbody>';
  for (let r = 0; r < rows; r += 1) {
    html += `<tr>${Array.from({ length: cols }, (_, c) => `<td>${cellToHtml(cells[`${r}-${c}`])}</td>`).join('')}</tr>`;
  }
  return `${html}</tbody></table>`;
}

/* ------------------------------------------------------------- sections */

function sectionToDivi(section, ctx) {
  const layout = String(section.layout || 'single');
  const types = diviColumnTypes(layout);
  const keys = columnKeysFor(types.length);
  const byColumn = new Map(keys.map((k) => [k, []]));
  for (const mod of Array.isArray(section.modules) ? section.modules : []) {
    const key = byColumn.has(mod?.column) ? mod.column : keys[0];
    byColumn.get(key).push(mod);
  }

  let moduleCount = 0;
  const columns = keys.map((key, i) => {
    const parts = [];
    for (const mod of byColumn.get(key)) {
      const out = moduleToDivi(mod, ctx);
      if (out) { parts.push(out); moduleCount += 1; }
    }
    const bg = section.cellBackgrounds?.[key];
    return shortcode('et_pb_column', {
      type: types[i],
      background_color: bg?.mode === 'color' ? bg.color : '',
    }, parts.join(''));
  });

  const bg = section.background || {};
  const sectionAttrs = {
    fb_built: '1',
    admin_label: section.title,
    background_color: bg.mode === 'color' || bg.mode === 'gradient' ? bg.color : '',
    use_background_color_gradient: bg.mode === 'gradient' ? 'on' : '',
    background_color_gradient_stops: bg.mode === 'gradient' && bg.color && bg.color2 ? `${bg.color} 0%|${bg.color2} 100%` : '',
    background_image: bg.mode === 'image' && bg.imageUrl ? ctx.media.add(bg.imageUrl) : '',
    // Divi's order is phone|tablet|desktop.
    disabled_on: on(section.mobileHidden) === 'off' && on(section.desktopHidden) === 'off'
      ? '' : `${on(section.mobileHidden)}|off|${on(section.desktopHidden)}`,
  };
  const fullWidth = section.widthMode === 'full-width';
  const row = shortcode('et_pb_row', {
    column_structure: types.join(','),
    width: fullWidth ? '100%' : '',
    max_width: fullWidth ? '100%' : '',
  }, columns.join(''));
  return { code: shortcode('et_pb_section', sectionAttrs, row), moduleCount };
}

function sectionsToDivi(sections, ctx) {
  let modules = 0;
  const code = (Array.isArray(sections) ? sections : [])
    .filter((s) => s && typeof s === 'object')
    .map((s) => { const r = sectionToDivi(s, ctx); modules += r.moduleCount; return r.code; })
    .join('');
  return { code, modules };
}

/* ------------------------------------------------------------- frame */

function isFrame(section) {
  return Boolean(section && section.canonical === true && section.savedSectionId);
}

/**
 * Header = the linked (canonical) sections before a page's own content,
 * footer = the linked sections after it. Read from the home page, falling
 * back to the first page that has any — every page carries the same copies,
 * kept in step by canonical propagation.
 */
function splitFrame(pages) {
  const ordered = [...pages].sort((a, b) => (isHomePage(b) ? 1 : 0) - (isHomePage(a) ? 1 : 0));
  for (const page of ordered) {
    const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];
    if (!sections.some(isFrame)) continue;
    const firstBody = sections.findIndex((s) => !isFrame(s));
    if (firstBody === -1) return { header: sections, footer: [] };
    let lastBody = sections.length - 1;
    while (lastBody >= 0 && isFrame(sections[lastBody])) lastBody -= 1;
    return {
      header: sections.slice(0, firstBody).filter(isFrame),
      footer: sections.slice(lastBody + 1).filter(isFrame),
    };
  }
  return { header: [], footer: [] };
}

function isHomePage(page) {
  const slug = String(page?.slug || '').trim().toLowerCase();
  return slug === '' || slug === 'home';
}

function findMenu(pages, frame) {
  const scan = (sections) => {
    for (const s of sections || []) {
      for (const m of s?.modules || []) {
        if (m?.type === 'navigation') {
          const items = parseJson(m.settings?.navItems, []);
          if (Array.isArray(items) && items.length) return items;
        }
      }
    }
    return null;
  };
  return scan(frame.header) || scan(frame.footer)
    || pages.map((p) => scan(p.layoutSections)).find(Boolean) || [];
}

/* ------------------------------------------------------------- XML items */

function meta(key, value) {
  return `\t\t<wp:postmeta>\n\t\t\t<wp:meta_key>${cdata(key)}</wp:meta_key>\n\t\t\t<wp:meta_value>${cdata(value)}</wp:meta_value>\n\t\t</wp:postmeta>\n`;
}

function item({
  id, title, slug, type, status = 'publish', content = '', excerpt = '', date, link = '',
  parent = 0, order = 0, metas = [], categories = [], attachmentUrl = '', author = 'starcaster',
}) {
  let out = '\t<item>\n';
  out += `\t\t<title>${escXml(title)}</title>\n`;
  out += `\t\t<link>${escXml(link)}</link>\n`;
  out += `\t\t<pubDate>${rfc822(date)}</pubDate>\n`;
  out += `\t\t<dc:creator>${cdata(author)}</dc:creator>\n`;
  out += `\t\t<guid isPermaLink="false">${escXml(attachmentUrl || `starcaster-export-${id}`)}</guid>\n`;
  out += '\t\t<description></description>\n';
  out += `\t\t<content:encoded>${cdata(content)}</content:encoded>\n`;
  out += `\t\t<excerpt:encoded>${cdata(excerpt)}</excerpt:encoded>\n`;
  out += `\t\t<wp:post_id>${id}</wp:post_id>\n`;
  out += `\t\t<wp:post_date>${cdata(wpDate(date))}</wp:post_date>\n`;
  out += `\t\t<wp:post_date_gmt>${cdata(wpDate(date))}</wp:post_date_gmt>\n`;
  out += '\t\t<wp:comment_status>closed</wp:comment_status>\n';
  out += '\t\t<wp:ping_status>closed</wp:ping_status>\n';
  out += `\t\t<wp:post_name>${cdata(slug)}</wp:post_name>\n`;
  out += `\t\t<wp:status>${cdata(status)}</wp:status>\n`;
  out += `\t\t<wp:post_parent>${parent}</wp:post_parent>\n`;
  out += `\t\t<wp:menu_order>${order}</wp:menu_order>\n`;
  out += `\t\t<wp:post_type>${cdata(type)}</wp:post_type>\n`;
  out += '\t\t<wp:post_password></wp:post_password>\n';
  out += '\t\t<wp:is_sticky>0</wp:is_sticky>\n';
  if (attachmentUrl) out += `\t\t<wp:attachment_url>${cdata(attachmentUrl)}</wp:attachment_url>\n`;
  for (const c of categories) {
    out += `\t\t<category domain="${escXml(c.domain)}" nicename="${escXml(c.nicename)}">${cdata(c.name)}</category>\n`;
  }
  for (const [k, v] of metas) out += meta(k, v);
  out += '\t</item>\n';
  return out;
}

const DIVI_PAGE_META = (postType) => [
  ['_et_pb_use_builder', 'on'],
  ['_et_pb_old_content', ''],
  ['_et_pb_page_layout', 'et_no_sidebar'],
  ['_et_pb_side_nav', 'off'],
  ['_et_pb_built_for_post_type', postType],
  ['_et_pb_show_page_creation', 'off'],
  ['_et_builder_version', `VB|Divi|${DIVI_VERSION}`],
];

/* ------------------------------------------------------------- entry point */

/**
 * @param {object} input
 * @param {{name?: string, slug?: string, siteUrl?: string, description?: string, logoUrl?: string}} input.project
 * @param {Array} input.pages  builder pages as lib/builderPagesStore.js rowToPage returns them
 * @param {Array} [input.posts] blog posts as lib/blogPostsStore.js returns them
 * @param {string} [input.assetOrigin] origin used to make site-relative image paths absolute
 * @param {Date|string} [input.now]
 * @returns {{ xml: string, report: object }}
 */
function buildWordPressExport(input) {
  const project = input?.project || {};
  const now = input?.now ? new Date(input.now) : new Date();
  const siteUrl = String(project.siteUrl || input?.assetOrigin || '').replace(/\/+$/, '');
  const media = new MediaRegistry(input?.assetOrigin || siteUrl);
  const allPages = Array.isArray(input?.pages) ? input.pages : [];
  const posts = Array.isArray(input?.posts) ? input.posts : [];

  const report = {
    generatedAt: now.toISOString(),
    project: { name: project.name || '', slug: project.slug || '' },
    pages: [],
    pagesLeftOut: [],
    posts: { exported: 0, drafts: 0 },
    header: { sections: 0, modules: 0 },
    footer: { sections: 0, modules: 0 },
    menu: { items: 0 },
    images: 0,
    notExported: [],
    changed: [],
    homePageSlug: '',
  };

  // Admin and private pages are StarCaster's own tools, not the client's site.
  const pages = [];
  for (const page of allPages) {
    const slug = String(page?.slug || '').trim().toLowerCase();
    const isAdmin = slug === 'admin' || slug.startsWith('admin-')
      || ['blog-post-edit', 'blog-create-post', 'blog-post-manager', 'blog-category-manager', 'event-manager', 'crm'].includes(slug);
    if (isAdmin) { report.pagesLeftOut.push({ name: page.name || slug, slug, reason: 'admin page' }); continue; }
    if (page?.isPrivate === true) { report.pagesLeftOut.push({ name: page.name || slug, slug, reason: 'private page' }); continue; }
    pages.push(page);
  }

  const makeCtx = (where) => ({
    media,
    logoUrl: project.logoUrl || '',
    note(mod, reason, kind = 'notExported') {
      const entry = { where, module: moduleLabel(mod), type: String(mod?.type || ''), reason };
      (kind === 'changed' ? report.changed : report.notExported).push(entry);
    },
  });

  /* Header and footer → Theme Builder. */
  const frame = splitFrame(pages);
  const headerOut = sectionsToDivi(frame.header, makeCtx('Header'));
  const footerOut = sectionsToDivi(frame.footer, makeCtx('Footer'));
  report.header = { sections: frame.header.length, modules: headerOut.modules };
  report.footer = { sections: frame.footer.length, modules: footerOut.modules };

  /* Pages — body only when there is a frame; the frame is the Theme Builder's. */
  const usedSlugs = new Set();
  const pageItems = [];
  const pageIdBySlug = new Map();
  pages.forEach((page, index) => {
    const name = String(page.name || '').trim() || 'Untitled page';
    let slug = isHomePage(page) ? 'home' : slugify(page.slug || name) || `page-${index + 1}`;
    while (usedSlugs.has(slug)) slug = `${slug}-${index + 1}`;
    usedSlugs.add(slug);
    if (isHomePage(page) && !report.homePageSlug) report.homePageSlug = slug;

    const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];
    const body = sections.filter((s) => !isFrame(s));
    const out = sectionsToDivi(body, makeCtx(name));
    const id = ID.pageBase + index;
    pageIdBySlug.set(String(page.slug || '').trim().toLowerCase(), id);
    const status = page.isPublished === false ? 'draft' : 'publish';
    report.pages.push({ name, slug, status, sections: body.length, modules: out.modules });
    pageItems.push(item({
      id, title: name, slug, type: 'page', status,
      content: out.code, date: page.createdAt || page.updatedAt, order: index,
      link: siteUrl ? `${siteUrl}/${slug}/` : '',
      metas: DIVI_PAGE_META('page'),
    }));
  });

  /* Blog posts. */
  const tagTerms = new Map();
  const postItems = posts.map((post, index) => {
    const tags = (Array.isArray(post.tags) ? post.tags : []).map((t) => String(t || '').trim()).filter(Boolean);
    for (const t of tags) if (!tagTerms.has(slugify(t))) tagTerms.set(slugify(t), t);
    const status = post.status === 'published' ? 'publish' : 'draft';
    if (status === 'publish') report.posts.exported += 1; else report.posts.drafts += 1;
    const metas = [];
    if (post.featuredImageUrl) {
      media.add(post.featuredImageUrl, post.title);
      metas.push(['_thumbnail_id', String(media.idFor(post.featuredImageUrl))]);
    }
    if (post.seoTitle) metas.push(['_yoast_wpseo_title', post.seoTitle]);
    if (post.seoDescription) metas.push(['_yoast_wpseo_metadesc', post.seoDescription]);
    return item({
      id: ID.postBase + index,
      title: post.title || 'Untitled post',
      slug: slugify(post.slug || post.title) || `post-${index + 1}`,
      type: 'post', status,
      content: media.rewriteHtml(post.body || ''),
      excerpt: post.excerpt || '',
      date: post.publishedAt || post.createdAt,
      author: 'starcaster',
      categories: tags.map((t) => ({ domain: 'post_tag', nicename: slugify(t), name: t })),
      metas,
    });
  });

  /* Menu. Every item is a custom link: StarCaster hrefs are paths like
   * /about, which resolve to the same-slug WordPress page. */
  const navItems = findMenu(pages, frame);
  const menuIdByNavId = new Map();
  const orderedNav = [
    ...navItems.filter((n) => !n?.parentId),
    ...navItems.filter((n) => n?.parentId),
  ].filter((n) => n && n.label);
  const menuItems = orderedNav.map((nav, index) => {
    const id = ID.menuItemBase + index;
    menuIdByNavId.set(nav.id, id);
    const href = String(nav.href || nav.url || '#');
    return item({
      id, title: nav.label, slug: `menu-item-${id}`, type: 'nav_menu_item', order: index + 1,
      date: now,
      categories: [{ domain: 'nav_menu', nicename: 'main-menu', name: 'Main Menu' }],
      metas: [
        ['_menu_item_type', 'custom'],
        ['_menu_item_menu_item_parent', String(menuIdByNavId.get(nav.parentId) || 0)],
        ['_menu_item_object_id', String(id)],
        ['_menu_item_object', 'custom'],
        ['_menu_item_target', nav.target === '_blank' ? '_blank' : ''],
        ['_menu_item_classes', 'a:1:{i:0;s:0:"";}'],
        ['_menu_item_xfn', ''],
        ['_menu_item_url', href],
      ],
    });
  });
  report.menu.items = menuItems.length;

  /* Divi Theme Builder: one default template using the header and footer
   * layouts, registered on the live Theme Builder. Copies also go to the
   * Divi Library so they can be loaded by hand if a Divi version reads the
   * Theme Builder differently. */
  const frameItems = [];
  const hasHeader = Boolean(headerOut.code);
  const hasFooter = Boolean(footerOut.code);
  if (hasHeader || hasFooter) {
    const layoutMeta = [
      ['_et_pb_use_builder', 'on'],
      ['_et_pb_show_page_creation', 'off'],
      ['_et_builder_version', `VB|Divi|${DIVI_VERSION}`],
    ];
    if (hasHeader) {
      frameItems.push(item({ id: ID.headerLayout, title: 'StarCaster Header', slug: 'starcaster-header',
        type: 'et_header_layout', content: headerOut.code, date: now, metas: layoutMeta }));
      frameItems.push(item({ id: ID.libraryHeader, title: 'StarCaster Header', slug: 'starcaster-header-library',
        type: 'et_pb_layout', content: headerOut.code, date: now,
        categories: [{ domain: 'layout_type', nicename: 'layout', name: 'layout' }, { domain: 'scope', nicename: 'non_global', name: 'non_global' }, { domain: 'module_width', nicename: 'regular', name: 'regular' }],
        metas: [['_et_pb_predefined_layout', 'off'], ['_et_pb_built_for_post_type', 'page'], ...layoutMeta] }));
    }
    if (hasFooter) {
      frameItems.push(item({ id: ID.footerLayout, title: 'StarCaster Footer', slug: 'starcaster-footer',
        type: 'et_footer_layout', content: footerOut.code, date: now, metas: layoutMeta }));
      frameItems.push(item({ id: ID.libraryFooter, title: 'StarCaster Footer', slug: 'starcaster-footer-library',
        type: 'et_pb_layout', content: footerOut.code, date: now,
        categories: [{ domain: 'layout_type', nicename: 'layout', name: 'layout' }, { domain: 'scope', nicename: 'non_global', name: 'non_global' }, { domain: 'module_width', nicename: 'regular', name: 'regular' }],
        metas: [['_et_pb_predefined_layout', 'off'], ['_et_pb_built_for_post_type', 'page'], ...layoutMeta] }));
    }
    frameItems.push(item({
      id: ID.template, title: 'Default Website Template', slug: 'starcaster-default-template',
      type: 'et_template', date: now,
      metas: [
        ['_et_default', '1'],
        ['_et_enabled', '1'],
        ['_et_header_layout_id', hasHeader ? String(ID.headerLayout) : '0'],
        ['_et_header_layout_enabled', '1'],
        ['_et_body_layout_id', '0'],
        ['_et_body_layout_enabled', '1'],
        ['_et_footer_layout_id', hasFooter ? String(ID.footerLayout) : '0'],
        ['_et_footer_layout_enabled', '1'],
      ],
    }));
    frameItems.push(item({
      id: ID.themeBuilder, title: 'Theme Builder', slug: 'theme-builder', type: 'et_theme_builder', date: now,
      metas: [['_et_template', String(ID.template)]],
    }));
  }

  report.images = media.list().length;
  const attachmentItems = media.list().map((m) => {
    const file = decodeURIComponent(m.url.split('?')[0].split('/').pop() || 'image');
    const title = file.replace(/\.[a-z0-9]+$/i, '').replace(/^\d{10,}_/, '').replace(/[-_]+/g, ' ').trim() || 'image';
    return item({
      id: m.id, title, slug: slugify(`${title}-${m.id}`), type: 'attachment', status: 'inherit',
      date: now, attachmentUrl: m.url, link: m.url,
      metas: m.alt ? [['_wp_attachment_image_alt', m.alt]] : [],
    });
  });

  /* Assemble. Attachments first so the importer has downloaded every image
   * before it reads the pages whose addresses it rewrites. */
  const terms = [
    `\t<wp:term><wp:term_id>${ID.menuTermId}</wp:term_id><wp:term_taxonomy>nav_menu</wp:term_taxonomy><wp:term_slug>${cdata('main-menu')}</wp:term_slug><wp:term_name>${cdata('Main Menu')}</wp:term_name></wp:term>\n`,
    ...[...tagTerms.entries()].map(([slug, name], i) =>
      `\t<wp:tag><wp:term_id>${ID.tagTermBase + i}</wp:term_id><wp:tag_slug>${cdata(slug)}</wp:tag_slug><wp:tag_name>${cdata(name)}</wp:tag_name></wp:tag>\n`),
  ];
  if (!menuItems.length) terms.shift();

  const xml = '<?xml version="1.0" encoding="UTF-8" ?>\n'
    + '<!-- WordPress import file exported by StarCaster. Import with Tools → Import → WordPress, with the Divi theme active. -->\n'
    + '<rss version="2.0"\n'
    + '\txmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"\n'
    + '\txmlns:content="http://purl.org/rss/1.0/modules/content/"\n'
    + '\txmlns:wfw="http://wellformedweb.org/CommentAPI/"\n'
    + '\txmlns:dc="http://purl.org/dc/elements/1.1/"\n'
    + '\txmlns:wp="http://wordpress.org/export/1.2/"\n>\n'
    + '<channel>\n'
    + `\t<title>${escXml(project.name || 'StarCaster site')}</title>\n`
    + `\t<link>${escXml(siteUrl)}</link>\n`
    + `\t<description>${escXml(project.description || '')}</description>\n`
    + `\t<pubDate>${rfc822(now)}</pubDate>\n`
    + '\t<language>en-US</language>\n'
    + '\t<wp:wxr_version>1.2</wp:wxr_version>\n'
    + `\t<wp:base_site_url>${escXml(siteUrl)}</wp:base_site_url>\n`
    + `\t<wp:base_blog_url>${escXml(siteUrl)}</wp:base_blog_url>\n`
    + `\t<wp:author><wp:author_id>1</wp:author_id><wp:author_login>${cdata('starcaster')}</wp:author_login><wp:author_email>${cdata('')}</wp:author_email><wp:author_display_name>${cdata(project.name || 'StarCaster')}</wp:author_display_name><wp:author_first_name>${cdata('')}</wp:author_first_name><wp:author_last_name>${cdata('')}</wp:author_last_name></wp:author>\n`
    + terms.join('')
    + `\t<generator>StarCaster</generator>\n`
    + attachmentItems.join('')
    + frameItems.join('')
    + pageItems.join('')
    + postItems.join('')
    + menuItems.join('')
    + '</channel>\n</rss>\n';

  return { xml, report };
}

module.exports = {
  buildWordPressExport,
  // exported for tests
  diviColumnTypes,
  splitFrame,
  moduleToDivi,
  escAttr,
  escContent,
  MediaRegistry,
};
