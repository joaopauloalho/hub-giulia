import { NavLink } from 'react-router-dom';
import { BookOpen, CalendarDays, LayoutDashboard, PlusCircle, Users, Wallet } from 'lucide-react';

const TABS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/pacientes', icon: Users, label: 'Pacientes' },
  { to: '/registrar', icon: PlusCircle, label: 'Registrar' },
  { to: '/financeiro', icon: Wallet, label: 'Financeiro' },
  { to: '/catalogo', icon: BookOpen, label: 'Catalogo' },
];

export function BottomTabBar() {
  return (
    <nav className="bottom-tabs" aria-label="Navegação principal">
      {TABS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `tab-item${isActive ? ' tab-item--active' : ''}`
          }
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
