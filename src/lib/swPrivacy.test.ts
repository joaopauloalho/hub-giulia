import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

describe('service worker privacy policy', () => {
  it('versiona o cache do 3.6 sem incluir dados clínicos', () => {
    expect(sw).toContain("const VERSION = '3.6.0'");
    expect(sw).toContain("['script', 'style', 'font']");
    expect(sw).not.toContain("'image'");
    expect(sw).not.toContain('supabase.co');
  });

  it('mantém fotos e respostas autenticadas network-only por omissão', () => {
    expect(sw).toContain('images/photos, PDFs, API routes and all authenticated/private data');
    expect(sw).not.toContain('CacheFirst');
  });

  it('possui purge explícito para logout e rollback', () => {
    expect(sw).toContain('PURGE_HUB_CACHES');
    expect(sw).toContain("key.startsWith('hub-giulia-')");
  });
});
