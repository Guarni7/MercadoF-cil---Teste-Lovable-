import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

/** Exige usuário autenticado com role admin. */
export default function AdminRoute({ children }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== "admin") {
    return <Navigate to="/pdv" replace />;
  }

  return children ? children : <Outlet />;
}
