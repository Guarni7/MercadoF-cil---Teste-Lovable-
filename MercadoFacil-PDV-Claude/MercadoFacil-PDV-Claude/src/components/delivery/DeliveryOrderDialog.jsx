import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Minus, Trash2, Loader2, MapPin, User, Phone } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { toast } from "sonner";
import { mensagemDeErro } from "@/lib/mensagemErro";

const STATUSES = ["pendente", "preparando", "saiu_entrega", "entregue", "cancelado"];
const PAYMENTS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "pix", label: "PIX" },
  { value: "credito", label: "Crédito" },
  { value: "debito", label: "Débito" },
  { value: "cartao_entrega", label: "Cartão na Entrega" },
];

export default function DeliveryOrderDialog({ open, onClose, onSaved, editingOrder }) {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState([]);

  const [deliveryFee, setDeliveryFee] = useState(/** @type {number | string} */ (0));
  const [discount, setDiscount] = useState(/** @type {number | string} */ (0));
  const [paymentMethod, setPaymentMethod] = useState("dinheiro");
  const [status, setStatus] = useState("pendente");
  const [deliveryPerson, setDeliveryPerson] = useState("");
  const [notes, setNotes] = useState("");

  const [addr, setAddr] = useState({ cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "" });

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  useEffect(() => {
    if (editingOrder) fillEditing(editingOrder);
    else resetForm();
  }, [editingOrder, open]);

  async function loadData() {
    setLoading(true);
    try {
      const [cust, prod] = await Promise.all([
        api.entities.Customer.list(),
        api.entities.Product.list(),
      ]);
      setCustomers(cust || []);
      setProducts((prod || []).filter((p) => p.active !== false));
    } catch (e) {
      toast.error("Erro ao carregar dados");
    }
    setLoading(false);
  }

  function resetForm() {
    setCustomerSearch(""); setSelectedCustomerId(""); setCustomerName(""); setCustomerPhone("");
    setProductSearch(""); setItems([]);
    setDeliveryFee(0); setDiscount(0); setPaymentMethod("dinheiro"); setStatus("pendente");
    setDeliveryPerson(""); setNotes("");
    setAddr({ cep: "", address: "", address_number: "", complement: "", neighborhood: "", city: "", state: "" });
  }

  function fillEditing(o) {
    setSelectedCustomerId(o.customer_id || "");
    setCustomerName(o.customer_name || "");
    setCustomerPhone(o.customer_phone || "");
    setItems(o.items || []);
    setDeliveryFee(o.delivery_fee || 0);
    setDiscount(o.discount || 0);
    setPaymentMethod(o.payment_method || "dinheiro");
    setStatus(o.status || "pendente");
    setDeliveryPerson(o.delivery_person || "");
    setNotes(o.notes || "");
    setAddr({
      cep: o.cep || "", address: o.address || "", address_number: o.address_number || "",
      complement: o.complement || "", neighborhood: o.neighborhood || "",
      city: o.city || "", state: o.state || "",
    });
  }

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 8);
    const s = customerSearch.toLowerCase();
    return customers.filter((c) =>
      c.name?.toLowerCase().includes(s) || c.phone?.includes(s) || c.document?.includes(s)
    ).slice(0, 8);
  }, [customers, customerSearch]);

  function selectCustomer(c) {
    setSelectedCustomerId(c.id);
    setCustomerName(c.name || "");
    setCustomerPhone(c.phone || "");
    setCustomerSearch("");
    if (c.cep || c.address) {
      setAddr({
        cep: c.cep || "", address: c.address || "", address_number: c.address_number || "",
        complement: c.complement || "", neighborhood: c.neighborhood || "",
        city: c.city || "", state: c.state || "",
      });
    }
  }

  const filteredProducts = useMemo(() => {
    if (!productSearch) return [];
    const s = productSearch.toLowerCase();
    return products.filter((p) =>
      p.name?.toLowerCase().includes(s) || p.barcode?.includes(s) || p.code?.includes(s)
    ).slice(0, 6);
  }, [products, productSearch]);

  function addProduct(p) {
    setItems((prev) => {
      const ex = prev.find((i) => i.product_id === p.id);
      if (ex) {
        return prev.map((i) => i.product_id === p.id ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.price } : i);
      }
      return [...prev, { product_id: p.id, name: p.name, price: p.price, quantity: 1, total: p.price }];
    });
    setProductSearch("");
  }

  function updateQty(id, delta) {
    setItems((prev) => prev.map((i) => {
      if (i.product_id !== id) return i;
      const q = Math.max(1, i.quantity + delta);
      return { ...i, quantity: q, total: q * i.price };
    }));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((i) => i.product_id !== id));
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const total = Math.max(0, subtotal + (Number(deliveryFee) || 0) - (Number(discount) || 0));

  async function handleSave() {
    if (!customerName.trim()) { toast.error("Informe o nome do cliente"); return; }
    if (items.length === 0) { toast.error("Adicione ao menos 1 item"); return; }
    setSaving(true);
    try {
      const payload = {
        customer_id: selectedCustomerId || undefined,
        customer_name: customerName,
        customer_phone: customerPhone,
        items, subtotal, delivery_fee: Number(deliveryFee) || 0,
        discount: Number(discount) || 0, total, payment_method: paymentMethod,
        status, delivery_person: deliveryPerson, notes, ...addr,
      };
      if (editingOrder) {
        await api.entities.DeliveryOrder.update(editingOrder.id, payload);
        toast.success("Pedido atualizado");
      } else {
        const all = await api.entities.DeliveryOrder.list();
        const maxNum = all.reduce((m, o) => Math.max(m, o.number || 0), 0);
        await api.entities.DeliveryOrder.create({ ...payload, number: maxNum + 1 });
        toast.success("Pedido criado");
      }
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error("Erro ao salvar pedido:", e);
      toast.error(mensagemDeErro(e, "salvar o pedido"));
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingOrder ? "Editar Pedido" : "Novo Pedido de Delivery"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5">
            {/* Cliente */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Cliente</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar cliente existente..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {customerSearch && filteredCustomers.length > 0 && (
                <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                  {filteredCustomers.map((c) => (
                    <button key={c.id} onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2 text-sm">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{c.name}</span>
                      {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Nome *</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome do cliente" />
                </div>
                <div>
                  <Label className="text-xs">WhatsApp</Label>
                  <div className="relative">
                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="(00) 00000-0000" className="pl-8" />
                  </div>
                </div>
              </div>
            </div>

            {/* Produtos */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Itens do Pedido</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar produto para adicionar..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {productSearch && filteredProducts.length > 0 && (
                <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
                  {filteredProducts.map((p) => (
                    <button key={p.id} onClick={() => addProduct(p)}
                      className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between text-sm">
                      <span>{p.name}</span>
                      <span className="text-muted-foreground">{formatBRL(p.price)}</span>
                    </button>
                  ))}
                </div>
              )}
              {items.length > 0 && (
                <div className="border rounded-lg divide-y">
                  {items.map((i) => (
                    <div key={i.product_id} className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{i.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBRL(i.price)} un.</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.product_id, -1)}><Minus className="w-3.5 h-3.5" /></Button>
                        <span className="w-8 text-center text-sm">{i.quantity}</span>
                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.product_id, 1)}><Plus className="w-3.5 h-3.5" /></Button>
                      </div>
                      <span className="w-20 text-right text-sm font-medium">{formatBRL(i.total)}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeItem(i.product_id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Endereço */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Endereço de Entrega</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="CEP" value={addr.cep} onChange={(e) => setAddr({ ...addr, cep: e.target.value })} />
                <Input placeholder="Logradouro" className="col-span-2" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Número" value={addr.address_number} onChange={(e) => setAddr({ ...addr, address_number: e.target.value })} />
                <Input placeholder="Complemento" className="col-span-2" value={addr.complement} onChange={(e) => setAddr({ ...addr, complement: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Bairro" value={addr.neighborhood} onChange={(e) => setAddr({ ...addr, neighborhood: e.target.value })} />
                <Input placeholder="Cidade" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
                <Input placeholder="UF" maxLength={2} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value.toUpperCase() })} />
              </div>
            </div>

            {/* Pagamento e taxas */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Forma de Pagamento</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {editingOrder && (
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Taxa de Entrega</Label>
                <Input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Desconto</Label>
                <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Entregador</Label>
                <Input value={deliveryPerson} onChange={(e) => setDeliveryPerson(e.target.value)} placeholder="Nome" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex: sem cebola, troco para R$50" />
            </div>

            {/* Totais */}
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatBRL(subtotal)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Taxa de Entrega</span><span>{formatBRL(Number(deliveryFee) || 0)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Desconto</span><span>-{formatBRL(Number(discount) || 0)}</span></div>
              <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span className="text-primary">{formatBRL(total)}</span></div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            {editingOrder ? "Salvar Alterações" : "Criar Pedido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}