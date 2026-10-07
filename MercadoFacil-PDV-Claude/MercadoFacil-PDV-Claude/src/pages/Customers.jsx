import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import {
  Plus,
  Pencil,
  Trash2,
  HandCoins,
  FileSpreadsheet,
  FileText,
  FileUp,
  Search,
  Settings,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import CustomerDialog from "@/components/customers/CustomerDialog";
import PaymentDialog from "@/components/customers/PaymentDialog";
import CustomerColumnsSheet, {
  useCustomerColumns,
} from "@/components/customers/CustomerColumnsSheet";
import CustomerBatchCnpj from "@/components/customers/CustomerBatchCnpj";
import ImportCustomersDialog from "@/components/customers/ImportCustomersDialog";
import {
  CUSTOMER_COLUMN_DEFS,
  getCellValue,
} from "@/lib/customerColumns";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [debtFilter, setDebtFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [columns, setColumns] = useCustomerColumns();

  useEffect(() => {
    api.auth.me().then((u) => setIsAdmin(u?.role === "admin")).catch(() => {});
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.entities.Customer.list("name", 500);
      setCustomers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const visibleCols = useMemo(
    () => CUSTOMER_COLUMN_DEFS.filter((c) => columns[c.id]),
    [columns]
  );

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      c.name?.toLowerCase().includes(q) ||
      c.document?.includes(search) ||
      c.email?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.nickname?.toLowerCase().includes(q);
    const matchDebt =
      debtFilter === "all" ||
      (debtFilter === "debt" && (c.credit_balance || 0) > 0) ||
      (debtFilter === "paid" && (c.credit_balance || 0) <= 0);
    return matchSearch && matchDebt;
  });

  const totalDebt = customers.reduce((sum, c) => sum + (c.credit_balance || 0), 0);
  const debtorsCount = customers.filter((c) => (c.credit_balance || 0) > 0).length;

  const handleDelete = async (customer) => {
    if (!confirm(`Excluir cliente "${customer.name}"?`)) return;
    try {
      await api.entities.Customer.delete(customer.id);
      toast.success("Cliente excluído.");
      loadData();
    } catch {
      toast.error("Erro ao excluir.");
    }
  };

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const openPay = (c) => {
    setPaying(c);
    setPayDialogOpen(true);
  };

  const exportXLSX = () => {
    const headers = visibleCols.map((c) => c.label);
    const rows = filtered.map((c) =>
      visibleCols.map((col) => {
        const v = getCellValue(c, col.id);
        if (col.id === "credit_limit" || col.id === "credit_balance" || col.id === "vale_troca") {
          return v;
        }
        return v;
      })
    );
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exportado!");
  };

  const exportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Relatório de Clientes", 14, 16);
    doc.setFontSize(9);
    doc.text(
      `Total: ${filtered.length} clientes · ${debtorsCount} em débito · ${formatBRL(totalDebt)}`,
      14,
      22
    );

    const cols = visibleCols.slice(0, 8);
    const startX = 14;
    const width = 270;
    const step = width / Math.max(cols.length, 1);
    doc.setFontSize(8);
    doc.setTextColor(0, 109, 99);
    cols.forEach((c, i) => doc.text(c.label, startX + i * step, 30));

    doc.setTextColor(0, 0, 0);
    let y = 36;
    filtered.forEach((c) => {
      if (y > 190) {
        doc.addPage();
        y = 16;
      }
      cols.forEach((col, i) => {
        let text = String(getCellValue(c, col.id));
        if (col.id === "credit_balance" || col.id === "credit_limit" || col.id === "vale_troca") {
          text = formatBRL(Number(getCellValue(c, col.id)) || 0);
        }
        doc.text(text.slice(0, 28), startX + i * step, y);
      });
      y += 6;
    });
    doc.save("clientes.pdf");
    toast.success("PDF gerado!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (batchMode) {
    return (
      <CustomerBatchCnpj
        customers={customers}
        onBack={() => setBatchMode(false)}
        onSaved={loadData}
      />
    );
  }

  const renderCell = (c, colId) => {
    if (colId === "status") {
      const inDebt = (c.credit_balance || 0) > 0;
      const inactive = c.active === false;
      if (inactive) return <Badge variant="secondary" className="text-xs">Inativo</Badge>;
      if (inDebt) return <Badge variant="destructive" className="text-xs">Em débito</Badge>;
      return <Badge variant="secondary" className="text-xs">Em dia</Badge>;
    }
    if (colId === "credit_balance") {
      const inDebt = (c.credit_balance || 0) > 0;
      return inDebt ? (
        <Badge variant="destructive" className="text-xs">{formatBRL(c.credit_balance)}</Badge>
      ) : (
        <Badge variant="secondary" className="text-xs">Em dia</Badge>
      );
    }
    if (colId === "credit_limit" || colId === "vale_troca") {
      return formatBRL(Number(getCellValue(c, colId)) || 0);
    }
    return getCellValue(c, colId);
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-heading font-bold">Clientes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {customers.length} clientes · {debtorsCount} em débito · {formatBRL(totalDebt)} em aberto
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setColumnsOpen(true)}
            title="Configurações da lista"
            className="text-muted-foreground"
          >
            <Settings className="w-5 h-5" />
          </Button>
          {isAdmin && (
            <>
              <Button variant="outline" onClick={exportXLSX} className="gap-2">
                <FileSpreadsheet className="w-4 h-4" /> XLSX
              </Button>
              <Button variant="outline" onClick={exportPDF} className="gap-2">
                <FileText className="w-4 h-4" /> PDF
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
                <FileUp className="w-4 h-4" /> Importar
              </Button>
              <Button variant="outline" onClick={() => setBatchMode(true)} className="gap-2">
                <Layers className="w-4 h-4" /> Consultar CNPJ
              </Button>
              <Button onClick={openNew} className="gap-2">
                <Plus className="w-4 h-4" /> Novo
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, documento, e-mail, cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={debtFilter} onValueChange={setDebtFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="debt">Em débito</SelectItem>
            <SelectItem value="paid">Em dia</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <p>Nenhum cliente encontrado.</p>
          {isAdmin && (
            <Button onClick={openNew} variant="outline" className="mt-4 gap-2">
              <Plus className="w-4 h-4" /> Cadastrar primeiro cliente
            </Button>
          )}
        </Card>
      ) : (
        <div className="rounded-xl border overflow-hidden bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {visibleCols.map((col) => (
                  <TableHead
                    key={col.id}
                    className={
                      col.id === "credit_balance" || col.id === "credit_limit"
                        ? "text-primary text-xs uppercase text-right"
                        : "text-primary text-xs uppercase"
                    }
                  >
                    {col.label}
                  </TableHead>
                ))}
                {isAdmin && (
                  <TableHead className="text-primary text-xs uppercase text-right">Ações</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const inDebt = (c.credit_balance || 0) > 0;
                return (
                  <TableRow key={c.id} className="hover:bg-muted/30">
                    {visibleCols.map((col) => (
                      <TableCell
                        key={col.id}
                        className={
                          col.id === "name"
                            ? "font-medium"
                            : col.id === "credit_balance" || col.id === "credit_limit"
                              ? "text-right"
                              : "text-sm text-muted-foreground"
                        }
                      >
                        {renderCell(c, col.id)}
                      </TableCell>
                    ))}
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {inDebt && (
                            <button
                              onClick={() => openPay(c)}
                              title="Receber pagamento"
                              className="p-1.5 rounded-md hover:bg-emerald-50 hover:text-emerald-600"
                            >
                              <HandCoins className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 rounded-md hover:bg-muted text-primary"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(c)}
                            className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="px-4 py-2 bg-primary/5 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}
          </div>
        </div>
      )}

      <CustomerColumnsSheet
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        columns={columns}
        onChange={setColumns}
      />

      <CustomerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        customer={editing}
        onSaved={loadData}
      />
      <PaymentDialog
        open={payDialogOpen}
        onClose={() => setPayDialogOpen(false)}
        customer={paying}
        onSaved={loadData}
      />
      <ImportCustomersDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={loadData}
      />
    </div>
  );
}