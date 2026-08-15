import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';

const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(module => ({ default: module.LoginPage })));
const AgendaPage = lazy(() => import('./pages/agenda/AgendaPage').then(module => ({ default: module.AgendaV2Page })));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));
const PacientesPage = lazy(() => import('./pages/pacientes/PacientesPage').then(module => ({ default: module.PacientesPage })));
const RegistrarPage = lazy(() => import('./pages/registrar/RegistrarPage').then(module => ({ default: module.RegistrarPage })));
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage').then(module => ({ default: module.FinanceiroPage })));
const CatalogoPage = lazy(() => import('./pages/catalogo/CatalogoPage').then(module => ({ default: module.CatalogoPage })));
const RetornosPage = lazy(() => import('./pages/retornos/RetornosPage').then(module => ({ default: module.RetornosPage })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-loader">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="full-loader">Carregando...</div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="retornos" element={<RetornosPage />} />
            <Route path="pacientes" element={<PacientesPage />} />
            <Route path="registrar" element={<RegistrarPage />} />
            <Route path="financeiro" element={<FinanceiroPage />} />
            <Route path="catalogo" element={<CatalogoPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
