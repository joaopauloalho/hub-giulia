import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, type ReactNode } from 'react';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/auth/LoginPage';
import { AgendaPage } from './pages/agenda/AgendaPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { PacientesPage } from './pages/pacientes/PacientesPage';
import { RegistrarPage } from './pages/registrar/RegistrarPage';
import { FinanceiroPage } from './pages/financeiro/FinanceiroPage';
import { CatalogoPage } from './pages/catalogo/CatalogoPage';

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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
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
      </BrowserRouter>
    </ErrorBoundary>
  );
}
