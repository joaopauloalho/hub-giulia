import { normalizePhone } from './patientInput';

export function whatsappRecipientDigits(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;

  const rawDigits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return rawDigits.length >= 8 && rawDigits.length <= 15 ? rawDigits : null;
  if (rawDigits.startsWith('55') && (rawDigits.length === 12 || rawDigits.length === 13)) return rawDigits;

  const normalized = normalizePhone(raw);
  const digits = (normalized ?? raw).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}

export function buildSafeWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const recipient = whatsappRecipientDigits(phone);
  if (!recipient) return null;
  return `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`;
}

// Compatibilidade com os fluxos existentes. Novos fluxos devem preferir buildSafeWhatsAppUrl.
export function buildWhatsAppUrl(phone: string, message: string): string {
  return buildSafeWhatsAppUrl(phone, message) ?? '';
}

function appointmentParts(scheduledAt: string) {
  const d = new Date(scheduledAt);
  return {
    diaSemana: d.toLocaleDateString('pt-BR', { weekday: 'long' }),
    diaFormatado: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function whatsAppConfirmacao(nome: string, scheduledAt: string, servico: string): string {
  const { diaSemana, diaFormatado, hora } = appointmentParts(scheduledAt);
  return `Ola ${nome}! 🌸\nSeu agendamento esta marcado para ${diaSemana}, ${diaFormatado} as ${hora}.\nServico: ${servico}\nQualquer duvida, e so chamar! ✨`;
}

export function whatsAppStatusConfirmado(nome: string, scheduledAt: string): string {
  const { diaSemana, diaFormatado, hora } = appointmentParts(scheduledAt);
  return `Ola ${nome}! ✅\nConfirmamos seu agendamento para ${diaSemana}, ${diaFormatado} as ${hora}.\nTe esperamos!`;
}

export function whatsAppLembrete(nome: string, scheduledAt: string, servico: string): string {
  const { hora } = appointmentParts(scheduledAt);
  return `Ola ${nome}! 🌷\nLembramos que amanha voce tem consulta as ${hora}.\nServico: ${servico}\nAguardamos voce!`;
}

export function whatsAppReagendamento(nome: string, scheduledAt: string, servico: string): string {
  const { diaSemana, diaFormatado, hora } = appointmentParts(scheduledAt);
  return `Ola ${nome}! 🔄\nSeu agendamento foi reagendado para ${diaSemana}, ${diaFormatado} as ${hora}.\nServico: ${servico}\nQualquer duvida, e so chamar! ✨`;
}
