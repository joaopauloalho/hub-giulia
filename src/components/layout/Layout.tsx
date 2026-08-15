import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { BottomTabBar } from './BottomTabBar';
import { SideRailV2 } from './SideRailV2';
import { ToastProvider } from '../ui/Toast';
import { useCommunicationCounts } from '../../hooks/useCommunications';

function DashboardCommunicationShortcut() {
  const navigate = useNavigate();
  const location = useLocation();
  const { counts, loading } = useCommunicationCounts();
  if (location.pathname !== '/dashboard' || loading || counts.total === 0) return null;
  return <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/comunicacao')} style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 30, boxShadow: '0 8px 28px rgba(0,0,0,.14)' }}><MessageCircle size={15} /> Comunicações pendentes {counts.total}</button>;
}

export function Layout() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <SideRailV2 />
        <main className="app-main"><Outlet /></main>
        <DashboardCommunicationShortcut />
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
