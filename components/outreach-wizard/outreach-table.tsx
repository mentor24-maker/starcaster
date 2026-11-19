import React from 'react';

/**
 * The shared pieces of an Outreach table (task SC-887): a column heading that
 * sorts, the pure sort/filter helpers behind it, and the small square icon
 * button every row action uses. YouTube's Find creators is the first table
 * built from them; Find conversations and the other channels' stages reuse
 * them, so a heading sorts and an icon reads the same on every tab.
 *
 * The look is the canonical admin table (docs/UI_RULES.md T11): wrap the
 * <table> in `.table-wrap`, filters in a `tr.table-filter-row` above the
 * heading row, no inline styles on any cell.
 */

export type SortDir = 'asc' | 'desc';
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

/** A value a column sorts by. null always sorts last, whichever direction. */
export type SortValue = string | number | null;

/**
 * Rows ordered by one column. Strings compare case-insensitively and by
 * number inside them ("Video 2" before "Video 10"); a null (a hidden
 * subscriber count, say) goes to the bottom in both directions, because "not
 * known" is not the smallest value. Ties keep their original order.
 */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, valueOf: (row: T, key: K) => SortValue): T[] {
  if (!sort) return rows.slice();
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      let cmp: number;
      if (typeof a.value === 'number' && typeof b.value === 'number') cmp = a.value - b.value;
      else cmp = String(a.value).localeCompare(String(b.value), 'en', { sensitivity: 'base', numeric: true });
      return cmp !== 0 ? cmp * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

/** A row stays only if it passes EVERY filter (they combine with AND). */
export function filterRows<T>(rows: T[], filters: Array<((row: T) => boolean) | null | undefined | false>): T[] {
  const active = filters.filter((f): f is (row: T) => boolean => typeof f === 'function');
  return active.length ? rows.filter((row) => active.every((f) => f(row))) : rows.slice();
}

/**
 * The next sort after a heading is clicked. A new column starts at its own
 * first direction (numbers high-to-low, words A-to-Z); the same column flips.
 */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir = 'asc'): SortState<K> {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: firstDir };
}

/** A <th> that sorts its column on click and says so to a screen reader. */
export function SortHeader<K extends string>({ label, sortKey, sort, onSort, firstDir = 'asc', className }: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  firstDir?: SortDir;
  className?: string;
}): React.ReactElement {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={className} data-sort-key={sortKey}>
      <button type="button" className="outreach-sort-btn" onClick={() => onSort(nextSort(sort, sortKey, firstDir))}>
        {label}
        <span className="outreach-sort-mark" aria-hidden="true">{active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  );
}

export type RowIconGlyph = 'approve' | 'reject' | 'agree' | 'write' | 'skip' | 'contact' | 'open' | 'comment';

const GLYPHS: Record<RowIconGlyph, React.ReactElement> = {
  approve: <polyline points="4 12 10 18 20 6" />,
  reject: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  agree: <><path d="M7 11v9H4v-9z" /><path d="M7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" /></>,
  write: <><path d="M4 20h4L19 9l-4-4L4 16z" /><line x1="13.5" y1="6.5" x2="17.5" y2="10.5" /></>,
  skip: <><polyline points="5 6 11 12 5 18" /><polyline points="12 6 18 12 12 18" /></>,
  contact: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></>,
  open: <><path d="M14 4h6v6" /><line x1="20" y1="4" x2="11" y2="13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  comment: <path d="M4 5h16v11H9l-5 4z" />,
};

function Glyph({ glyph }: { glyph: RowIconGlyph }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false" data-glyph={glyph}>
      {GLYPHS[glyph]}
    </svg>
  );
}

/**
 * A small square icon action in a row. `label` names the action AND the row
 * ("Approve Dear Fellow INFJ"): it is both the tooltip and what a screen
 * reader says, so an icon is never a guess. Give `href` for a link (opens in
 * a new tab), `onClick` for a button.
 */
export function RowIcon({ glyph, label, onClick, href, disabled, tone }: {
  glyph: RowIconGlyph;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
}): React.ReactElement {
  const className = `tiny-btn icon-btn outreach-row-icon${tone ? ` icon-btn-${tone}` : ''}`;
  const inner = <span className="icon-btn-glyph"><Glyph glyph={glyph} /></span>;
  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer noopener" title={label} aria-label={label} data-row-icon={glyph}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={className} title={label} aria-label={label} disabled={disabled} onClick={onClick} data-row-icon={glyph}>
      {inner}
    </button>
  );
}
