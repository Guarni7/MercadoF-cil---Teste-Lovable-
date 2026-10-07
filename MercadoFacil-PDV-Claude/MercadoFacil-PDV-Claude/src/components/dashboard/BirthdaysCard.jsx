import React, { useMemo, useState } from "react";
import { Cake, MessageCircle, ChevronRight, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

const PREVIEW_LIMIT = 4;

const monthNames = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function getMonthDay(birthday) {
  if (!birthday) return null;
  const raw = String(birthday).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  return { month: d.getMonth(), day: d.getDate() };
}

function filterBirthdays(customers, period) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const day = today.getDate();

  return customers.filter((c) => {
    const md = getMonthDay(c.birthday);
    if (!md) return false;

    if (period === "dia") {
      return md.month === m && md.day === day;
    }
    if (period === "mes") {
      return md.month === m;
    }
    if (period === "semana") {
      const startOfWeek = new Date(y, m, day);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      const checkDate = new Date(y, md.month, md.day);
      if (checkDate < startOfWeek) {
        const next = new Date(y + 1, md.month, md.day);
        return next >= startOfWeek && next < endOfWeek;
      }
      return checkDate >= startOfWeek && checkDate < endOfWeek;
    }
    return false;
  });
}

function sendWhatsApp(customer) {
  const phone = (customer.phone || "").replace(/\D/g, "");
  const message = `Olá ${customer.name}! Feliz aniversário! Descontos especiais para você no nosso minimercado!`;
  const url = phone
    ? `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function CustomerRow({ c, md }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border">
      <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
        <span className="text-sm font-semibold text-amber-700">
          {(c.name || "U").charAt(0).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{c.name}</div>
        <div className="text-xs text-muted-foreground">
          {md ? `${md.day} de ${monthNames[md.month]}` : ""}
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

export default function BirthdaysCard({ customers }) {
  const [period, setPeriod] = useState("dia");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const birthdayCustomers = useMemo(
    () => filterBirthdays(customers || [], period),
    [customers, period]
  );

  const sortedAll = useMemo(() => {
    return [...birthdayCustomers].sort((a, b) => {
      const ma = getMonthDay(a.birthday);
      const mb = getMonthDay(b.birthday);
      if (!ma || !mb) return 0;
      return ma.day - mb.day || (a.name || "").localeCompare(b.name || "", "pt-BR");
    });
  }, [birthdayCustomers]);

  const filteredDetails = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedAll;
    return sortedAll.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    );
  }, [sortedAll, search]);

  const withPhone = useMemo(
    () => birthdayCustomers.filter((c) => (c.phone || "").replace(/\D/g, "").length >= 10).length,
    [birthdayCustomers]
  );

  const showDetailsLink = birthdayCustomers.length > PREVIEW_LIMIT;

  const tabs = [
    { value: "dia", label: "Dia" },
    { value: "semana", label: "Semana" },
    { value: "mes", label: "Mês" },
  ];

  return (
    <>
      <div className="rounded-xl bg-card shadow-sm border border-border/60 overflow-hidden flex flex-col">
        <div className="h-1 bg-amber-500" />
        <div className="p-5 flex flex-col flex-1">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 tracking-wide">
              ✧ {birthdayCustomers.length}{" "}
              {period === "dia" ? "HOJE" : period === "semana" ? "NA SEMANA" : "NO MÊS"}
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Cake className="w-4 h-4 text-amber-600" />
            </div>
          </div>

          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase mb-1">
            Clientes
          </p>
          <h3 className="font-heading font-bold text-base text-foreground mb-1">
            Aniversariantes
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Envio manual pelo WhatsApp
          </p>

          <div className="inline-flex p-0.5 rounded-full bg-muted gap-0.5 mb-4 self-start">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setPeriod(tab.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                  period === tab.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {birthdayCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center flex-1 flex items-center justify-center">
              Nenhum aniversariante neste período
            </p>
          ) : (
            <div className="space-y-2 flex-1">
              {birthdayCustomers.slice(0, PREVIEW_LIMIT).map((c) => (
                <CustomerRow key={c.id} c={c} md={getMonthDay(c.birthday)} />
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {birthdayCustomers.length}{" "}
              {birthdayCustomers.length === 1 ? "cliente" : "clientes"}
              {birthdayCustomers.length > PREVIEW_LIMIT
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
                Ver todos ({birthdayCustomers.length}) <ChevronRight className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {birthdayCustomers.length === 0
                  ? "Cadastre nascimento no cliente"
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
                <Cake className="w-5 h-5 text-amber-600" />
                Todos os aniversariantes
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {birthdayCustomers.length} no período · {withPhone} com WhatsApp · ordenado por dia
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

          <div className="px-5 pb-3 space-y-3">
            <div className="inline-flex p-0.5 rounded-full bg-muted gap-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setPeriod(tab.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    period === tab.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
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
                  : "Nenhum aniversariante neste período."}
              </p>
            ) : (
              filteredDetails.map((c) => (
                <CustomerRow key={c.id} c={c} md={getMonthDay(c.birthday)} />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
