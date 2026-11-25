import { NavLink } from 'react-router-dom';
import { BookOpen, CalendarDays, Gift, HeartHandshake, LayoutDashboard, LogOut, MessageCircle, Repeat, RotateCcw, ShieldCheck, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { APP_NAV, visibleNav } from '../../lib/appNav';
import { dormantModulesEnabled } from '../../lib/dormantModules';
import './sideRail391.css';

const ICONS: Record<string, LucideIcon> = {
  hoje: LayoutDashboard,
  agenda: CalendarDays,
  comunicacao: MessageCircle,
  pacientes: Users,
  retornos: RotateCcw,
  indicacoes: Gift,
  crm: TrendingUp,
  relacionamento: HeartHandshake,
  financeiro: Wallet,
  retencao: Repeat,
  saude: ShieldCheck,
  catalogo: BookOpen,
};

export function SideRailV2() {
  const { signOut } = useAuth();
  const items = visibleNav(APP_NAV, dormantModulesEnabled());
  return <nav className="side-rail" aria-label="Navegação principal">
    <div className="rail-brand">hub<br />giulia</div>
    {items.map(item => {
      const Icon = ICONS[item.id] ?? LayoutDashboard;
      return <NavLink key={item.id} to={item.to} end={item.end} className={({ isActive }) => `rail-item${isActive ? ' rail-item--active' : ''}`}>
        <Icon size={20} strokeWidth={1.8} />
        <span>{item.label}</span>
      </NavLink>;
    })}
    <div className="rail-spacer" />
    <button onClick={signOut} className="rail-item" aria-label="Sair"><LogOut size={20} strokeWidth={1.8} /><span>Sair</span></button>
  </nav>;
}
