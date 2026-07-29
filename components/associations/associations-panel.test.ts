import { describe, expect, it } from 'vitest';

import { groupLabel, groupLinkedItems, type LinkedItem } from './associations-panel';

function item(id: number, type: string, label: string): LinkedItem {
  return { id, object: { type, id: String(id), label } };
}

describe('groupLinkedItems', () => {
  it('orders the addable kinds the same way the Add menu does', () => {
    const groups = groupLinkedItems([
      item(1, 'messaging_tags', 'launch'),
      item(2, 'asset', 'Hero image'),
      item(3, 'messaging_hashtags', '#launch'),
    ]);

    expect(groups.map((group) => group.type)).toEqual([
      'asset',
      'messaging_hashtags',
      'messaging_tags',
    ]);
  });

  it('keeps kinds attached from elsewhere, after the addable ones', () => {
    const groups = groupLinkedItems([
      item(1, 'campaign', 'Spring push'),
      item(2, 'asset', 'Hero image'),
    ]);

    expect(groups.map((group) => group.type)).toEqual(['asset', 'campaign']);
  });

  it('drops kinds with nothing in them', () => {
    const groups = groupLinkedItems([item(1, 'asset', 'Hero image')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it('keeps every item in its bucket', () => {
    const groups = groupLinkedItems([
      item(1, 'asset', 'One'),
      item(2, 'asset', 'Two'),
      item(3, 'messaging_tags', 'launch'),
    ]);

    expect(groups[0].items.map((row) => row.id)).toEqual([1, 2]);
    expect(groups[1].items.map((row) => row.id)).toEqual([3]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupLinkedItems([])).toEqual([]);
  });
});

describe('groupLabel', () => {
  it('uses the friendly name where there is one', () => {
    expect(groupLabel('asset')).toBe('Images');
    expect(groupLabel('messaging_hashtags')).toBe('Hashtags');
    expect(groupLabel('messaging_tags')).toBe('Tags');
  });

  it('falls back to a readable version of an unmapped type', () => {
    expect(groupLabel('messaging_white_papers')).toBe('white papers');
  });
});
