import { describe, expect, it } from 'vitest';
import { buildSafeWhatsAppUrl, whatsappRecipientDigits } from './whatsapp';

describe('WhatsApp recipient normalization', () => {
  it('reuses national phone semantics and adds Brazil DDI once', () => {
    expect(whatsappRecipientDigits('(43) 99999-9999')).toBe('5543999999999');
    expect(whatsappRecipientDigits('+55 43 99999-9999')).toBe('5543999999999');
    expect(whatsappRecipientDigits('5543999999999')).toBe('5543999999999');
  });
  it('preserves explicit international E.164 numbers', () => {
    expect(whatsappRecipientDigits('+351 912 345 678')).toBe('351912345678');
  });
  it('rejects empty and ambiguous invalid numbers', () => {
    expect(whatsappRecipientDigits('')).toBeNull();
    expect(whatsappRecipientDigits('123')).toBeNull();
  });
});

describe('WhatsApp URL', () => {
  it('URL-encodes accents, ampersands, question marks and emoji', () => {
    const url = buildSafeWhatsAppUrl('(43) 99999-9999', 'Olá & tudo bem? 🌷');
    expect(url).toBe(`https://wa.me/5543999999999?text=${encodeURIComponent('Olá & tudo bem? 🌷')}`);
    expect(url).not.toContain('Olá');
    expect(url).not.toContain(' ');
  });
  it('does not build a broken link for invalid phone', () => {
    expect(buildSafeWhatsAppUrl('123', 'Oi')).toBeNull();
  });
});
