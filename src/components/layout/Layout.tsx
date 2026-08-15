import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';
import { GlobalSearch } from './GlobalSearch';
import { PwaControls } from './PwaControls';
import { SideRailV2 } from './SideRailV2';
import { ToastProvider } from '../ui/Toast';

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
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
