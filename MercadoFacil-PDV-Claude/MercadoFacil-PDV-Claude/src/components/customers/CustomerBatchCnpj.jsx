import React, { useMemo, useState } from "react";
import { api } from "@/api/dataClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Layers,
  Search,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  onlyDigits,
  isPjWithValidCnpj,
  isCnpjIncomplete,
} from "@/lib/customerColumns";
import { cn } from "@/lib/utils";

const RATE_MS = 2100; // ~28/min, abaixo do limite 30/min

async function fetchCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `CNPJ ${d}: consulta falhou (${res.status})`);
  }
  return res.json();
}

function mapApiToPatch(api) {
  return {
    name: api.nome_fantasia || api.razao_social || undefined,
    trade_name: api.nome_fantasia || undefined,
    legal_name: api.razao_social || undefined,
    customer_type: "PJ",
    cep: api.cep ? String(api.cep).replace(/\D/g, "") : undefined,
    address: api.logradouro || undefined,
    address_number: api.numero || undefined,
    complement: api.complemento || undefined,
    neighborhood: api.bairro || undefined,
    city: api.municipio || undefined,
    state: api.uf || undefined,
    ie: api.inscricao_estadual || undefined,
    phone: api.ddd_telefone_1
      ? String(api.ddd_telefone_1).replace(/\D/g, "")
      : undefined,
    email: api.email || undefined,
  };
}

/**
 * Tela "Lote CNPJá" — analisa CNPJs via BrasilAPI e sugere atualização.
 */
export default function CustomerBatchCnpj({ customers, onBack, onSaved }) {
  const [search, setSearch] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(/** @type {Record<string, any>} */ ({})); // id -> { patch, error, raw }
  const [saving, setSaving] = useState(false);

  const pjList = useMemo(() => {
    let list = customers.filter(isPjWithValidCnpj);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          onlyDigits(c.document).includes(onlyDigits(q))
      );
    }
    if (onlyIncomplete) list = list.filter(isCnpjIncomplete);
    return list;
  }, [customers, search, onlyIncomplete]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected(new Set(pjList.map((c) => c.id)));
  };

  const selectIncomplete = () => {
    setSelected(new Set(pjList.filter(isCnpjIncomplete).map((c) => c.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const analyze = async () => {
    const ids = [...selected];
    if (!ids.length) {
      toast.error("Marque ao menos um CNPJ.");
      return;
    }
    setAnalyzing(true);
    const next = { ...results };
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const customer = customers.find((c) => c.id === id);
        if (!customer) continue;
        try {
          const api = await fetchCnpj(customer.document);
          next[id] = { patch: mapApiToPatch(api), raw: api, error: null };
        } catch (e) {
          next[id] = { patch: null, raw: null, error: e.message || "Erro" };
        }
        setResults({ ...next });
        if (i < ids.length - 1) {
          await new Promise((r) => setTimeout(r, RATE_MS));
        }
      }
      toast.success("Análise concluída. Confira antes de salvar.");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    const entries = Object.entries(results).filter(([, r]) => r.patch && !r.error);
    if (!entries.length) {
      toast.error("Nada para salvar. Analise primeiro.");
      return;
    }
    setSaving(true);
    let ok = 0;
    try {
      for (const [id, r] of entries) {
        const clean = Object.fromEntries(
          Object.entries(r.patch).filter(([, v]) => v !== undefined && v !== "")
        );
        if (!Object.keys(clean).length) continue;
        await api.entities.Customer.update(id, clean);
        ok += 1;
      }
      toast.success(`${ok} cliente(s) atualizado(s).`);
      onSaved?.();
      onBack?.();
    } catch (e) {
      toast.error(e.message || "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-heading font-bold">Lote CNPJá</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Marque os CNPJs, analise e confira antes de salvar. Limite de 30 consultas/min.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
          <Button
            onClick={analyze}
            disabled={analyzing || selected.size === 0}
            className="gap-2"
          >
            {analyzing && <Loader2 className="w-4 h-4 animate-spin" />}
            Analisar ({selected.size})
          </Button>
          <Button
            variant="secondary"
            onClick={save}
            disabled={saving || analyzing || !Object.keys(results).length}
          >
            {saving ? "Salvando..." : "Salvar analisados"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nome ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant={onlyIncomplete ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyIncomplete((v) => !v)}
        >
          Só incompletos
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={selectVisible}>
          Selecionar visíveis
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={selectIncomplete}>
          Incompletos
        </Button>
        <button
          type="button"
          onClick={clearSelection}
          className="text-sm text-primary hover:underline px-1"
        >
          Limpar
        </button>
      </div>

      {pjList.length === 0 ? (
        <div className="rounded-xl border bg-card py-16 text-center text-muted-foreground text-sm">
          Nenhum cliente PJ com CNPJ válido.
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden divide-y">
          {pjList.map((c) => {
            const on = selected.has(c.id);
            const r = results[c.id];
            return (
              <label
                key={c.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40",
                  on && "bg-primary/5"
                )}
              >
                <Checkbox
                  checked={on}
                  onCheckedChange={() => toggle(c.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{c.name || "Sem nome"}</span>
                    {isCnpjIncomplete(c) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        incompleto
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {c.document}
                  </div>
                  {r?.error && (
                    <p className="text-xs text-destructive mt-1">{r.error}</p>
                  )}
                  {r?.patch && (
                    <p className="text-xs text-emerald-700 mt-1">
                      → {r.patch.legal_name || r.patch.name || "OK"}
                      {r.patch.city ? ` · ${r.patch.city}/${r.patch.state || ""}` : ""}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
