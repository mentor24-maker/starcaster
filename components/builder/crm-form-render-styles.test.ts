import { describe, expect, it } from 'vitest';
import { crmFormStylesToRenderStyles } from '../../lib/crmFormStyles.js';

const styles = {
  margin: '20px',
  padding: '20px',
  fieldWidth: '100%',
  buttonWidth: '100%',
  buttonAlign: 'center',
};

describe('crmFormStylesToRenderStyles', () => {
  it('does not pair a full-width shell with an outer margin', () => {
    // width:100% + margin:20px overflows the surrounding column by 20px a side,
    // which is how the Marinoff sidebar form hung past its column edge.
    const { shell } = crmFormStylesToRenderStyles(styles, '#1DC3FF');
    expect(shell.margin).toBe('20px');
    expect(shell.width).not.toBe('100%');
  });

  it('stretches the shell so a centered cell cannot collapse it to a pill', () => {
    // The Marinoff contact form sat in a cell whose content alignment was
    // "center", which renders the column as `display:flex; align-items:center`.
    // With `width:auto` and no `align-self`, the form shrank to its (empty)
    // content width. `stretch` overrides the cell's cross-axis alignment.
    const { shell } = crmFormStylesToRenderStyles(styles, '#1DC3FF');
    expect(shell.alignSelf).toBe('stretch');
  });

  it('leaves grid track sizing to CSS so container queries can restack it', () => {
    const { form, button } = crmFormStylesToRenderStyles(styles, '#1DC3FF');
    // Inline styles beat stylesheets, so anything the @container rule needs to
    // override has to stay out of the inline style objects.
    expect(form.gridTemplateColumns).toBeUndefined();
    expect(button.gridColumn).toBeUndefined();
  });

  it('still carries the operator-configurable values inline', () => {
    const { form, button } = crmFormStylesToRenderStyles(styles, '#1DC3FF');
    expect(form.padding).toBe('20px');
    expect(button.width).toBe('100%');
    expect(button.justifySelf).toBe('center');
  });
});
