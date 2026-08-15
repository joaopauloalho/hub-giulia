import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllDirtySources, hasDirtyForms, setDirtySource } from './dirtyState';
import { canApplyPwaUpdate } from './pwa';

describe('dirty state and PWA update safety', () => {
  beforeEach(() => clearAllDirtySources());

  it('bloqueia update quando existe formulário sujo', () => {
    setDirtySource('proposal', true);
    expect(hasDirtyForms()).toBe(true);
    expect(canApplyPwaUpdate()).toBe(false);
  });

  it('libera update depois do save/cleanup', () => {
    setDirtySource('agenda', true);
    setDirtySource('agenda', false);
    expect(hasDirtyForms()).toBe(false);
    expect(canApplyPwaUpdate()).toBe(true);
  });
});
