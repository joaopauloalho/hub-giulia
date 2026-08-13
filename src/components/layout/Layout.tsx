import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';
import { SideRailV2 } from './SideRailV2';
import { ToastProvider } from '../ui/Toast';

export function Layout() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <SideRailV2 />
        <main className="app-main">
          <Outlet />
        </main>
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
