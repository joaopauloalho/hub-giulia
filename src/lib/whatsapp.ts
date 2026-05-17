export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const withDDI = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withDDI}?text=${encodeURIComponent(message)}`;
}

export function whatsAppConfirmacao(nome: string, scheduledAt: string, servico: string): string {
  const d = new Date(scheduledAt);
  const diaSemana = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const diaFormatado = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Olá ${nome}! 🌸\nSeu agendamento está marcado para ${diaSemana}, ${diaFormatado} às ${hora}.\nServiço: ${servico}\nQualquer dúvida, é só chamar! ✨`;
}

export function whatsAppStatusConfirmado(nome: string, scheduledAt: string): string {
  const d = new Date(scheduledAt);
  const diaSemana = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const diaFormatado = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Olá ${nome}! ✅\nConfirmamos seu agendamento para ${diaSemana}, ${diaFormatado} às ${hora}.\nTe esperamos! 💆‍♀️`;
}

export function whatsAppLembrete(nome: string, scheduledAt: string, servico: string): string {
  const d = new Date(scheduledAt);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Olá ${nome}! 🌷\nLembramos que amanhã você tem consulta às ${hora}.\nServiço: ${servico}\nAguardamos você! 😊`;
}
