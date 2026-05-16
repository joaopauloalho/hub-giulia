import { Outlet } from 'react-router-dom';
import { BottomTabBar } from './BottomTabBar';

export function Layout() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  );
}
