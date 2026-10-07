import React, { useEffect, useState } from "react";
import { Building2, Loader2, Check, Ban, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/dataClient";
import { useAuth } from "@/lib/AuthContext";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

const statusLabel = {
  pending: "Pendente",
  active: "Ativa",
  suspended: "Suspensa",
  rejected: "Rejeitada",
};

export default function Empresas() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.functions.invoke("listCompanies", {});
      const data = res.data || res;
      if (data.error) throw new Error(data.error);
      setCompanies(data.companies || []);
    } catch (e) {
      toast.error(e.message || "Erro ao listar empresas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!user?.platform_admin) {
    return <Navigate to="/" replace />;
  }

  const setStatus = async (company_id, status) => {
    setActing(company_id + status);
    try {
      const res = await api.functions.invoke("activateCompany", { company_id, status });
      const data = res.data || res;
      if (data.error) throw new Error(data.error);
      toast.success(`Empresa marcada como ${statusLabel[status] || status}`);
      await load();
    } catch (e) {
      toast.error(e.message || "Falha ao atualizar.");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Building2 className="w-6 h-6 text-emerald-700" />
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-muted-foreground">
            Ative lojas após formalização (somente admin da plataforma).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada ainda.</p>
      ) : (
        <div className="space-y-3">
          {companies.map((c) => (
            <div key={c.id} className="rounded-xl border bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{c.trade_name}</p>
                  <Badge variant="outline">{statusLabel[c.status] || c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.document} · {c.city || "—"}/{c.state || "—"} · plano {c.plan || "—"} ({c.plan_status || "none"})
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-1 bg-emerald-700"
                  disabled={acting}
                  onClick={() => setStatus(c.id, "active")}
                >
                  <Check className="w-3.5 h-3.5" /> Ativar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={acting}
                  onClick={() => setStatus(c.id, "suspended")}
                >
                  <Pause className="w-3.5 h-3.5" /> Suspender
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1"
                  disabled={acting}
                  onClick={() => setStatus(c.id, "rejected")}
                >
                  <Ban className="w-3.5 h-3.5" /> Rejeitar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
