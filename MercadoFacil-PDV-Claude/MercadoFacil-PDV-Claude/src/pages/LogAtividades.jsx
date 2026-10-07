import React, { useState, useEffect } from "react";
import { api } from "@/api/dataClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  ShoppingBag,
  Wallet,
  AlertTriangle,
  Banknote,
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Clock,
} from "lucide-react";
import { formatBRL, formatDateTime } from "@/lib/format";

const typeConfig = {
  venda: { label: "Venda", icon: ShoppingBag, color: "text-emerald-600", bg: "bg-emerald-50" },
  abertura_caixa: { label: "Abertura de Caixa", icon: Wallet, color: "text-blue-600", bg: "bg-blue-50" },
  fechamento_caixa: { label: "Fechamento de Caixa", icon: Wallet, color: "text-slate-600", bg: "bg-slate-100" },
  discrepancia_caixa: { label: "Discrepância de Caixa", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
  sangria: { label: "Sangria", icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
  suprimento: { label: "Suprimento", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
  pagamento_crediario: { label: "Recebimento de Crediário", icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50" },
  cancelamento_venda: { label: "Cancelamento", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
  estorno: { label: "Estorno", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
  // Registros gravados antes de existirem os tipos acima.
  troco: { label: "Troco", icon: Banknote, color: "text-purple-600", bg: "bg-purple-50" },
};

const severityConfig = {
  info: { label: "Info", variant: "secondary" },
  warning: { label: "Atenção", variant: "default", className: "bg-amber-500 hover:bg-amber-500" },
  alert: { label: "Alerta", variant: "destructive" },
};

export default function LogAtividades() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const data = await api.entities.ActivityLog.list("-created_date", 200);
      setLogs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = logs.filter((log) => {
    const matchSearch =
      !search ||
      log.description?.toLowerCase().includes(search.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || log.type === filterType;
    const matchSeverity = filterSeverity === "all" || log.severity === filterSeverity;
    return matchSearch && matchType && matchSeverity;
  });

  // Sangria é operação normal: contá-la como discrepância deixava o painel
  // sempre acusando diferença de caixa que não existiu.
  const discrepancyCount = logs.filter(
    (l) => l.type === "discrepancia_caixa" || l.discrepancy
  ).length;
  const totalDiscrepancy = logs.reduce((sum, l) => sum + (l.discrepancy || 0), 0);
  const salesCount = logs.filter((l) => l.type === "venda").length;
  const totalChange = logs.reduce((sum, l) => sum + (l.change_amount || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-heading font-bold flex items-center gap-2">
          <Activity className="w-7 h-7" /> Log de Atividades
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Auditoria de vendas, troco, abertura e fechamento de caixa
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <ShoppingBag className="w-3.5 h-3.5" /> Vendas Registradas
          </div>
          <div className="text-xl font-bold">{salesCount}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Banknote className="w-3.5 h-3.5" /> Troco Total
          </div>
          <div className="text-xl font-bold">{formatBRL(totalChange)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Discrepâncias
          </div>
          <div className="text-xl font-bold text-amber-600">{discrepancyCount}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            {totalDiscrepancy >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}{" "}
            Saldo de Diferenças
          </div>
          <div className={`text-xl font-bold ${totalDiscrepancy < 0 ? "text-red-600" : totalDiscrepancy > 0 ? "text-emerald-600" : ""}`}>
            {formatBRL(totalDiscrepancy)}
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição ou usuário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px]">
            <Filter className="w-3.5 h-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="venda">Vendas</SelectItem>
            <SelectItem value="abertura_caixa">Abertura de Caixa</SelectItem>
            <SelectItem value="fechamento_caixa">Fechamento de Caixa</SelectItem>
            <SelectItem value="discrepancia_caixa">Discrepâncias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda severidade</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Atenção</SelectItem>
            <SelectItem value="alert">Alerta</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Log list */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground text-sm">
          Nenhuma atividade registrada.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => {
            const cfg = typeConfig[log.type] || typeConfig.venda;
            const Icon = cfg.icon;
            const sev = severityConfig[log.severity] || severityConfig.info;
            return (
              <Card key={log.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
                    <Icon className={`w-5 h-5 ${cfg.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {cfg.label}
                      </Badge>
                      {log.severity !== "info" && (
                        <Badge variant={sev.variant} className={`text-xs ${sev.className || ""}`}>
                          {sev.label}
                        </Badge>
                      )}
                      {log.payment_method && (
                        <span className="text-xs text-muted-foreground uppercase">
                          {log.payment_method}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1">{log.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatDateTime(log.created_date)}
                      </span>
                      <span>por {log.user_name}</span>
                      {log.user_role && (
                        <Badge variant="secondary" className="text-[10px]">
                          {log.user_role === "admin" ? "Admin" : "Caixa"}
                        </Badge>
                      )}
                    </div>
                    {log.details && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        {log.details}
                      </p>
                    )}
                  </div>
                  {(log.amount > 0 || log.change_amount > 0 || log.discrepancy !== 0) && (
                    <div className="text-right shrink-0">
                      {log.amount > 0 && (
                        <div className="text-sm font-semibold">{formatBRL(log.amount)}</div>
                      )}
                      {log.change_amount > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Troco: {formatBRL(log.change_amount)}
                        </div>
                      )}
                      {log.discrepancy !== 0 && (
                        <div
                          className={`text-xs font-semibold ${
                            log.discrepancy < 0 ? "text-red-600" : "text-amber-600"
                          }`}
                        >
                          Diferença: {formatBRL(log.discrepancy)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}