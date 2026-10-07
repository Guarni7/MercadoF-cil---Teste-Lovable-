import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { planRouteDecision } from "@/lib/planAccess";

/**
 * Exige empresa + plano com acesso (trial, active, e os 3 dias de tolerância
 * depois do vencimento de plano pago — ver planAccess.js).
 * platform_admin bypass. Rotas livres: empresa, plano, baixar.
 */
export default function PlanRoute() {
  const { user } = useAuth();
  const location = useLocation();

  const decision = planRouteDecision(user, location.pathname);

  if (decision === "empresa") {
    return <Navigate to="/empresa" replace state={{ from: location.pathname }} />;
  }
  if (decision === "selecionar-plano") {
    return <Navigate to="/selecionar-plano" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
