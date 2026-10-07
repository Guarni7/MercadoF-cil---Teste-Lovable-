import React, { useState } from "react";
import { ArrowLeft, Plus, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { toast } from "sonner";

const pagarCategories = ["Aluguel", "Energia", "Água", "Internet", "Fornecedores", "Salários", "Impostos", "Outros"];
const receberCategories = ["Vendas", "Crediário", "Serviços", "Aluguel", "Outros"];

export default function AccountForm({ onBack }) {
  const [form, setForm] = useState({
    type: "pagar",
    category: "",
    subcategory: "",
    supplier: "",
    description: "",
    amount: "",
    due_date: new Date().toISOString().split("T")[0],
    recurring: false,
    paid: false,
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const categories = form.type === "pagar" ? pagarCategories : receberCategories;

  const handleSave = async () => {
    if (!form.amount || !form.due_date) {
      toast.error("Preencha valor e vencimento.");
      return;
    }
    setSaving(true);
    try {
      await api.entities.Bill.create({
        type: form.type,
        category: form.category,
        subcategory: form.subcategory,
        supplier: form.supplier,
        description: form.description,
        amount: parseFloat(form.amount) || 0,
        due_date: form.due_date,
        recurring: form.recurring,
        paid: form.paid,
        paid_date: form.paid ? new Date().toISOString().split("T")[0] : undefined,
      });
      toast.success("Conta criada com sucesso!");
      onBack();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao criar conta.");
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = "text-xs font-semibold tracking-wide text-muted-foreground uppercase mb-1.5 block";

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-heading font-bold mb-2">Financeiro</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          <span className="text-muted-foreground">|</span>
          <span className="font-semibold">Lançar / Criar Contas</span>
        </div>
      </div>

      {/* Form card */}
      <div className="bg-card rounded-xl border shadow-sm p-5 space-y-4">
        {/* Row 1: Tipo + Categoria */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className={fieldLabel}>Tipo *</Label>
            <Select value={form.type} onValueChange={(v) => handleChange("type", v)}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pagar">A Pagar</SelectItem>
                <SelectItem value="receber">A Receber</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={fieldLabel}>Categoria *</Label>
            <div className="flex gap-1.5">
              <Select value={form.category || undefined} onValueChange={(v) => handleChange("category", v)}>
                <SelectTrigger className="h-10 flex-1">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Row 2: Subcategoria + Fornecedor */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className={fieldLabel}>Subcategoria</Label>
            <div className="flex gap-1.5">
              <Input
                value={form.subcategory}
                onChange={(e) => handleChange("subcategory", e.target.value)}
                placeholder="Opcional"
                className="h-10 flex-1"
              />
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label className={fieldLabel}>Fornecedor *</Label>
            <div className="flex gap-1.5">
              <Input
                value={form.supplier}
                onChange={(e) => handleChange("supplier", e.target.value)}
                placeholder="Selecione..."
                className="h-10 flex-1"
              />
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Row 3: Descrição */}
        <div>
          <Label className={fieldLabel}>Descrição</Label>
          <Input
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="Descrição da conta"
            className="h-10"
          />
        </div>

        {/* Row 4: Valor + Vencimento */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className={fieldLabel}>Valor *</Label>
            <Input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => handleChange("amount", e.target.value)}
              placeholder="R$ 0,00"
              className="h-10"
            />
          </div>
          <div>
            <Label className={fieldLabel}>Vencimento *</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => handleChange("due_date", e.target.value)}
              className="h-10"
            />
          </div>
        </div>

        {/* Row 5: Recorrente */}
        <div className="flex items-center justify-between py-2 border-t">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Conta Recorrente</span>
          </div>
          <Switch
            checked={form.recurring}
            onCheckedChange={(v) => handleChange("recurring", v)}
          />
        </div>

        {/* Row 6: Já está paga */}
        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm font-medium">Já está paga</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Marque se a conta já foi paga para dar baixa automaticamente
            </p>
          </div>
          <Switch
            checked={form.paid}
            onCheckedChange={(v) => handleChange("paid", v)}
          />
        </div>

        {/* Submit */}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-12 text-base font-semibold gap-2"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          Criar Conta
        </Button>
      </div>
    </div>
  );
}