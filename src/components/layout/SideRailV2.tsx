import { NavLink } from 'react-router-dom';
import { BookOpen, CalendarDays, FileText, HeartHandshake, LayoutDashboard, LogOut, MessageCircle, RotateCcw, ShieldCheck, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const tabs = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Hoje', end: true },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda', end: false },
  { to: '/comunicacao', icon: MessageCircle, label: 'Comunicação', end: false },
  { to: '/relacionamento', icon: HeartHandshake, label: 'Relacionamento', end: false },
  { to: '/pacientes', icon: Users, label: 'Pacientes', end: false },
  { to: '/crm', icon: TrendingUp, label: 'CRM', end: true },
  { to: '/crm/propostas-em-aberto', icon: FileText, label: 'Propostas', end: true },
  { to: '/retornos', icon: RotateCcw, label: 'Retornos', end: false },
  { to: '/financeiro', icon: Wallet, label: 'Financeiro', end: false },
  { to: '/saude', icon: ShieldCheck, label: 'Saúde', end: false },
  { to: '/catalogo', icon: BookOpen, label: 'Catálogo', end: false },
];

export function SideRailV2() {
  const { signOut } = useAuth();
  return <nav className="side-rail" aria-label="Navegação principal"><div className="rail-brand">hub<br />giulia</div>{tabs.map(({to,icon:Icon,label,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>`rail-item${isActive?' rail-item--active':''}`}><Icon size={20} strokeWidth={1.8}/><span>{label}</span></NavLink>)}<div className="rail-spacer"/><button onClick={signOut} className="rail-item" aria-label="Sair"><LogOut size={20} strokeWidth={1.8}/><span>Sair</span></button></nav>;
}
