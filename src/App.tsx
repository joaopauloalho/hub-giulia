import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';

const LoginPage = lazy(() => import('./pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const AgendaPage = lazy(() => import('./pages/agenda/AgendaPage').then((module) => ({ default: module.AgendaPage })));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const PacientesPage = lazy(() => import('./pages/pacientes/PacientesPage').then((module) => ({ default: module.PacientesPage })));
const RegistrarPage = lazy(() => import('./pages/registrar/RegistrarPage').then((module) => ({ default: module.RegistrarPage })));
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage').then((module) => ({ default: module.FinanceiroPage })));
const CatalogoPage = lazy(() => import('./pages/catalogo/CatalogoPage').then((module) => ({ default: module.CatalogoPage })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: '#e53e3e', marginBottom: '1rem' }}>Algo deu errado. Recarregue a página.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1.5rem' }}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-loader">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const routeFallback = <div className="full-loader">Carregando...</div>;

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={routeFallback}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard"  element={<DashboardPage />} />
              <Route path="agenda"     element={<AgendaPage />} />
              <Route path="pacientes"  element={<PacientesPage />} />
              <Route path="registrar"  element={<RegistrarPage />} />
              <Route path="financeiro" element={<FinanceiroPage />} />
              <Route path="catalogo"   element={<CatalogoPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
