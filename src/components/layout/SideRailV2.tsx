import { NavLink } from 'react-router-dom';
import { BookOpen, CalendarDays, LayoutDashboard, LogOut, PlusCircle, RotateCcw, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const tabs = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/retornos', icon: RotateCcw, label: 'Retornos' },
  { to: '/crm', icon: TrendingUp, label: 'CRM' },
  { to: '/pacientes', icon: Users, label: 'Pacientes' },
  { to: '/registrar', icon: PlusCircle, label: 'Registrar' },
  { to: '/financeiro', icon: Wallet, label: 'Financeiro' },
  { to: '/catalogo', icon: BookOpen, label: 'Catalogo' },
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
