import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeartHandshake, MessageCircle } from 'lucide-react';
import { BottomTabBar } from './BottomTabBar';
import { GlobalSearch } from './GlobalSearch';
import { PwaControls } from './PwaControls';
import { SideRailV2 } from './SideRailV2';
import { ToastProvider } from '../ui/Toast';
import { useCommunicationCounts } from '../../hooks/useCommunications';
import { useRelationshipCounts } from '../../hooks/useRelationship';

function DashboardCommunicationShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const { counts, loading } = useCommunicationCounts();
  if (location.pathname !== '/dashboard' || loading || counts.total === 0) return null;
  return <button type="button" className="btn btn--primary btn--sm dashboard-communication-shortcut" onClick={() => navigate('/comunicacao')}><MessageCircle size={15} /> Comunicações pendentes {counts.total}</button>;
}

function DashboardRelationshipShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const { summary, loading } = useRelationshipCounts();
  if (location.pathname !== '/dashboard' || loading) return null;
  const title = `${summary.total} pessoas · ${summary.return} retornos · ${summary.proposal} propostas · ${summary.credit} créditos · ${summary.reactivation} reativações`;
  return <button type="button" className="btn btn--secondary btn--sm dashboard-communication-shortcut" style={{ bottom: 126 }} title={title} onClick={() => navigate('/relacionamento')}><HeartHandshake size={15} /> Relacionamento {summary.total} · {summary.return}R {summary.proposal}P {summary.credit}C {summary.reactivation}Re</button>;
}

export function Layout() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <SideRailV2 />
        <main className="app-main">
          <div className="hub-topbar">
            <div className="hub-topbar-brand" aria-hidden="true">Hub Giulia</div>
            <GlobalSearch />
            <PwaControls />
          </div>
          <Outlet />
        </main>
        <DashboardRelationshipShortcut />
        <DashboardCommunicationShortcut />
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
