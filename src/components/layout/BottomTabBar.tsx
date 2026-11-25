import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, CircleEllipsis, Gift, HeartHandshake, LayoutDashboard, MessageCircle, Repeat, RotateCcw, ShieldCheck, TrendingUp, Users, Wallet, X, type LucideIcon } from 'lucide-react';
import { APP_NAV, visibleNav } from '../../lib/appNav';
import { dormantModulesEnabled } from '../../lib/dormantModules';

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

export function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const items = visibleNav(APP_NAV, dormantModulesEnabled());
  const primary = items.filter(item => item.mobilePrimary);
  const more = items.filter(item => !item.mobilePrimary);
  const moreActive = more.some(item => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  useEffect(() => { setMoreOpen(false); }, [location.pathname, location.search]);

  return (
    <>
      <nav className="bottom-tabs" aria-label="Navegação principal">
        {primary.map(item => {
          const Icon = ICONS[item.id] ?? LayoutDashboard;
          return <NavLink key={item.id} to={item.to} className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}>
            <Icon /><span>{item.label}</span>
          </NavLink>;
        })}
        <button type="button" className={`tab-item tab-item--button${moreActive || moreOpen ? ' tab-item--active' : ''}`} onClick={() => setMoreOpen(value => !value)} aria-expanded={moreOpen} aria-controls="hub-more-menu">
          <CircleEllipsis /><span>Mais</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="hub-more-overlay" onMouseDown={event => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="hub-more-sheet" id="hub-more-menu" role="dialog" aria-modal="true" aria-label="Mais opções">
            <div className="hub-more-head"><div><strong>Mais</strong><p className="page-sub">O restante do Hub</p></div><button className="icon-btn" onClick={() => setMoreOpen(false)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="hub-more-grid">
              {more.map(item => {
                const Icon = ICONS[item.id] ?? LayoutDashboard;
                return <NavLink key={item.id} to={item.to} className="hub-more-item" onClick={() => setMoreOpen(false)}>
                  <span className="hub-more-icon"><Icon size={19} /></span><span><strong>{item.label}</strong><small>{item.note}</small></span>
                </NavLink>;
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
