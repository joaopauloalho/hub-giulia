import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, CircleEllipsis, FileText, HeartHandshake, LayoutDashboard, MessageCircle, Package, PlusCircle, RotateCcw, ShieldCheck, TrendingUp, Users, Wallet, X } from 'lucide-react';

const PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Hoje' },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/comunicacao', icon: MessageCircle, label: 'Comunicação' },
  { to: '/pacientes', icon: Users, label: 'Pacientes' },
] as const;

const MORE = [
  { to: '/relacionamento', icon: HeartHandshake, label: 'Relacionamento', note: 'Pessoas que merecem atenção' },
  { to: '/crm', icon: TrendingUp, label: 'CRM', note: 'Leads e oportunidades' },
  { to: '/crm/propostas-em-aberto', icon: FileText, label: 'Propostas em aberto', note: 'Enviadas aguardando decisão' },
  { to: '/retornos', icon: RotateCcw, label: 'Retornos', note: 'Acompanhamentos clínicos' },
  { to: '/registrar', icon: PlusCircle, label: 'Registrar', note: 'Novo procedimento' },
  { to: '/financeiro', icon: Wallet, label: 'Financeiro', note: 'Recebimentos e resultados' },
  { to: '/pacotes', icon: Package, label: 'Pacotes', note: 'Créditos e vouchers' },
  { to: '/saude', icon: ShieldCheck, label: 'Saúde do Hub', note: 'Qualidade de dados e integrações' },
  { to: '/catalogo', icon: BookOpen, label: 'Catálogo', note: 'Serviços e configurações' },
] as const;

export function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const moreActive = MORE.some(item => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));

  useEffect(() => { setMoreOpen(false); }, [location.pathname, location.search]);

  return (
    <>
      <nav className="bottom-tabs" aria-label="Navegação principal">
        {PRIMARY.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `tab-item${isActive ? ' tab-item--active' : ''}`}>
            <Icon /><span>{label}</span>
          </NavLink>
        ))}
        <button type="button" className={`tab-item tab-item--button${moreActive || moreOpen ? ' tab-item--active' : ''}`} onClick={() => setMoreOpen(value => !value)} aria-expanded={moreOpen} aria-controls="hub-more-menu">
          <CircleEllipsis /><span>Mais</span>
        </button>
      </nav>
      {moreOpen && (
        <div className="hub-more-overlay" onMouseDown={event => event.target === event.currentTarget && setMoreOpen(false)}>
          <section className="hub-more-sheet" id="hub-more-menu" role="dialog" aria-modal="true" aria-label="Mais opções">
            <div className="hub-more-head"><div><strong>Mais</strong><p className="page-sub">Acesso aos módulos menos frequentes</p></div><button className="icon-btn" onClick={() => setMoreOpen(false)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="hub-more-grid">
              {MORE.map(({ to, icon: Icon, label, note }) => (
                <NavLink key={to} to={to} className="hub-more-item" onClick={() => setMoreOpen(false)}>
                  <span className="hub-more-icon"><Icon size={19} /></span><span><strong>{label}</strong><small>{note}</small></span>
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
