import React, { useState } from "react";
import { X, Search, MessageCircle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { saleReceiptMessage } from "@/lib/saleNumber";
import { toast } from "sonner";

/** @param {{ open: boolean, onClose: () => void, sale: any, customers?: any[], onLinkCustomer?: (c: any) => void }} props */
export default function SendWhatsAppDialog({ open, onClose, sale, customers = [], onLinkCustomer }) {
  const [tab, setTab] = useState("number");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");

  if (!sale) return null;

  const formatPhone = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const filtered = search
    ? customers.filter(
        (c) =>
          c.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.document?.includes(search)
      )
    : [];

  const handleSend = () => {
    const num = phone.replace(/\D/g, "");
    if (num.length < 10) {
      toast.error("Informe um número válido.");
      return;
    }
    const msg = saleReceiptMessage(sale, formatBRL(sale.total));
    window.open(`https://wa.me/55${num}?text=${encodeURIComponent(msg)}`, "_blank");
    onClose();
  };

  const handleSelectCustomer = (customer) => {
    if (onLinkCustomer) onLinkCustomer(customer);
    const num = customer.phone?.replace(/\D/g, "") || "";
    if (num) {
      const msg = saleReceiptMessage(sale, formatBRL(sale.total));
      window.open(`https://wa.me/55${num}?text=${encodeURIComponent(msg)}`, "_blank");
      onClose();
    } else {
      toast.error("Cliente sem telefone cadastrado.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* Header */}
        <div className="px-5 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-[#25d366]" />
              <h2 className="text-lg font-bold text-[#1f2937]">Enviar por WhatsApp</h2>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Esta venda não tem telefone. Informe um número ou vincule um cliente.
          </p>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="flex gap-1 p-1 bg-[#f4f6f5] rounded-lg">
            <button
              onClick={() => setTab("number")}
              className={`flex-1 py-2 text-sm rounded-md transition-colors ${
                tab === "number" ? "bg-white font-semibold text-[#1f2937] shadow-sm" : "text-muted-foreground"
              }`}
            >
              Informar número
            </button>
            <button
              onClick={() => setTab("customer")}
              className={`flex-1 py-2 text-sm rounded-md transition-colors ${
                tab === "customer" ? "bg-white font-semibold text-[#1f2937] shadow-sm" : "text-muted-foreground"
              }`}
            >
              Vincular cliente
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          {tab === "number" ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm text-[#1f2937] block mb-1.5">WhatsApp do cliente</label>
                <Input
                  placeholder="(00) 00000-0000"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  className="border-gray-300"
                />
              </div>
              <Button
                className="w-full gap-2 text-white hover:opacity-90"
                style={{ background: "#85c6a1" }}
                onClick={handleSend}
              >
                <MessageCircle className="w-4 h-4" /> Continuar envio
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou CPF/CNPJ..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 border-gray-300"
                />
              </div>
              <div className="min-h-[120px]">
                {search === "" ? (
                  <p className="text-center text-sm text-muted-foreground py-8">Digite para buscar clientes</p>
                ) : filtered.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">Nenhum cliente encontrado</p>
                ) : (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {filtered.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left p-2.5 rounded-lg hover:bg-muted transition-colors"
                      >
                        <p className="text-sm font-medium text-[#1f2937]">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.document || "Sem CPF/CNPJ"} · {c.phone || "Sem telefone"}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}