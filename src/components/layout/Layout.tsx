import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { BottomTabBar } from './BottomTabBar';
import { GlobalSearch } from './GlobalSearch';
import { PwaControls } from './PwaControls';
import { SideRailV2 } from './SideRailV2';
import { ToastProvider } from '../ui/Toast';
import { useCommunicationCounts } from '../../hooks/useCommunications';

function DashboardCommunicationShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const { counts, loading } = useCommunicationCounts();
  if (location.pathname !== '/dashboard' || loading || counts.total === 0) return null;
  return <button type="button" className="btn btn--primary btn--sm dashboard-communication-shortcut" onClick={() => navigate('/comunicacao')}><MessageCircle size={15} /> Comunicações pendentes {counts.total}</button>;
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
        <DashboardCommunicationShortcut />
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
