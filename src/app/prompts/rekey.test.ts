import { describe, expect, it } from 'vitest';
import { renameToggle } from './rekey';

describe('renameToggle', () => {
  it('rewrites every condition that reads the key', () => {
    const text = [
      '{{#when::toggle::sims}}on{{:else}}off{{/when}}',
      '{{#when::not::toggle::sims}}x{{/when}}',
      '{{#when::keep::toggle::sims}}x{{/when}}',
      '{{#when:toggle:sims}}x{{/when}}',
      '{{#when::sims::tis::1}}x{{/when}}',
      '{{#if {{getglobalvar::toggle_sims}}}}x{{/if}}',
      '{{#when::toggle::sims}}{{#when::toggle::sims}}nested{{/when}}{{/when}}',
    ].join('\n');
    expect(renameToggle(text, 'sims', 'simulator')).toBe(text.replaceAll('sims', 'simulator'));
  });

  it('leaves other keys, variables, computed keys and plain text alone', () => {
    const text = [
      '{{#when::toggle::simsx}}x{{/when}}',
      '{{#when::var::sims}}x{{/when}}',
      '{{#when::toggle::a::and::sims}}x{{/when}}',
      '{{#when::sims}}x{{/when}}',
      '{{getvar::toggle_sims}}',
      '{{#when::toggle::{{getvar::sims}}}}x{{/when}}',
      'toggle::sims in prose',
    ].join('\n');
    expect(renameToggle(text, 'sims', 'simulator')).toBe(text);
  });
});
