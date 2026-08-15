import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from './hooks/useAuth';
import { DirtySurface } from './components/layout/DirtySurface';

const Layout = lazy(() => import('./components/layout/Layout').then(module => ({ default: module.Layout })));
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(module => ({ default: module.LoginPage })));
const AgendaPage = lazy(() => import('./pages/agenda/AgendaPage').then(module => ({ default: module.AgendaV2Page })));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));
const CommunicationPage = lazy(() => import('./pages/comunicacao/CommunicationPage').then(module => ({ default: module.CommunicationPage })));
const CrmPage = lazy(() => import('./pages/crm/CrmPage').then(module => ({ default: module.CrmPage })));
const ProposalEditorPage = lazy(() => import('./pages/crm/ProposalEditorPage').then(module => ({ default: module.ProposalEditorPage })));
const PacientesPage = lazy(() => import('./pages/pacientes/PacientesPage').then(module => ({ default: module.PacientesPage })));
const AnamneseEditorPage = lazy(() => import('./pages/pacientes/AnamneseEditorPage').then(module => ({ default: module.AnamneseEditorPage })));
const RegistrarPage = lazy(() => import('./pages/registrar/RegistrarPage').then(module => ({ default: module.RegistrarPage })));
const AttendanceModePage = lazy(() => import('./pages/atendimento/AttendanceModePage').then(module => ({ default: module.AttendanceModePage })));
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage').then(module => ({ default: module.FinanceiroPage })));
const CatalogoPage = lazy(() => import('./pages/catalogo/CatalogoPage').then(module => ({ default: module.CatalogoPage })));
const ServiceReturnSettingsPage = lazy(() => import('./pages/catalogo/ServiceReturnSettingsPage').then(module => ({ default: module.ServiceReturnSettingsPage })));
const RetornosHubPage = lazy(() => import('./pages/retornos/RetornosHubPage').then(module => ({ default: module.RetornosHubPage })));
const PacotesPage = lazy(() => import('./pages/pacotes/PacotesPage').then(module => ({ default: module.PacotesPage })));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="route-loader"><span className="skeleton route-loader__bar" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RouteErrorPage() {
  return <div className="route-error"><strong>Algo deu errado.</strong><p>Esta tela não pôde ser carregada.</p><button className="btn btn--primary btn--md" onClick={() => window.location.reload()}>Tentar novamente</button></div>;
}

const router = createBrowserRouter(createRoutesFromElements(
  <Route errorElement={<RouteErrorPage />}>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="comunicacao" element={<CommunicationPage />} />
      <Route path="agenda" element={<AgendaPage />} />
      <Route path="retornos" element={<RetornosHubPage />} />
      <Route path="crm" element={<CrmPage />} />
      <Route path="crm/deals/:dealId/proposals/:proposalId" element={<ProposalEditorPage />} />
      <Route path="pacientes" element={<PacientesPage />} />
      <Route path="pacientes/:patientId" element={<PacientesPage />} />
      <Route path="pacientes/:patientId/anamnese" element={<DirtySurface id="anamnesis" cleanWhenText="Salvo às"><AnamneseEditorPage /></DirtySurface>} />
      <Route path="atendimento/:appointmentId" element={<AttendanceModePage />} />
      <Route path="registrar" element={<DirtySurface id="registrar" cleanWhenText="Atendimento registrado!"><RegistrarPage /></DirtySurface>} />
      <Route path="financeiro" element={<FinanceiroPage />} />
      <Route path="pacotes" element={<PacotesPage />} />
      <Route path="catalogo" element={<CatalogoPage />} />
      <Route path="catalogo/acompanhamentos" element={<ServiceReturnSettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Route>
));

export default function AppRoutesV2() {
  return <Suspense fallback={<div className="route-loader"><span className="skeleton route-loader__bar" /></div>}><RouterProvider router={router} /></Suspense>;
}
