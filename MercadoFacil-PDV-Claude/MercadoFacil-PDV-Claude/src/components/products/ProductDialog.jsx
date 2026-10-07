import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { semZerosAEsquerda } from "@/lib/numberInput";
import { pick, PRODUCT_FIELDS } from "@/lib/safePayload";
import { withCompanyId } from "@/lib/companyContext";
import { createProduct, updateProduct } from "@/lib/productStore";
import { isOnline } from "@/lib/dataLayer";
import { getTerminalId } from "@/lib/terminal";
import { v4 as uuidv4 } from "uuid";
import GroupsDialog from "@/components/products/GroupsDialog";
import BrandsDialog from "@/components/products/BrandsDialog";
import {
  Loader2,
  Package,
  Plus,
  Zap,
  MessageSquare,
  FileText,
  Camera,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/mensagemErro";

const units = [
  { value: "UN", label: "UN - Unidade" },
  { value: "KG", label: "KG - Quilograma" },
  { value: "LT", label: "LT - Litro" },
  { value: "CX", label: "CX - Caixa" },
  { value: "PCT", label: "PCT - Pacote" },
  { value: "M", label: "M - Metro" },
  { value: "G", label: "G - Grama" },
  { value: "ML", label: "ML - Mililitro" },
];

const channelOptions = ["Delivery", "Loja", "Online", "Todos"];

export default function ProductDialog({ open, onClose, product, categories, onSaved }) {
  const { user } = useAuth();
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({}));
  // Estoque no banco no momento em que o formulário foi aberto — nunca o
  // valor atual de `product` (a venda que roda com o diálogo aberto não
  // atualiza essa prop). Serve só para medir o que o operador MUDOU no campo
  // Estoque, nunca para decidir o valor final gravado.
  const [baselineStock, setBaselineStock] = useState(0);
  const [saving, setSaving] = useState(false);
  const [costBase, setCostBase] = useState("cost");
  const [showSection, setShowSection] = useState(/** @type {Record<string, any>} */ ({}));
  const [localCategories, setLocalCategories] = useState(categories || []);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setLocalCategories(categories || []);
  }, [categories]);

  useEffect(() => {
    if (open) {
      if (product) {
        setForm({
          name: product.name || "",
          code: product.code || "",
          barcode: product.barcode || "",
          reference: product.reference || "",
          price: product.price?.toString() || "",
          cost: product.cost?.toString() || "",
          average_cost: product.average_cost?.toString() || "",
          stock: product.stock?.toString() || "",
          min_stock: product.min_stock?.toString() || "5",
          category: product.category || "",
          subcategory: product.subcategory || "",
          brand: product.brand || "",
          channels: product.channels || "Delivery",
          unit: product.unit || "UN",
          image_url: product.image_url || "",
          notes: product.notes || "",
          promo: product.promo || false,
          fiscal_info: product.fiscal_info || "",
          ncm: product.ncm || "",
          cest: product.cest || "",
          cfop: product.cfop || "",
          origin: product.origin || "",
          icms_csosn: product.icms_csosn || "",
          pis_cst: product.pis_cst || "",
          cofins_cst: product.cofins_cst || "",
          ibscbs_cst: product.ibscbs_cst || "",
          ibscbs_class_trib: product.ibscbs_class_trib || "",
          gtin: product.gtin || "",
          active: product.active !== false,
        });
        setBaselineStock(Number(product.stock) || 0);
      } else {
        setForm({
          name: "",
          code: "",
          barcode: "",
          reference: "",
          price: "",
          cost: "",
          average_cost: "",
          stock: "0",
          min_stock: "0",
          category: "",
          subcategory: "",
          brand: "",
          channels: "Delivery",
          unit: "UN",
          image_url: "",
          notes: "",
          promo: false,
          fiscal_info: "",
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
          active: true,
        });
      }
      setShowSection({});
    }
  }, [product, open]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleSection = (key) => {
    setShowSection((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.files.upload({ file });
      handleChange("image_url", res.file_url);
      toast.success("Foto carregada!");
    } catch (err) {
      toast.error("Erro ao carregar foto.");
    }
  };

  const costValue = parseFloat(form[costBase] || "0") || 0;
  const priceValue = parseFloat(form.price || "0") || 0;
  const lucro = costValue > 0 ? ((priceValue - costValue) / costValue) * 100 : 0;

  const handleSave = async () => {
    if (!form.name || !form.price) {
      toast.error("Preencha nome e preço.");
      return;
    }
    if (!form.category) {
      toast.error("Selecione ou cadastre um grupo (+).");
      return;
    }
    // O banco recusa formato inválido com erro de constraint, que não diz ao
    // lojista qual campo errou. A mensagem sai daqui.
    if (form.ncm && !/^\d{8}$/.test(form.ncm)) {
      toast.error("NCM precisa ter 8 dígitos.");
      return;
    }
    if (form.cest && !/^\d{7}$/.test(form.cest)) {
      toast.error("CEST precisa ter 7 dígitos.");
      return;
    }
    if (form.cfop && !/^\d{4}$/.test(form.cfop)) {
      toast.error("CFOP precisa ter 4 dígitos.");
      return;
    }
    setSaving(true);
    try {
      const data = pick(
        withCompanyId(
          {
            name: form.name,
            code: form.code,
            barcode: form.barcode,
            reference: form.reference,
            price: parseFloat(form.price) || 0,
            cost: parseFloat(form.cost) || 0,
            average_cost: parseFloat(form.average_cost) || 0,
            // Estoque NUNCA vai aqui em edição — ver bloco abaixo do
            // updateProduct(). Sobrescrever a coluna direto apagaria a baixa
            // de uma venda feita com o diálogo aberto (a prop `product` é um
            // retrato de quando o diálogo abriu, não do estoque agora). Em
            // produto novo não há esse risco: ainda não existe linha pra
            // colidir com uma venda concorrente.
            stock: product ? undefined : parseFloat(form.stock) || 0,
            min_stock: parseFloat(form.min_stock) || 0,
            category: form.category,
            subcategory: form.subcategory,
            brand: form.brand,
            channels: form.channels,
            unit: form.unit,
            image_url: form.image_url,
            notes: form.notes,
            promo: form.promo,
            fiscal_info: form.fiscal_info,
            // Campo fiscal em branco vai como null: string vazia bate na
            // constraint de formato do banco (NCM de 8 dígitos, CEST de 7).
            ncm: form.ncm || null,
            cest: form.cest || null,
            cfop: form.cfop || null,
            origin: form.origin || null,
            icms_csosn: form.icms_csosn || null,
            pis_cst: form.pis_cst || null,
            cofins_cst: form.cofins_cst || null,
            ibscbs_cst: form.ibscbs_cst || null,
            ibscbs_class_trib: form.ibscbs_class_trib || null,
            gtin: form.gtin || null,
            active: form.active,
          },
          user
        ),
        PRODUCT_FIELDS
      );
      if (product) {
        await updateProduct(product.id, data);

        // Estoque mudou no campo? Isso é um ajuste manual, não a verdade
        // final — vira movimentação auditada (apply_stock_movement) aplicada
        // sobre o estoque REAL atual, nunca uma sobrescrita do valor
        // digitado. Campo intocado (delta 0) não gera movimentação nenhuma.
        const novoValor = parseFloat(form.stock) || 0;
        const delta = novoValor - baselineStock;
        // Só vale "Produto atualizado!" se o estoque digitado de fato foi aplicado. Antes, sem
        // conexão (ou com saldo insuficiente) saía o aviso e logo depois o sucesso, a janela
        // fechava e a lista continuava com o estoque antigo — parecia que o salvar falhou em silêncio.
        let estoqueAplicado = true;
        if (delta !== 0) {
          if (!isOnline()) {
            estoqueAplicado = false;
            toast.error(
              "Estoque NÃO foi alterado: o ajuste manual de estoque exige conexão (fica registrado e auditado). Os outros campos foram salvos. Conecte à internet e salve de novo."
            );
          } else {
            const resultado = await api.stock.applyMovement({
              clientId: uuidv4(),
              productId: product.id,
              quantity: Math.abs(delta),
              productName: form.name,
              type: delta > 0 ? "entrada" : "saida",
              reason: "ajuste_manual",
              notes: "Ajuste manual via cadastro de produto",
              terminalId: getTerminalId(),
            });
            if (resultado?.applied === false && resultado.reason === "insufficient_stock") {
              estoqueAplicado = false;
              toast.error(
                "Ajuste não aplicado: estoque atual é menor que a redução pedida (outra venda pode ter mexido nele). Confira o estoque e tente de novo."
              );
            }
          }
        }

        if (!estoqueAplicado) {
          // Mantém a janela aberta com o valor digitado; a lista é recarregada com o que foi salvo.
          onSaved?.();
          return;
        }
        toast.success("Produto atualizado!");
      } else {
        await createProduct(data);
        toast.success("Produto cadastrado!");
      }
      onSaved?.();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(mensagemDeErro(e, "salvar o produto"));
    } finally {
      setSaving(false);
    }
  };

  const fieldLabel = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase";
  const sectionBorder = "border-t border-border";

  const utilityButtons = [
    { key: "promo", icon: Zap, label: "Promo" },
    { key: "obs", icon: MessageSquare, label: "Obs." },
    { key: "fiscal", icon: FileText, label: "Fiscal" },
    { key: "foto", icon: Camera, label: "Foto" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-4 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Package className="w-4.5 h-4.5 text-primary" />
            </div>
            <DialogTitle className="text-base font-bold">
              {product ? "Editar Produto" : "Novo Produto"}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="px-4 pb-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Section 1: Identification */}
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className={fieldLabel}>Código</label>
                <Input
                  value={form.code || ""}
                  onChange={(e) => handleChange("code", e.target.value)}
                  placeholder="0"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>EAN</label>
                <Input
                  value={form.barcode || ""}
                  onChange={(e) => handleChange("barcode", e.target.value)}
                  placeholder="Código de barras"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Referência</label>
                <Input
                  value={form.reference || ""}
                  onChange={(e) => handleChange("reference", e.target.value)}
                  placeholder="REF (opcional)"
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={fieldLabel}>Nome *</label>
              <Input
                value={form.name || ""}
                onChange={(e) => handleChange("name", e.target.value)}
                placeholder="Nome do produto"
                className="h-9"
              />
            </div>
          </div>

          {/* Section 2: Classification */}
          <div className={`${sectionBorder} pt-3 space-y-3`}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className={fieldLabel}>Grupo *</label>
                <div className="flex gap-1">
                  <Select
                    value={form.category || undefined}
                    onValueChange={(v) => handleChange("category", v)}
                  >
                    <SelectTrigger className="h-9 flex-1">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {localCategories?.map((c) => (
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title="Novo grupo"
                    onClick={() => setGroupsOpen(true)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Subgrupo</label>
                <div className="flex gap-1">
                  <Input
                    value={form.subcategory || ""}
                    onChange={(e) => handleChange("subcategory", e.target.value)}
                    placeholder="Opcional"
                    className="h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title="Digite o subgrupo no campo"
                    onClick={() => {
                      const name = window.prompt("Nome do subgrupo:");
                      if (name?.trim()) handleChange("subcategory", name.trim());
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Marca</label>
                <div className="flex gap-1">
                  <Input
                    value={form.brand || ""}
                    onChange={(e) => handleChange("brand", e.target.value)}
                    placeholder="Opcional"
                    className="h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title="Gerenciar marcas"
                    onClick={() => setBrandsOpen(true)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Canais</label>
                <Select
                  value={form.channels || "Delivery"}
                  onValueChange={(v) => handleChange("channels", v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channelOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Section 3: Stock */}
          <div className={`${sectionBorder} pt-3 space-y-3`}>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className={fieldLabel}>Estoque</label>
                <Input
                  type="number"
                  value={form.stock ?? ""}
                  onChange={(e) => handleChange("stock", semZerosAEsquerda(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => !form.stock && handleChange("stock", "0")}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Est. Mínimo</label>
                <Input
                  type="number"
                  value={form.min_stock ?? ""}
                  onChange={(e) => handleChange("min_stock", semZerosAEsquerda(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  onBlur={() => !form.min_stock && handleChange("min_stock", "0")}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Unidade</label>
                <Select
                  value={form.unit || "UN"}
                  onValueChange={(v) => handleChange("unit", v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Section 4: Financial */}
          <div className={`${sectionBorder} pt-3 space-y-3`}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className={fieldLabel}>Custo</label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.cost || ""}
                    onChange={(e) => handleChange("cost", e.target.value)}
                    className="h-9 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setCostBase("cost")}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-medium",
                      costBase === "cost" ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <span className={cn(
                      "w-2.5 h-2.5 rounded-full border-2",
                      costBase === "cost" ? "border-primary bg-primary" : "border-muted-foreground/40"
                    )} />
                    base
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Custo Med.</label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.average_cost || ""}
                    onChange={(e) => handleChange("average_cost", e.target.value)}
                    className="h-9 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setCostBase("average_cost")}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] font-medium",
                      costBase === "average_cost" ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    <span className={cn(
                      "w-2.5 h-2.5 rounded-full border-2",
                      costBase === "average_cost" ? "border-primary bg-primary" : "border-muted-foreground/40"
                    )} />
                    base
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Lucro %</label>
                <div className="relative">
                  <Input
                    value={lucro.toFixed(1) + "%"}
                    readOnly
                    className="h-9 pr-8 bg-muted/50"
                  />
                  <Info className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <label className={fieldLabel}>Pr. Venda *</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price || ""}
                  onChange={(e) => handleChange("price", e.target.value)}
                  placeholder="0,00"
                  className="h-9"
                />
              </div>
            </div>
          </div>

          {/* Utility buttons */}
          <div className={`${sectionBorder} pt-3`}>
            <div className="flex items-center justify-center gap-2">
              {utilityButtons.map((btn) => {
                const Icon = btn.icon;
                const active = showSection[btn.key];
                return (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={() => toggleSection(btn.key)}
                    className={cn(
                      "flex flex-col items-center gap-1 px-4 py-2 rounded-lg border text-xs font-medium transition-all",
                      active
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {btn.label}
                  </button>
                );
              })}
            </div>

            {/* Expandable sections */}
            {showSection.promo && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.promo || false}
                    onChange={(e) => handleChange("promo", e.target.checked)}
                    className="custom-checkbox"
                  />
                  Produto em promoção
                </label>
              </div>
            )}
            {showSection.obs && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-1">
                <label className={fieldLabel}>Observações</label>
                <textarea
                  value={form.notes || ""}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  placeholder="Observações sobre o produto..."
                  className="w-full text-sm p-2 rounded-md border border-input bg-transparent resize-none"
                  rows={3}
                />
              </div>
            )}
            {showSection.fiscal && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Estes campos vão para o XML da nota. Sem NCM a emissão é recusada
                  pelo autorizador.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className={fieldLabel}>NCM (8 dígitos)</label>
                    <Input
                      value={form.ncm || ""}
                      onChange={(e) =>
                        handleChange("ncm", e.target.value.replace(/\D/g, "").slice(0, 8))
                      }
                      placeholder="10063021"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={fieldLabel}>CEST (7 dígitos)</label>
                    <Input
                      value={form.cest || ""}
                      onChange={(e) =>
                        handleChange("cest", e.target.value.replace(/\D/g, "").slice(0, 7))
                      }
                      placeholder="Só para produto com ST"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={fieldLabel}>CFOP (4 dígitos)</label>
                    <Input
                      value={form.cfop || ""}
                      onChange={(e) =>
                        handleChange("cfop", e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                      placeholder="5102"
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={fieldLabel}>Origem</label>
                    <select
                      value={form.origin || ""}
                      onChange={(e) => handleChange("origin", e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="">Selecione</option>
                      <option value="0">0 — Nacional</option>
                      <option value="1">1 — Estrangeira, importação direta</option>
                      <option value="2">2 — Estrangeira, mercado interno</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={fieldLabel}>CSOSN</label>
                    <select
                      value={form.icms_csosn || ""}
                      onChange={(e) => handleChange("icms_csosn", e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      <option value="">Selecione</option>
                      <option value="101">101 — Com permissão de crédito</option>
                      <option value="102">102 — Sem permissão de crédito</option>
                      <option value="103">103 — Isenção por faixa de receita</option>
                      <option value="300">300 — Imune</option>
                      <option value="400">400 — Não tributada</option>
                      <option value="500">500 — ICMS cobrado por ST</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={fieldLabel}>GTIN / EAN</label>
                    <Input
                      value={form.gtin || ""}
                      onChange={(e) => handleChange("gtin", e.target.value.trim())}
                      placeholder="Código de barras GS1"
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={fieldLabel}>Anotação fiscal (uso interno)</label>
                  <Input
                    value={form.fiscal_info || ""}
                    onChange={(e) => handleChange("fiscal_info", e.target.value)}
                    placeholder="Observação do contador, não vai para a nota"
                    className="h-9"
                  />
                </div>
              </div>
            )}
            {showSection.foto && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                {form.image_url ? (
                  <div className="flex items-center gap-3">
                    <img src={form.image_url} alt="Produto" className="w-16 h-16 rounded-lg object-cover border" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileRef.current?.click()}
                    >
                      Trocar foto
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleChange("image_url", "")}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    className="w-full gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    Carregar foto do produto
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full h-11 font-medium gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {product ? "Salvar Alterações" : "Cadastrar"}
          </Button>
        </div>
      </DialogContent>

      <GroupsDialog
        open={groupsOpen}
        onClose={() => setGroupsOpen(false)}
        onSaved={async () => {
          const { listCategories } = await import("@/lib/productStore");
          const cats = await listCategories();
          setLocalCategories(cats);
          onSaved?.();
        }}
      />
      <BrandsDialog
        open={brandsOpen}
        onClose={() => setBrandsOpen(false)}
        onSaved={(brandName) => {
          if (brandName) handleChange("brand", brandName);
          onSaved?.();
        }}
      />
    </Dialog>
  );
}