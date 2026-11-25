import type { DormantModule } from './dormantModules';

export type AppNavItem = {
  id: string;
  to: string;
  label: string;
  note: string;
  end?: boolean;
  dormant?: DormantModule;
  mobilePrimary?: boolean;
};

export const APP_NAV: AppNavItem[] = [
  { id: 'hoje', to: '/hoje', label: 'Hoje', note: 'O que fazer agora', end: true, mobilePrimary: true },
  { id: 'agenda', to: '/agenda', label: 'Agenda', note: 'Calendário interno e iCloud', dormant: 'internalAgenda' },
  { id: 'comunicacao', to: '/comunicacao', label: 'Comunicação', note: 'Central de mensagens', dormant: 'communication' },
  { id: 'pacientes', to: '/pacientes', label: 'Pacientes', note: 'Fichas', mobilePrimary: true },
  { id: 'retornos', to: '/retornos', label: 'Retornos', note: 'Acompanhamentos clínicos' },
  { id: 'indicacoes', to: '/indicacoes', label: 'Indicações', note: 'Quem indicou e o brinde' },
  { id: 'crm', to: '/crm', label: 'CRM', note: 'Funil e follow-ups', end: true },
  { id: 'relacionamento', to: '/relacionamento', label: 'Relacionamento', note: 'Quem merece um contato' },
  { id: 'financeiro', to: '/financeiro', label: 'Financeiro', note: 'Recebimentos' },
  { id: 'retencao', to: '/retencao', label: 'Retenção', note: 'Quem esfriou e o valor pago', mobilePrimary: true },
  { id: 'saude', to: '/saude', label: 'Saúde', note: 'Qualidade dos dados' },
  { id: 'catalogo', to: '/catalogo', label: 'Catálogo', note: 'Serviços' },
];

export function visibleNav(items: AppNavItem[], showDormant: boolean): AppNavItem[] {
  return items.filter(item => !item.dormant || showDormant);
}
