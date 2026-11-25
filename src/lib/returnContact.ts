export function returnWhatsappMessage(item: { patientName: string; serviceName: string; returnType: string }): string {
  if (item.returnType === 'clinical_return') {
    return `Olá ${item.patientName}! 🌷 Está chegando o período ideal para avaliarmos seu retorno de ${item.serviceName}. Quando puder, me chama por aqui para combinarmos.`;
  }
  return `Olá ${item.patientName}! 🌷 Está chegando o período recomendado para sua próxima sessão de ${item.serviceName}. Quando puder, me chama por aqui para combinarmos.`;
}
