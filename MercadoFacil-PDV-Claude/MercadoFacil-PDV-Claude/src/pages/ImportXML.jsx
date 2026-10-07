import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileUp,
  Search,
  Clock,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL, formatDate } from "@/lib/format";

export default function ImportXML() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pending, setPending] = useState([]);
  const [finished, setFinished] = useState([]);
  const [importing, setImporting] = useState(false);
  const [carregando, setCarregando] = useState(true);

  // Histórico vem do banco: antes ficava em memória e sumia ao recarregar a tela.
  const carregarFinalizadas = useCallback(async () => {
    setCarregando(true);
    try {
      const contas = await api.entities.Bill.filter({ source: "xml" }, "-created_date", 200);
      setFinished(
        contas.map((b) => ({
          id: b.id,
          fornecedor: b.supplier || b.description || "—",
          numero: b.document_number || "",
          chave: b.access_key || "",
          data_emissao: b.issue_date || "",
          total: b.amount || 0,
          finishedAt: b.created_date,
        })),
      );
    } catch (e) {
      console.error("Erro ao carregar importações:", e);
      toast.error(`Não foi possível carregar as importações: ${e?.message || e}`);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregarFinalizadas();
  }, [carregarFinalizadas]);

  const combina = useCallback(
    (item) => {
      const termo = search.trim().toLowerCase();
      if (!termo) return true;
      return [item.fornecedor, item.numero, item.chave].some((c) =>
        String(c || "").toLowerCase().includes(termo),
      );
    },
    [search],
  );

  const noPeriodo = useCallback(
    (data) => {
      if (!dateFrom && !dateTo) return true;
      const dia = String(data || "").slice(0, 10);
      if (!dia) return false;
      if (dateFrom && dia < dateFrom) return false;
      if (dateTo && dia > dateTo) return false;
      return true;
    },
    [dateFrom, dateTo],
  );

  const pendentesFiltrados = useMemo(
    () => pending.filter((p) => combina(p) && noPeriodo(p.data_emissao)),
    [pending, combina, noPeriodo],
  );

  const finalizadasFiltradas = useMemo(
    () => finished.filter((f) => combina(f) && noPeriodo(f.data_emissao || f.finishedAt)),
    [finished, combina, noPeriodo],
  );

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      for (const file of files) {
        const { file_url } = await api.files.upload({ file });

        const result = await api.files.extract({
          file_url,
          json_schema: {
            type: "object",
            properties: {
              fornecedor: { type: "string" },
              numero: { type: "string" },
              chave: { type: "string" },
              data_emissao: { type: "string" },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    codigo: { type: "string" },
                    nome: { type: "string" },
                    ncm: { type: "string" },
                    cfop: { type: "string" },
                    quantidade: { type: "number" },
                    valor_unitario: { type: "number" },
                    valor_total: { type: "number" },
                  },
                },
              },
            },
          },
        });

        if (result.status === "success" && result.output) {
          const data = result.output;
          setPending((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              fornecedor: data.fornecedor || "Desconhecido",
              numero: data.numero || "",
              chave: data.chave || "",
              data_emissao: data.data_emissao || "",
              itens: data.itens || [],
              fileName: file.name,
            },
          ]);
          toast.success(`${file.name} processado! ${data.itens?.length || 0} item(ns) encontrado(s).`);
        } else {
          toast.error(`Erro ao processar ${file.name}`);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao importar XML.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleImportProducts = async (item) => {
    try {
      const itens = item.itens || [];
      let created = 0;
      let updated = 0;

      for (const prod of itens) {
        const existing = prod.codigo
          ? await api.entities.Product.filter({ barcode: prod.codigo }, null, 1)
          : [];

        // O NCM vem classificado pelo fornecedor na nota de entrada: é a melhor
        // fonte que a loja tem. Antes ele virava a frase "NCM: 10063021 | CFOP:
        // 5102" num campo de texto livre, que a emissão não consegue usar.
        // Agora vai para as colunas fiscais, no formato que o XML exige.
        const ncm = String(prod.ncm || "").replace(/\D/g, "");
        const fiscal = {};
        if (/^\d{8}$/.test(ncm)) fiscal.ncm = ncm;

        let produtoId;
        let produtoNome;
        if (existing.length > 0) {
          // O estoque entra por movimento (idempotente e auditável), igual ao
          // inventário: somar direto no produto deixava a entrada sem rastro.
          //
          // O NCM só é preenchido se o produto ainda não tiver um: o cadastro
          // da loja pode ter sido corrigido pelo contador, e a nota do
          // fornecedor não deve sobrescrever essa correção.
          await api.entities.Product.update(existing[0].id, {
            cost: prod.valor_unitario || existing[0].cost,
            ...(existing[0].ncm ? {} : fiscal),
          });
          produtoId = existing[0].id;
          produtoNome = existing[0].name;
          updated++;
        } else {
          const novo = await api.entities.Product.create({
            name: prod.nome || "Produto sem nome",
            barcode: prod.codigo || "",
            price: prod.valor_unitario || 0,
            cost: prod.valor_unitario || 0,
            stock: 0,
            ...fiscal,
            active: true,
          });
          produtoId = novo.id;
          produtoNome = novo.name;
          created++;
        }

        if (prod.quantidade > 0) {
          await api.stock.applyMovement({
            clientId: `xml_${item.chave || item.numero || item.id}_${prod.codigo || produtoId}`,
            productId: produtoId,
            productName: produtoNome,
            quantity: prod.quantidade,
            type: "entrada",
            reason: "compra",
            unitCost: prod.valor_unitario || null,
            notes: `NF-e ${item.numero || "s/nº"} — ${item.fornecedor}`,
          });
        }
      }

      const total = itens.reduce(
        (s, p) => s + (p.valor_total || (p.valor_unitario || 0) * (p.quantidade || 0)),
        0,
      );
      const emissao = (item.data_emissao || "").slice(0, 10) || null;
      const conta = await api.entities.Bill.create({
        type: "pagar",
        description: `NF-e ${item.numero || "s/nº"} — ${item.fornecedor}`,
        supplier: item.fornecedor,
        category: "Compras",
        amount: total,
        due_date: emissao || new Date().toISOString().slice(0, 10),
        issue_date: emissao,
        status: "pendente",
        paid: false,
        source: "xml",
        document_number: item.numero || null,
        access_key: item.chave || null,
      });

      setPending((prev) => prev.filter((p) => p.id !== item.id));
      setFinished((prev) => [
        { ...item, id: conta.id, created, updated, total, finishedAt: conta.created_date },
        ...prev,
      ]);

      toast.success(
        `${created} novo(s), ${updated} atualizado(s) — conta a pagar de ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} lançada.`,
      );
    } catch (e) {
      console.error("Erro ao importar XML:", e);
      const duplicada = /duplicate key|bills_access_key_unique/i.test(e?.message || "");
      toast.error(
        duplicada
          ? "Esta NF-e já foi importada antes."
          : `Erro ao importar produtos: ${e?.message || e}`,
      );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate("/produtos")}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-heading font-bold">Importar XML</h1>
          <p className="text-xs text-muted-foreground">
            Selecione um arquivo XML de NF-e ou continue uma importação salva
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-5">
        {/* Drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-muted-foreground/30 rounded-xl p-10 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
          />
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            {importing ? (
              <RefreshCw className="w-7 h-7 text-primary animate-spin" />
            ) : (
              <FileUp className="w-7 h-7 text-primary" />
            )}
          </div>
          <div className="text-sm font-semibold mb-1">
            {importing ? "Processando..." : "Adicionar XMLs"}
          </div>
          <div className="text-xs text-muted-foreground">
            Toque para selecionar um ou mais XMLs de NF-e
          </div>
        </div>

        {/* Filters */}
        <div>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-2">
            Filtros
          </h3>
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Fornecedor, nº NF ou chave..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                placeholder="dd/mm/aaaa"
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                placeholder="dd/mm/aaaa"
                className="flex-1"
              />
            </div>
          </div>
        </div>

        {/* Pending */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="w-4 h-4 text-muted-foreground" /> Pendentes
            </h3>
            <button
              className="p-1 rounded-md hover:bg-muted"
              onClick={carregarFinalizadas}
              title="Recarregar importações"
            >
              <RefreshCw
                className={`w-4 h-4 text-muted-foreground ${carregando ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              A importação é feita pelo arquivo XML da nota, enviado aqui. A busca
              automática de NF-e na SEFAZ ainda não está disponível.
            </p>
          </div>

          {pendentesFiltrados.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {pending.length === 0
                ? "Nenhuma importação pendente"
                : "Nenhuma pendente com esses filtros"}
            </p>
          ) : (
            <div className="space-y-2">
              {pendentesFiltrados.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-lg border bg-card space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{item.fornecedor}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.fileName} · {item.itens.length} item(ns)
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => handleImportProducts(item)}
                    >
                      Importar {item.itens.length} produto(s)
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Finished */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" /> Finalizadas
          </h3>
          {finalizadasFiltradas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {carregando
                ? "Carregando..."
                : finished.length === 0
                  ? "Nenhuma importação finalizada"
                  : "Nenhuma finalizada com esses filtros"}
            </p>
          ) : (
            <div className="space-y-2">
              {finalizadasFiltradas.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg border bg-card flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    <div>
                      <div className="text-sm font-medium">{item.fornecedor}</div>
                      <div className="text-xs text-muted-foreground">
                        NF {item.numero || "s/nº"}
                        {item.data_emissao ? ` · ${formatDate(item.data_emissao)}` : ""}
                        {typeof item.created === "number"
                          ? ` · ${item.created} novo(s), ${item.updated} atualizado(s)`
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold">{formatBRL(item.total || 0)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}