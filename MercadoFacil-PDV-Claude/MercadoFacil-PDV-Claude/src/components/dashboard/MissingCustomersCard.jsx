import React, { useMemo, useState } from "react";
import { UserX, MessageCircle, ChevronRight, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

const DAYS_THRESHOLD = 45;
const PREVIEW_LIMIT = 4;

function daysSinceLastSale(customer, sales) {
  const customerSales = sales.filter(
    (s) =>
      (s.customer_id && s.customer_id === customer.id) ||
      (s.customer_name && s.customer_name === customer.name)
  );
  if (customerSales.length === 0) return null;
  const lastSale = [...customerSales].sort(
    (a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime()
  )[0];
  return Math.floor(
    (Date.now() - new Date(lastSale.created_date).getTime()) / (1000 * 60 * 60 * 24)
  );
}

function sendWhatsApp(customer) {
  const phone = (customer.phone || "").replace(/\D/g, "");
  const message = `Olá ${customer.name}! Sentimos sua falta! Volte ao nosso minimercado e aproveite ofertas especiais!`;
  const url = phone
    ? `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function CustomerRow({ c, days }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border">
      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
        <span className="text-sm font-semibold text-muted-foreground">
          {(c.name || "U").charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground">
          {days == null
            ? "Sem compras registradas"
            : `Sem compra há ${days} dias`}
          {c.phone ? ` · ${c.phone}` : " · Sem WhatsApp"}
        </div>
      </div>
      <button
        type="button"
        onClick={() => sendWhatsApp(c)}
        className="p-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors shrink-0"
        title="Enviar WhatsApp"
      >
        <MessageCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function MissingCustomersCard({ customers, sales }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const missingCustomers = useMemo(() => {
    return (customers || [])
      .map((c) => {
        const days = daysSinceLastSale(c, sales || []);
        const isMissing = days === null || days >= DAYS_THRESHOLD;
        return isMissing ? { customer: c, days } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));
  }, [customers, sales]);

  const withPhone = useMemo(
    () =>
      missingCustomers.filter(
        ({ customer: c }) => (c.phone || "").replace(/\D/g, "").length >= 10
      ).length,
    [missingCustomers]
  );

  const filteredDetails = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missingCustomers;
    return missingCustomers.filter(({ customer: c }) => {
      const phoneDigits = (c.phone || "").replace(/\D/g, "");
      const qDigits = q.replace(/\D/g, "");
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (qDigits && phoneDigits.includes(qDigits))
      );
    });
  }, [missingCustomers, search]);

  const showDetailsLink = missingCustomers.length > PREVIEW_LIMIT;

  return (
    <>
      <div className="rounded-xl bg-card shadow-sm border border-border/60 overflow-hidden flex flex-col">
        <div className="h-1 bg-red-500" />
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-[10px] font-semibold text-red-700 tracking-wide">
              ✧ ATENÇÃO
            </span>
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <UserX className="w-4 h-4 text-red-600" />
            </div>
          </div>

          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1">
            Clientes
          </p>
          <h3 className="font-heading font-bold text-base text-foreground mb-1">
            Clientes sumidos
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Sem compra há {DAYS_THRESHOLD}+ dias
          </p>

          {missingCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center flex-1 flex items-center justify-center">
              Nenhum cliente inativo no momento
            </p>
          ) : (
            <div className="space-y-2 flex-1">
              {missingCustomers.slice(0, PREVIEW_LIMIT).map(({ customer: c, days }) => (
                <CustomerRow key={c.id} c={c} days={days} />
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {missingCustomers.length}{" "}
              {missingCustomers.length === 1 ? "cliente" : "clientes"}
              {missingCustomers.length > PREVIEW_LIMIT
                ? ` · mostrando ${PREVIEW_LIMIT}`
                : ""}
            </span>
            {showDetailsLink ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setDetailsOpen(true);
                }}
                className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
              >
                Ver todos ({missingCustomers.length}) <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {missingCustomers.length === 0
                  ? `Limite: ${DAYS_THRESHOLD} dias`
                  : `${withPhone} com WhatsApp`}
              </span>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={detailsOpen}
        onOpenChange={(v) => {
          setDetailsOpen(v);
          if (!v) setSearch("");
        }}
      >
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden [&>button]:hidden">
          <div className="p-5 pb-3 flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <UserX className="w-5 h-5 text-red-600" />
                Todos os clientes sumidos
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {missingCustomers.length} inativos · {withPhone} com WhatsApp · mais tempo sem compra primeiro
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetailsOpen(false)}
              className="p-1 rounded-md hover:bg-muted"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou WhatsApp"
                className="pl-8 h-9"
              />
            </div>
          </div>

          <div className="px-5 pb-5 max-h-[60vh] overflow-y-auto space-y-2">
            {filteredDetails.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                {search.trim()
                  ? "Nenhum resultado para essa busca."
                  : `Nenhum cliente inativo. Limite: ${DAYS_THRESHOLD}+ dias sem compra.`}
              </p>
            ) : (
              filteredDetails.map(({ customer: c, days }) => (
                <CustomerRow key={c.id} c={c} days={days} />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
