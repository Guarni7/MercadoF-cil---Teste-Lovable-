import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { destinoNaoAutenticado, ehElectron } from '@/lib/destinoNaoAutenticado';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import AdminRoute from '@/components/AdminRoute';
import PlanRoute from '@/components/PlanRoute';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import Dashboard from '@/pages/Dashboard';
import PDV from '@/pages/PDV';
import Products from '@/pages/Products';
import Servicos from '@/pages/Servicos';
import Sales from '@/pages/Sales';
import Customers from '@/pages/Customers';
import CashRegisterPage from '@/pages/CashRegister';
import Gerenciador from '@/pages/Gerenciador';
import Delivery from '@/pages/Delivery';
import Mesas from '@/pages/Mesas';
import Cartoes from '@/pages/Cartoes';
import MesaLink from '@/pages/MesaLink';
import Financeiro from '@/pages/Financeiro';
import Relatorios from '@/pages/Relatorios';
import Configuracoes from '@/pages/Configuracoes';
import Integracoes from '@/pages/Integracoes';
import Plano from '@/pages/Plano';
import Usuarios from '@/pages/Usuarios';
import LogAtividades from '@/pages/LogAtividades';
import PlanSelection from '@/pages/PlanSelection';
import Landing from '@/pages/Landing';
import UpdateFlowHost from '@/components/updates/UpdateFlowHost';
import FechamentoComBackupHost from '@/components/updates/FechamentoComBackupHost';
import ElectronUpdatePanel from '@/components/updates/ElectronUpdatePanel';
import ImportXML from '@/pages/ImportXML';
import Inventario from '@/pages/Inventario';
import RelatorioProdutos from '@/pages/RelatorioProdutos';
import RelatorioCompostos from '@/pages/RelatorioCompostos';
import Backup from '@/pages/Backup';
import Baixar from '@/pages/Baixar';
import DownloadRedirect from '@/pages/DownloadRedirect';
import Sincronizacao from '@/pages/Sincronizacao';
import Termos from '@/pages/Termos';
import Privacidade from '@/pages/Privacidade';
import Ajuda from '@/pages/Ajuda';
import Empresa from '@/pages/Empresa';
import Empresas from '@/pages/Empresas';
import Layout from '@/components/Layout';

// Quem não está autenticado: web → /landing (como sempre); app desktop → /login (ver destinoNaoAutenticado).
const NaoAutenticado = () => {
  const { pathname, search } = useLocation();
  return <Navigate to={destinoNaoAutenticado({ electron: ehElectron(), pathname, search })} replace />;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 bg-slate-50">
        <img src="/brand/mf-icon-256.png" alt="MercadoFácil" width="72" height="72" className="h-[72px] w-[72px] rounded-2xl" />
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <>
      <UpdateFlowHost />
      <Routes>
      <Route element={<ProtectedRoute unauthenticatedElement={<NaoAutenticado />} />}>
        <Route path="/selecionar-plano" element={<PlanSelection />} />
        <Route path="/empresa" element={<Empresa />} />
        <Route element={<Layout />}>
          <Route path="/baixar" element={<Baixar />} />
          <Route path="/empresas" element={<Empresas />} />
          <Route element={<AdminRoute />}>
            <Route path="/plano" element={<Plano />} />
          </Route>
          <Route element={<PlanRoute />}>
            <Route path="/configuracoes" element={<Configuracoes />} />
            <Route path="/integracoes" element={<Integracoes />} />
            <Route path="/sincronizacao" element={<Sincronizacao />} />
            <Route element={<AdminRoute />}>
              <Route path="/usuarios" element={<Usuarios />} />
              <Route path="/log-atividades" element={<LogAtividades />} />
              <Route path="/backup" element={<Backup />} />
            </Route>
            <Route path="/importar-xml" element={<ImportXML />} />
            <Route path="/inventario" element={<Inventario />} />
            <Route path="/relatorio-produtos" element={<RelatorioProdutos />} />
            <Route path="/relatorio-compostos" element={<RelatorioCompostos />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/delivery" element={<Delivery />} />
            <Route path="/mesas" element={<Mesas />} />
            <Route path="/cartoes" element={<Cartoes />} />
            <Route path="/m/:token" element={<MesaLink />} />
            <Route path="/gerenciador" element={<Gerenciador />} />
            <Route path="/vendas" element={<Sales />} />
            <Route path="/produtos" element={<Products />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/pdv" element={<PDV />} />
            <Route path="/clientes" element={<Customers />} />
            <Route path="/caixa" element={<CashRegisterPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
      </Routes>
    </>
  );
};


function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            <Route path="/landing" element={<Landing />} />
            <Route path="/termos" element={<Termos />} />
            <Route path="/privacidade" element={<Privacidade />} />
            <Route path="/ajuda" element={<Ajuda />} />
            <Route path="/downloads/:file" element={<DownloadRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<AuthenticatedApp />} />
          </Routes>
          {/* Em toda rota (inclusive /login): fechar o app pede backup antes (desktop). */}
          <FechamentoComBackupHost />
          <ElectronUpdatePanel />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
