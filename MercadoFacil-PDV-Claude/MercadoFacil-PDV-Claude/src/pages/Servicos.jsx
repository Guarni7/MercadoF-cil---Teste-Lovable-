// Cadastro de serviços.
//
// O PDV só conhecia produto. MEI e Simples que prestam serviço emitem NFS-e, e
// a NFS-e Nacional exige do item coisas que produto não tem: item da lista da
// LC 116, código de tributação nacional, município de incidência e tratamento
// do ISS. Sem este cadastro, a aba NFS-e da configuração fiscal não tinha o que
// emitir.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/dataClient";
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
import { toast } from "sonner";
import { Briefcase, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/format";

const VAZIO = {
  code: "",
  name: "",
  description: "",
  price: "",
  unit: "UN",
  lc116_item: "",
  service_national_code: "",
  nbs_code: "",
  city_ibge_code: "",
  iss_rate: "",
  iss_withheld: false,
  iss_exigibility: "",
  withhold_irrf: false,
  withhold_csll: false,
  withhold_inss: false,
  withhold_pis: false,
  withhold_cofins: false,
  ibscbs_cst: "",
  ibscbs_class_trib: "",
  active: true,
};

export default function Servicos() {
  const [servicos, setServicos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setServicos(await api.entities.Service.list("-created_at"));
    } catch (e) {
      console.error("Falha ao carregar serviços:", e);
      toast.error(e.message || "Não foi possível carregar os serviços");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return servicos;
    return servicos.filter((s) =>
      [s.name, s.code, s.lc116_item, s.service_national_code].some((c) =>
        String(c || "").toLowerCase().includes(termo),
      ),
    );
  }, [servicos, busca]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(VAZIO);
    setAberto(true);
  };

  const abrirEdicao = (servico) => {
    setEditando(servico);
    setForm({
      ...VAZIO,
      ...Object.fromEntries(
        Object.keys(VAZIO).map((k) => [k, servico[k] ?? VAZIO[k]]),
      ),
      price: servico.price?.toString() ?? "",
      iss_rate: servico.iss_rate?.toString() ?? "",
    });
    setAberto(true);
  };

  const mudar = (campo, valor) => setForm((p) => ({ ...p, [campo]: valor }));

  const salvar = async () => {
    if (!form.name.trim()) {
      toast.error("Informe o nome do serviço");
      return;
    }
    if (form.city_ibge_code && !/^\d{7}$/.test(form.city_ibge_code)) {
      toast.error("O código IBGE do município tem 7 dígitos");
      return;
    }

    setSalvando(true);
    try {
      const payload = {
        code: form.code || null,
        name: form.name.trim(),
        description: form.description || null,
        price: parseFloat(form.price) || 0,
        unit: form.unit || null,
        lc116_item: form.lc116_item || null,
        service_national_code: form.service_national_code || null,
        nbs_code: form.nbs_code || null,
        city_ibge_code: form.city_ibge_code || null,
        iss_rate: form.iss_rate === "" ? null : parseFloat(form.iss_rate),
        iss_withheld: !!form.iss_withheld,
        iss_exigibility: form.iss_exigibility || null,
        withhold_irrf: !!form.withhold_irrf,
        withhold_csll: !!form.withhold_csll,
        withhold_inss: !!form.withhold_inss,
        withhold_pis: !!form.withhold_pis,
        withhold_cofins: !!form.withhold_cofins,
        ibscbs_cst: form.ibscbs_cst || null,
        ibscbs_class_trib: form.ibscbs_class_trib || null,
        active: !!form.active,
      };

      if (editando) {
        await api.entities.Service.update(editando.id, payload);
        toast.success("Serviço atualizado");
      } else {
        await api.entities.Service.create(payload);
        toast.success("Serviço cadastrado");
      }
      setAberto(false);
      await carregar();
    } catch (e) {
      console.error("Falha ao salvar o serviço:", e);
      toast.error(e.message || "Não foi possível salvar o serviço");
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (servico) => {
    if (!window.confirm(`Remover o serviço "${servico.name}"?`)) return;
    try {
      await api.entities.Service.delete(servico.id);
      toast.success("Serviço removido");
      await carregar();
    } catch (e) {
      console.error("Falha ao remover o serviço:", e);
      toast.error(e.message || "Não foi possível remover o serviço");
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-primary" /> Serviços
          </h1>
          <p className="text-sm text-muted-foreground">
            Usados na emissão de NFS-e. A classificação abaixo é o que o município
            e a NFS-e Nacional exigem no documento.
          </p>
        </div>
        <Button onClick={abrirNovo} className="gap-2">
          <Plus className="w-4 h-4" /> Novo serviço
        </Button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, código ou item da LC 116..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-muted-foreground p-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando serviços...
        </div>
      ) : filtrados.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {servicos.length === 0
            ? "Nenhum serviço cadastrado ainda."
            : "Nenhum serviço encontrado com esse termo."}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtrados.map((s) => (
            <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{s.name}</span>
                  {s.code && <Badge variant="outline">{s.code}</Badge>}
                  {!s.active && <Badge variant="secondary">Inativo</Badge>}
                  {!s.lc116_item && (
                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                      Sem item da LC 116
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatBRL(s.price || 0)}
                  {s.lc116_item ? ` · LC 116 ${s.lc116_item}` : ""}
                  {s.iss_rate != null ? ` · ISS ${s.iss_rate}%` : ""}
                  {s.iss_withheld ? " · retido na fonte" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => abrirEdicao(s)}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remover(s)}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar serviço" : "Novo serviço"}</DialogTitle>
            <DialogDescription>
              Os campos fiscais são exigidos pela NFS-e Nacional. Serviço sem item da
              LC 116 tem a emissão recusada.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Nome do serviço</Label>
              <Input value={form.name} onChange={(e) => mudar("name", e.target.value)} />
            </div>
            <div>
              <Label>Código interno</Label>
              <Input value={form.code} onChange={(e) => mudar("code", e.target.value)} />
            </div>
            <div>
              <Label>Preço</Label>
              <Input
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => mudar("price", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Descrição</Label>
              <Input
                value={form.description}
                onChange={(e) => mudar("description", e.target.value)}
                placeholder="Descrição que aparece na nota"
              />
            </div>

            <div>
              <Label>Item da LC 116</Label>
              <Input
                value={form.lc116_item}
                onChange={(e) => mudar("lc116_item", e.target.value)}
                placeholder="16.01"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Item e subitem da lista de serviços
              </p>
            </div>
            <div>
              <Label>Código de tributação nacional</Label>
              <Input
                value={form.service_national_code}
                onChange={(e) => mudar("service_national_code", e.target.value)}
                placeholder="cTribNac"
              />
            </div>
            <div>
              <Label>Código NBS</Label>
              <Input value={form.nbs_code} onChange={(e) => mudar("nbs_code", e.target.value)} />
            </div>
            <div>
              <Label>Município de incidência (IBGE)</Label>
              <Input
                value={form.city_ibge_code}
                onChange={(e) =>
                  mudar("city_ibge_code", e.target.value.replace(/\D/g, "").slice(0, 7))
                }
                placeholder="3106200"
              />
            </div>

            <div>
              <Label>Alíquota de ISS (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.iss_rate}
                onChange={(e) => mudar("iss_rate", e.target.value)}
              />
            </div>
            <div className="flex items-end gap-3 pb-1">
              <Switch
                id="iss-retido"
                checked={!!form.iss_withheld}
                onCheckedChange={(v) => mudar("iss_withheld", v)}
              />
              <Label htmlFor="iss-retido" className="cursor-pointer">
                ISS retido na fonte
              </Label>
            </div>

            <div className="sm:col-span-2">
              <Label>Exigibilidade do ISS</Label>
              <select
                value={form.iss_exigibility || ""}
                onChange={(e) => mudar("iss_exigibility", e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Exigível</option>
                <option value="isencao">Isenção</option>
                <option value="imunidade">Imunidade</option>
                <option value="exigibilidade_suspensa">Exigibilidade suspensa</option>
                <option value="nao_incidencia">Não incidência</option>
              </select>
            </div>

            <div className="sm:col-span-2 space-y-2">
              <Label>Retenções federais</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  ["withhold_irrf", "IRRF"],
                  ["withhold_csll", "CSLL"],
                  ["withhold_inss", "INSS"],
                  ["withhold_pis", "PIS"],
                  ["withhold_cofins", "COFINS"],
                ].map(([campo, rotulo]) => (
                  <label key={campo} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Switch
                      checked={!!form[campo]}
                      onCheckedChange={(v) => mudar(campo, v)}
                    />
                    {rotulo}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label>CST do IBS/CBS</Label>
              <Input
                value={form.ibscbs_cst}
                onChange={(e) => mudar("ibscbs_cst", e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            </div>
            <div>
              <Label>Classificação tributária (cClassTrib)</Label>
              <Input
                value={form.ibscbs_class_trib}
                onChange={(e) =>
                  mudar("ibscbs_class_trib", e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </div>

            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="servico-ativo"
                checked={!!form.active}
                onCheckedChange={(v) => mudar("active", v)}
              />
              <Label htmlFor="servico-ativo" className="cursor-pointer">
                Serviço ativo
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando} className="gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
