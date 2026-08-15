import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('service worker privacy policy', () => {
  it('limita runtime cache a assets estáticos seguros', () => {
    expect(sw).toContain("['script', 'style', 'font']");
    expect(sw).not.toContain("'image'");
    expect(sw).not.toContain('supabase.co');
  });

  it('possui purge explícito para logout e rollback', () => {
    expect(sw).toContain('PURGE_HUB_CACHES');
    expect(sw).toContain("key.startsWith('hub-giulia-')");
  });
});
