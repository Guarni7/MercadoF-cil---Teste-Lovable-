import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Truck, Plus, Search, Loader2, Phone, MapPin, Clock, Bike, CheckCircle2,
  XCircle, ChefHat, Pencil, X,
} from "lucide-react";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import DeliveryOrderDialog from "@/components/delivery/DeliveryOrderDialog";

const STATUS_FLOW = ["pendente", "preparando", "saiu_entrega", "entregue"];
const STATUS_CONFIG = {
  pendente: { label: "Pendente", icon: Clock, color: "bg-amber-100 text-amber-700 border-amber-200", next: "preparando", nextLabel: "Preparar" },
  preparando: { label: "Preparando", icon: ChefHat, color: "bg-blue-100 text-blue-700 border-blue-200", next: "saiu_entrega", nextLabel: "Saiu p/ Entrega" },
  saiu_entrega: { label: "Saiu p/ Entrega", icon: Bike, color: "bg-violet-100 text-violet-700 border-violet-200", next: "entregue", nextLabel: "Entregue" },
  entregue: { label: "Entregue", icon: CheckCircle2, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  cancelado: { label: "Cancelado", icon: XCircle, color: "bg-red-100 text-red-700 border-red-200" },
};

export default function Delivery() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.entities.DeliveryOrder.list("-created_date", 200);
      setOrders(data || []);
    } catch (e) {
      toast.error("Erro ao carregar pedidos");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const filtered = useMemo(() => {
    let r = orders;
    if (statusFilter !== "todos") r = r.filter((o) => o.status === statusFilter);
    if (search) {
      const s = search.toLowerCase();
      r = r.filter((o) =>
        o.customer_name?.toLowerCase().includes(s) ||
        o.customer_phone?.includes(s) ||
        String(o.number || "").includes(s) ||
        o.neighborhood?.toLowerCase().includes(s)
      );
    }
    return r;
  }, [orders, search, statusFilter]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = orders.filter((o) => new Date(o.created_date).toDateString() === today);
    return {
      total: todayOrders.length,
      receita: todayOrders.filter((o) => o.status === "entregue").reduce((s, o) => s + (o.total || 0), 0),
      pendentes: orders.filter((o) => o.status === "pendente").length,
      preparando: orders.filter((o) => o.status === "preparando").length,
      saiu: orders.filter((o) => o.status === "saiu_entrega").length,
      entregues: todayOrders.filter((o) => o.status === "entregue").length,
    };
  }, [orders]);

  async function advanceStatus(order) {
    const cfg = STATUS_CONFIG[order.status];
    if (!cfg?.next) return;
    try {
      await api.entities.DeliveryOrder.update(order.id, { status: cfg.next });
      toast.success(`Status: ${STATUS_CONFIG[cfg.next].label}`);
      loadOrders();
    } catch { toast.error("Erro ao atualizar status"); }
  }

  async function cancelOrder(order) {
    try {
      await api.entities.DeliveryOrder.update(order.id, { status: "cancelado" });
      toast.success("Pedido cancelado");
      loadOrders();
    } catch { toast.error("Erro ao cancelar"); }
  }

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(o) { setEditing(o); setDialogOpen(true); }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Truck className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold">Delivery</h1>
            <p className="text-sm text-muted-foreground">Gerencie pedidos de entrega</p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="w-4 h-4" /> Novo Pedido
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Pedidos Hoje" value={stats.total} icon={Truck} />
        <StatCard label="Pendentes" value={stats.pendentes} icon={Clock} color="text-amber-600" />
        <StatCard label="Preparando" value={stats.preparando} icon={ChefHat} color="text-blue-600" />
        <StatCard label="Saiu p/ Entrega" value={stats.saiu} icon={Bike} color="text-violet-600" />
        <StatCard label="Entregues Hoje" value={stats.entregues} icon={CheckCircle2} color="text-emerald-600" />
        <StatCard label="Receita Entregue" value={formatBRL(stats.receita)} icon={CheckCircle2} color="text-emerald-600" isMoney />
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar por cliente, telefone, bairro ou nº..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os Status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, c]) => <SelectItem key={k} value={k}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Truck className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Nenhum pedido de delivery encontrado</p>
          <Button onClick={openNew} variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Criar primeiro pedido</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((o) => {
            const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.pendente;
            const StatusIcon = cfg.icon;
            return (
              <Card key={o.id} className="p-4 space-y-3 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs text-muted-foreground">#{o.number || "—"}</span>
                    <p className="font-semibold leading-tight">{o.customer_name}</p>
                    {o.customer_phone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" /> {o.customer_phone}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className={`${cfg.color} gap-1 text-xs`}>
                    <StatusIcon className="w-3 h-3" /> {cfg.label}
                  </Badge>
                </div>

                <div className="space-y-1">
                  {(o.items || []).slice(0, 3).map((i, idx) => (
                    <p key={idx} className="text-xs text-muted-foreground">
                      {i.quantity}x {i.name}
                    </p>
                  ))}
                  {(o.items || []).length > 3 && <p className="text-xs text-muted-foreground">+{o.items.length - 3} itens</p>}
                </div>

                {(o.neighborhood || o.address) && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1">
                    <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{[o.address, o.address_number, o.neighborhood].filter(Boolean).join(", ")}</span>
                  </p>
                )}

                {o.delivery_person && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Bike className="w-3 h-3" /> {o.delivery_person}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t">
                  <div>
                    <span className="text-xs text-muted-foreground">Total</span>
                    <p className="font-bold text-primary">{formatBRL(o.total || 0)}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(o)}><Pencil className="w-3.5 h-3.5" /></Button>
                    {o.status !== "entregue" && o.status !== "cancelado" && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => cancelOrder(o)}><X className="w-3.5 h-3.5" /></Button>
                    )}
                  </div>
                </div>

                {cfg.next && (
                  <Button size="sm" className="w-full" variant={cfg.next === "entregue" ? "default" : "secondary"} onClick={() => advanceStatus(o)}>
                    <cfg.icon className="w-3.5 h-3.5 mr-1" /> {cfg.nextLabel}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <DeliveryOrderDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={loadOrders}
        editingOrder={editing}
      />
    </div>
  );
}

/** @param {{ label: string, value: React.ReactNode, icon?: React.ComponentType<{ className?: string }>, color?: string, isMoney?: boolean }} props */
function StatCard({ label, value, icon: Icon, color, isMoney }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color || "text-muted-foreground"}`} />
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      </div>
      <p className={`font-bold ${isMoney ? "text-sm" : "text-lg"}`}>{value}</p>
    </Card>
  );
}