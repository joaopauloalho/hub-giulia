import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, Briefcase, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

const nav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/contacts', icon: Users, label: 'Contatos' },
  { to: '/deals', icon: Briefcase, label: 'Negócios' },
];

export function Sidebar() {
  const { signOut } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-text">hub</span>
        <span className="logo-accent">giulia</span>
      </div>

      <nav className="sidebar-nav">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.5} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <button onClick={signOut} className="nav-item nav-signout">
        <LogOut size={18} strokeWidth={1.5} />
        <span>Sair</span>
      </button>
    </aside>
  );
}
