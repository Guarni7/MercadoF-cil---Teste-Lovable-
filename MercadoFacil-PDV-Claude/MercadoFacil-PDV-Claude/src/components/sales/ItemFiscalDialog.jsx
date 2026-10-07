// Dados fiscais do item — edição da classificação fiscal do produto.
//
// Esta tela existia como formulário decorativo: era aberta sem `onSave`, então
// tudo que o lojista digitava era descartado ao fechar, e mesmo assim ela
// avisava "Dados fiscais salvos". Os selects também guardavam o rótulo inteiro
// ("102 - Tributada pelo Simples...") em vez do código, que é o que vai no XML.
//
// A venda já aconteceu e não se reescreve: o que se corrige aqui é o cadastro
// fiscal do produto, para as próximas notas saírem classificadas certo.

import React, { useEffect, useState } from "react";
import { X, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/api/dataClient";

// Código primeiro, descrição depois: o que é gravado é sempre o código.
const CSOSN = [
  ["101", "Tributada com permissão de crédito"],
  ["102", "Tributada sem permissão de crédito"],
  ["103", "Isenção do ICMS para faixa de receita bruta"],
  ["300", "Imune"],
  ["400", "Não tributada"],
  ["500", "ICMS cobrado anteriormente por substituição tributária"],
];

const CFOP = [
  ["5102", "Venda de mercadoria de terceiros"],
  ["5405", "Venda de mercadoria sujeita a ST"],
  ["6102", "Venda para fora do estado"],
];

// CST de PIS/COFINS (tabela oficial), não CST de ICMS: o campo é PIS/COFINS.
const CST_PIS_COFINS = [
  ["01", "Operação tributável com alíquota básica"],
  ["04", "Operação tributável monofásica, alíquota zero"],
  ["06", "Operação tributável a alíquota zero"],
  ["07", "Operação isenta da contribuição"],
  ["49", "Outras operações de saída"],
];

const ORIGENS = [
  ["0", "0 — Nacional"],
  ["1", "1 — Estrangeira, importação direta"],
  ["2", "2 — Estrangeira, adquirida no mercado interno"],
];

const VAZIO = {
  ncm: "",
  cest: "",
  cfop: "",
  origin: "",
  icms_csosn: "",
  pis_cst: "",
  cofins_cst: "",
  ibscbs_cst: "",
  ibscbs_class_trib: "",
  gtin: "",
};

/** @param {{ open: boolean, onClose: () => void, item: any, onSaved?: (patch: any) => void }} props */
export default function ItemFiscalDialog({ open, onClose, item, onSaved }) {
  const [tab, setTab] = useState("nfe");
  const [form, setForm] = useState(VAZIO);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const produtoId = item?.product_id || null;

  useEffect(() => {
    if (!open || !produtoId) return;
    let ativo = true;
    setCarregando(true);
    api.entities.Product.get(produtoId)
      .then((p) => {
        if (!ativo) return;
        setForm({
          ...VAZIO,
          ...Object.fromEntries(
            Object.keys(VAZIO)
              .map((k) => [k, p?.[k] ?? ""])
              .filter(([, v]) => v !== null),
          ),
        });
      })
      .catch((e) => {
        console.error("Falha ao carregar os dados fiscais do produto:", e);
        toast.error("Não foi possível carregar os dados fiscais do produto");
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [open, produtoId]);

  if (!item) return null;

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const salvar = async () => {
    if (!produtoId) {
      toast.error("Item sem produto vinculado: não há cadastro fiscal para atualizar");
      return;
    }
    // O banco recusa NCM/CEST/CFOP fora do formato. Avisar aqui evita que o
    // lojista receba um erro de constraint sem saber qual campo está errado.
    if (form.ncm && !/^\d{8}$/.test(form.ncm)) {
      toast.error("NCM precisa ter 8 dígitos");
      return;
    }
    if (form.cest && !/^\d{7}$/.test(form.cest)) {
      toast.error("CEST precisa ter 7 dígitos");
      return;
    }
    if (form.cfop && !/^\d{4}$/.test(form.cfop)) {
      toast.error("CFOP precisa ter 4 dígitos");
      return;
    }

    setSalvando(true);
    try {
      const patch = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]),
      );
      await api.entities.Product.update(produtoId, patch);
      toast.success("Dados fiscais do produto atualizados");
      onSaved?.(patch);
      onClose();
    } catch (e) {
      console.error("Falha ao salvar os dados fiscais:", e);
      toast.error(e.message || "Não foi possível salvar os dados fiscais");
    } finally {
      setSalvando(false);
    }
  };

  /** @param {{ label: React.ReactNode, children?: React.ReactNode, hint?: React.ReactNode }} props */
  const Campo = ({ label, children, hint }) => (
    <div>
      <label className="text-xs text-[#666] block mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );

  const Selecao = ({ valor, onChange, opcoes, vazio }) => (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 rounded-md border border-gray-300 bg-white px-3 text-sm"
    >
      <option value="">{vazio}</option>
      {opcoes.map(([codigo, descricao]) => (
        <option key={codigo} value={codigo}>
          {codigo} — {descricao}
        </option>
      ))}
    </select>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0" style={{ background: "#f4f7f6" }}>
        <div className="px-5 py-4 bg-white border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#006d77]" />
            <div>
              <h2 className="text-lg font-bold text-[#1a1a1a]">Dados fiscais do produto</h2>
              <p className="text-xs text-muted-foreground">{item.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-1 p-1 bg-[#e8edec] rounded-lg w-fit">
            {[["nfe", "NF-e / NFC-e"], ["reforma", "IBS / CBS"]].map(([id, rotulo]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  tab === id ? "bg-[#006d77] text-white font-medium" : "text-muted-foreground"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {!produtoId && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Este item não está vinculado a um produto do cadastro, então não há
              classificação fiscal para editar.
            </div>
          )}

          <div className="rounded-lg border bg-white p-3 text-xs text-muted-foreground">
            A alteração vale para o cadastro do produto e para as próximas notas.
            A venda já concluída não é reescrita.
          </div>

          {carregando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando dados fiscais...
            </div>
          ) : tab === "nfe" ? (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="NCM" hint="8 dígitos, obrigatório para emitir">
                <Input
                  placeholder="10063021"
                  value={form.ncm}
                  onChange={(e) => set("ncm", e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className="bg-white border-[#006d77]"
                />
              </Campo>
              <Campo label="CEST" hint="7 dígitos, só para produto sujeito a ST">
                <Input
                  placeholder="0300100"
                  value={form.cest}
                  onChange={(e) => set("cest", e.target.value.replace(/\D/g, "").slice(0, 7))}
                  className="bg-white"
                />
              </Campo>
              <Campo label="CSOSN (Simples Nacional)">
                <Selecao
                  valor={form.icms_csosn}
                  onChange={(v) => set("icms_csosn", v)}
                  opcoes={CSOSN}
                  vazio="Selecione o CSOSN"
                />
              </Campo>
              <Campo label="CFOP">
                <Selecao
                  valor={form.cfop}
                  onChange={(v) => set("cfop", v)}
                  opcoes={CFOP}
                  vazio="Selecione o CFOP"
                />
              </Campo>
              <Campo label="CST do PIS">
                <Selecao
                  valor={form.pis_cst}
                  onChange={(v) => set("pis_cst", v)}
                  opcoes={CST_PIS_COFINS}
                  vazio="Selecione o CST"
                />
              </Campo>
              <Campo label="CST da COFINS">
                <Selecao
                  valor={form.cofins_cst}
                  onChange={(v) => set("cofins_cst", v)}
                  opcoes={CST_PIS_COFINS}
                  vazio="Selecione o CST"
                />
              </Campo>
              <Campo label="Origem da mercadoria">
                <Selecao
                  valor={form.origin}
                  onChange={(v) => set("origin", v)}
                  opcoes={ORIGENS.map(([c, d]) => [c, d.replace(/^\d+ — /, "")])}
                  vazio="Selecione a origem"
                />
              </Campo>
              <Campo label="GTIN / EAN" hint="Código de barras do produto">
                <Input
                  value={form.gtin}
                  onChange={(e) => set("gtin", e.target.value.trim())}
                  className="bg-white"
                />
              </Campo>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[#e69d00] bg-[#fff9ef] p-3">
                <p className="text-xs text-[#e69d00]">
                  IBS e CBS entram no documento conforme a regra tributária vigente
                  cadastrada. As alíquotas não são digitadas aqui: elas vêm da regra
                  com data de vigência, para a nota antiga continuar com a alíquota da
                  época.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Campo label="CST do IBS/CBS" hint="Tabela oficial de CST da LC 214/2025">
                  <Input
                    placeholder="000"
                    value={form.ibscbs_cst}
                    onChange={(e) => set("ibscbs_cst", e.target.value.replace(/\D/g, "").slice(0, 3))}
                    className="bg-white"
                  />
                </Campo>
                <Campo
                  label="Classificação tributária (cClassTrib)"
                  hint="Código da tabela oficial do Informe Técnico 2025.002"
                >
                  <Input
                    placeholder="000001"
                    value={form.ibscbs_class_trib}
                    onChange={(e) =>
                      set("ibscbs_class_trib", e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="bg-white"
                  />
                </Campo>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 bg-white border-t flex justify-end">
          <Button
            className="gap-2 text-white hover:opacity-90"
            style={{ background: "#006d77" }}
            onClick={salvar}
            disabled={salvando || carregando || !produtoId}
          >
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar no cadastro do produto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
