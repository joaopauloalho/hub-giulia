import { NavLink } from 'react-router-dom';
import { BookOpen, CalendarDays, HeartHandshake, LayoutDashboard, LogOut, MessageCircle, RotateCcw, ShieldCheck, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const tabs = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Hoje' },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/comunicacao', icon: MessageCircle, label: 'Comunicação' },
  { to: '/relacionamento', icon: HeartHandshake, label: 'Relacionamento' },
  { to: '/pacientes', icon: Users, label: 'Pacientes' },
  { to: '/crm', icon: TrendingUp, label: 'CRM' },
  { to: '/retornos', icon: RotateCcw, label: 'Retornos' },
  { to: '/financeiro', icon: Wallet, label: 'Financeiro' },
  { to: '/saude', icon: ShieldCheck, label: 'Saúde' },
  { to: '/catalogo', icon: BookOpen, label: 'Catálogo' },
];

export function SideRailV2() {
  const { signOut } = useAuth();
  return (
    <nav className="side-rail" aria-label="Navegação principal">
      <div className="rail-brand">hub<br />giulia</div>
      {tabs.map(({ to, icon: Icon, label }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `rail-item${isActive ? ' rail-item--active' : ''}`}>
          <Icon size={20} strokeWidth={1.8} />
          <span>{label}</span>
        </NavLink>
      ))}
      <div className="rail-spacer" />
      <button onClick={signOut} className="rail-item" aria-label="Sair"><LogOut size={20} strokeWidth={1.8} /><span>Sair</span></button>
    </nav>
  );
}
