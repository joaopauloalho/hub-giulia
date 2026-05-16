import { NavLink } from 'react-router-dom';
import { CalendarDays, Users, PlusCircle, Wallet, BookOpen } from 'lucide-react';

const TABS = [
  { to: '/agenda',     icon: CalendarDays, label: 'Agenda' },
  { to: '/pacientes',  icon: Users,        label: 'Pacientes' },
  { to: '/registrar',  icon: PlusCircle,   label: 'Registrar' },
  { to: '/financeiro', icon: Wallet,       label: 'Financeiro' },
  { to: '/catalogo',   icon: BookOpen,     label: 'Catálogo' },
];

export function BottomTabBar() {
  return (
    <nav className="bottom-tabs">
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
