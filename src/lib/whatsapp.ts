export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const withDDI = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withDDI}?text=${encodeURIComponent(message)}`;
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
