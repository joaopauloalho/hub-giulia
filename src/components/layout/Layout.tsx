import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';
import { SideRail } from './SideRail';
import { ToastProvider } from '../ui/Toast';

export function Layout() {
  return (
    <ToastProvider>
      <div className="app-shell">
        <SideRail />
        <main className="app-main">
          <Outlet />
        </main>
        <BottomTabBar />
      </div>
    </ToastProvider>
  );
}
