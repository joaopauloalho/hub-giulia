import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';
import { SideRail } from './SideRail';

export function Layout() {
  return (
    <div className="app-shell">
      <SideRail />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}
