import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/auth/LoginPage';
import { AgendaPage } from './pages/agenda/AgendaPage';
import { PacientesPage } from './pages/pacientes/PacientesPage';
import { RegistrarPage } from './pages/registrar/RegistrarPage';
import { FinanceiroPage } from './pages/financeiro/FinanceiroPage';
import { CatalogoPage } from './pages/catalogo/CatalogoPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="full-loader">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
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
          <Route index element={<Navigate to="/agenda" replace />} />
          <Route path="agenda"     element={<AgendaPage />} />
          <Route path="pacientes"  element={<PacientesPage />} />
          <Route path="registrar"  element={<RegistrarPage />} />
          <Route path="financeiro" element={<FinanceiroPage />} />
          <Route path="catalogo"   element={<CatalogoPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/agenda" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
