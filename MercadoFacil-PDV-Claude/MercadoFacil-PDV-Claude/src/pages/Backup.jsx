// Backup & Restore page — export/import all entity data
import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Download,
  Upload,
  Database,
  Loader2,
  Check,
  AlertTriangle,
  Package,
  ShoppingCart,
  Users,
  FileText,
  Wallet,
  Boxes,
  Tag,
  Receipt,
} from "lucide-react";
import { api } from "@/api/dataClient";

const entities = [
  { name: "Product", label: "Produtos", icon: Package },
  { name: "Sale", label: "Vendas", icon: ShoppingCart },
  { name: "Customer", label: "Clientes", icon: Users },
  { name: "Category", label: "Categorias", icon: Tag },
  { name: "Brand", label: "Marcas", icon: Boxes },
  { name: "Bill", label: "Contas", icon: FileText },
  { name: "CashRegister", label: "Caixas", icon: Wallet },
  { name: "StockMovement", label: "Mov. Estoque", icon: Receipt },
];

export default function Backup() {
  const [counts, setCounts] = useState(/** @type {Record<string, any>} */ ({}));
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);

  const loadCounts = async () => {
    setLoading(true);
    const newCounts = {};
    await Promise.all(
      entities.map(async (e) => {
        try {
          // `list(..., 1)` só devolvia um registro: todo mundo aparecia como 1.
          newCounts[e.name] = await api.entities[e.name].count();
        } catch (err) {
          console.error(`Erro ao contar ${e.name}:`, err);
          newCounts[e.name] = 0;
        }
      })
    );
    setCounts(newCounts);
    setLoading(false);
  };

  useEffect(() => {
    loadCounts();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const backup = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        data: {},
      };

      // Um backup com entidade faltando é pior que backup nenhum: aborta.
      for (const e of entities) {
        try {
          const data = await api.entities[e.name].list("-created_date", 10000);
          backup.data[e.name] = data;
        } catch (err) {
          console.error(`Erro ao exportar ${e.name}:`, err);
          throw new Error(`${e.label}: ${err?.message || "falha ao ler"}`);
        }
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_mercadofacil_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup exportado com sucesso!");
    } catch (e) {
      toast.error("Erro ao exportar: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(/** @type {string} */ (ev.target.result));
        const preview = {};
        Object.keys(data.data || {}).forEach((key) => {
          preview[key] = data.data[key].length;
        });
        setImportPreview(preview);
      } catch {
        toast.error("Arquivo inválido. Selecione um backup JSON válido.");
        setImportFile(null);
        setImportPreview(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const text = await importFile.text();
      const backup = JSON.parse(text);
      const data = backup.data || {};

      let totalImported = 0;
      const falhas = [];
      for (const e of entities) {
        const records = data[e.name];
        if (!records || records.length === 0) continue;
        try {
          // Remove built-in fields before import
          const clean = records.map(({ id, created_date, updated_date, created_by_id, ...rest }) => rest);
          await api.entities[e.name].bulkCreate(clean);
          totalImported += clean.length;
        } catch (err) {
          console.error(`Erro ao importar ${e.name}:`, err);
          falhas.push(`${e.label}: ${err?.message || "erro desconhecido"}`);
        }
      }

      if (falhas.length) {
        toast.error(
          `${totalImported} registros importados, mas ${falhas.length} grupo(s) falharam — ${falhas.join(" | ")}`,
          { duration: 12000 },
        );
      } else {
        toast.success(`Importação concluída! ${totalImported} registros importados.`);
      }
      setImportFile(null);
      setImportPreview(null);
      loadCounts();
    } catch (e) {
      toast.error("Erro ao importar: " + e.message);
    } finally {
      setImporting(false);
    }
  };

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Backup & Restauração</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Exporte e importe todos os dados do sistema
        </p>
      </div>

      {/* Summary */}
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Database className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-lg">Resumo dos Dados</h2>
            <p className="text-sm text-muted-foreground">
              {loading ? "Carregando..." : `${totalRecords} registros no total`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {entities.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.name} className="flex items-center gap-2 p-3 rounded-lg border">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{e.label}</div>
                    <div className="text-xs text-muted-foreground">{counts[e.name] || 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Export */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading font-semibold text-lg mb-1">Exportar Backup</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Baixa um arquivo JSON com todos os produtos, vendas, clientes e configurações.
              Guarde em local seguro.
            </p>
            <Button onClick={handleExport} disabled={exporting} className="gap-2">
              {exporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Exportando...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" /> Exportar Tudo
                </>
              )}
            </Button>
          </div>
          <div className="hidden sm:block w-24 h-24 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Download className="w-10 h-10 text-emerald-600" />
          </div>
        </div>
      </Card>

      {/* Import */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-heading font-semibold text-lg mb-1">Restaurar Backup</h2>
            <p className="text-sm text-muted-foreground">
              Importa dados de um arquivo de backup JSON. Os registros serão adicionados
              aos existentes (não substitui).
            </p>
          </div>
          <div className="hidden sm:block w-24 h-24 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Upload className="w-10 h-10 text-blue-600" />
          </div>
        </div>

        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            A importação adiciona registros novos. Se já existem dados, pode haver duplicação.
            Considere limpar os dados antes de importar se for uma restauração completa.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <input
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="block w-full text-sm text-muted-foreground
                file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0
                file:text-sm file:font-medium file:bg-primary file:text-primary-foreground
                hover:file:bg-primary/90 cursor-pointer"
            />
          </div>

          {importPreview && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1">
                <Check className="w-4 h-4 text-emerald-600" /> Arquivo válido — prévia:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(importPreview).map(([key, count]) => (
                  <div key={key} className="flex items-center gap-1 text-xs">
                    <Badge variant="secondary">{key}</Badge>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importFile && (
            <Button
              onClick={handleImport}
              disabled={importing}
              className="gap-2"
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Importando...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" /> Confirmar Importação
                </>
              )}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}