// Configurações > Fiscal > Tributação.
//
// Regras tributárias da NFC-e por empresa, gravadas em tax_rules/tax_rule_sets
// (RLS por company_id). O fiscal-emit usa exatamente estas linhas: sem regra
// vigente para o item, a emissão para com "Nenhuma regra tributária vigente".
// Os limites do que dá para escolher estão em src/lib/taxRulesForm.js.

import React, { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus } from "lucide-react";
import { api } from "@/api/dataClient";
import {
  CSOSN_OPCOES,
  CST_PIS_COFINS_OPCOES,
  ehRegraGeralVigente,
  formVazio,
  inicioDoAno,
  montarRegra,
  regimeSuportado,
  regraParaForm,
  validarForm,
} from "@/lib/taxRulesForm";

const ORIGEM = "MercadoFácil — Configurações > Fiscal > Tributação";

/** Conjunto de regras da empresa: reaproveita o ativo ou cria o primeiro. */
async function garantirConjunto(companyId) {
  const conjuntos = await api.entities.TaxRuleSet.filter({ company_id: companyId, status: "active" });
  if (conjuntos[0]) return conjuntos[0];
  return api.entities.TaxRuleSet.create({
    company_id: companyId,
    name: "Regras da empresa",
    version: "1",
    valid_from: inicioDoAno(),
    status: "active",
    source: ORIGEM,
  });
}

export default function TributacaoSection({ crt }) {
  const [companyId, setCompanyId] = useState(null);
  const [regras, setRegras] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(null); // null = diálogo fechado
  const [salvando, setSalvando] = useState(false);

  const suportado = regimeSuportado(crt);
  const mudar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const me = await api.auth.me();
      setCompanyId(me?.company_id || null);
      // tax_rules também devolve as regras globais (company_id nulo); aqui só as da empresa.
      const todas = me?.company_id ? await api.entities.TaxRule.filter({ company_id: me.company_id }, "created_at") : [];
      setRegras(todas);
    } catch (e) {
      console.error("Falha ao carregar as regras tributárias:", e);
      toast.error(e.message || "Não foi possível carregar as regras tributárias");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const temRegraGeral = regras.some((r) => ehRegraGeralVigente(r));

  const salvar = async () => {
    const erros = validarForm(form);
    if (erros.length) {
      toast.error(erros[0]);
      return;
    }
    if (!companyId) {
      toast.error("Empresa não identificada.");
      return;
    }
    setSalvando(true);
    try {
      const dados = { ...montarRegra(form), source: ORIGEM };
      if (form.id) {
        await api.entities.TaxRule.update(form.id, dados);
      } else {
        const conjunto = await garantirConjunto(companyId);
        await api.entities.TaxRule.create({ ...dados, rule_set_id: conjunto.id, company_id: companyId });
      }
      toast.success("Regra tributária salva");
      setForm(null);
      await carregar();
    } catch (e) {
      console.error("Falha ao salvar a regra tributária:", e);
      toast.error(e.message || "Não foi possível salvar a regra");
    } finally {
      setSalvando(false);
    }
  };

  const alternarAtiva = async (regra, ativa) => {
    try {
      await api.entities.TaxRule.update(regra.id, { active: ativa });
      setRegras((prev) => prev.map((r) => (r.id === regra.id ? { ...r, active: ativa } : r)));
    } catch (e) {
      toast.error(e.message || "Não foi possível alterar a regra");
    }
  };

  const resumo = (r) => {
    const t = r.taxes || {};
    return `ICMS CSOSN ${t.icms?.csosn || "—"} · PIS ${t.pis?.cst || "—"}/${t.pis?.aliquota ?? 0}% · COFINS ${t.cofins?.cst || "—"}/${t.cofins?.aliquota ?? 0}%`;
  };

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading font-semibold text-lg">Tributação da NFC-e</h2>
          <p className="text-sm text-muted-foreground">
            Sem uma regra vigente para o produto a NFC-e não é emitida. Uma regra sem NCM vale para todos
            os produtos; uma regra com NCM (prefixo) vale só para aquele grupo e tem preferência.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-2 shrink-0"
          disabled={!suportado || carregando}
          onClick={() => setForm(formVazio())}
        >
          <Plus className="w-4 h-4" /> Nova regra
        </Button>
      </div>

      {!suportado && (
        <div className="flex gap-2 text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 p-3 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            A NFC-e só tem tributação configurável para Simples Nacional e MEI (CRT 1, 2 ou 4). Para os demais
            regimes o ICMS exige campos que a emissão ainda não monta.
          </span>
        </div>
      )}

      {suportado && !carregando && (
        <div
          className={`flex gap-2 text-sm rounded-lg border p-3 mb-4 ${
            temRegraGeral
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {temRegraGeral ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>
            {temRegraGeral
              ? "Há uma regra vigente para todos os produtos."
              : "Nenhuma regra vigente para todos os produtos. Crie uma regra sem NCM para poder emitir NFC-e."}
          </span>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando regras...
        </div>
      ) : regras.length ? (
        <div className="divide-y rounded-lg border">
          {regras.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium truncate">{r.description || "Regra sem descrição"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.match?.ncm ? `NCM ${r.match.ncm}*` : "Todos os produtos"} · {resumo(r)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Vigência: {r.valid_from.split("-").reverse().join("/")}
                  {r.valid_to ? ` a ${r.valid_to.split("-").reverse().join("/")}` : " em diante"}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge variant="outline">{r.active === false ? "Inativa" : "Ativa"}</Badge>
                <Switch
                  checked={r.active !== false}
                  onCheckedChange={(v) => alternarAtiva(r, v)}
                  aria-label="Regra ativa"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Editar regra"
                  onClick={() => setForm(regraParaForm(r))}
                >
                  <Pencil className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada ainda.</p>
      )}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar regra tributária" : "Nova regra tributária"}</DialogTitle>
            <DialogDescription>NFC-e (modelo 65), Simples Nacional / MEI.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label>Descrição (opcional)</Label>
                <Input value={form.description} onChange={(e) => mudar("description", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>NCM (prefixo)</Label>
                <Input
                  value={form.ncm}
                  onChange={(e) => mudar("ncm", e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="Vazio = todos os produtos"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>ICMS (CSOSN)</Label>
                <Select value={form.csosn} onValueChange={(v) => mudar("csosn", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CSOSN_OPCOES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {[
                ["PIS", "pisCst", "pisAliquota"],
                ["COFINS", "cofinsCst", "cofinsAliquota"],
              ].map(([nome, cst, aliq]) => (
                <React.Fragment key={nome}>
                  <div>
                    <Label>{nome} (CST)</Label>
                    <Select value={form[cst]} onValueChange={(v) => mudar(cst, v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CST_PIS_COFINS_OPCOES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{nome} — alíquota (%)</Label>
                    <Input
                      inputMode="decimal"
                      value={form[aliq]}
                      onChange={(e) => mudar(aliq, e.target.value)}
                    />
                  </div>
                </React.Fragment>
              ))}
              <div>
                <Label>Vigência — início</Label>
                <Input type="date" value={form.validFrom} onChange={(e) => mudar("validFrom", e.target.value)} />
              </div>
              <div>
                <Label>Vigência — fim (opcional)</Label>
                <Input type="date" value={form.validTo} onChange={(e) => mudar("validTo", e.target.value)} />
              </div>
              <div className="sm:col-span-2 flex items-center gap-3">
                <Switch id="regra-ativa" checked={!!form.active} onCheckedChange={(v) => mudar("active", v)} />
                <Label htmlFor="regra-ativa" className="cursor-pointer">
                  Regra ativa
                </Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando} className="gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar regra
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
