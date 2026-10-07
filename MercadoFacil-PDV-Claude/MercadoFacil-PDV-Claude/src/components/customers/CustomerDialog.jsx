import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/api/dataClient";
import { isOnline, createCustomerOffline } from "@/lib/dataLayer";
import { toast } from "sonner";
import {
  Loader2,
  MapPin,
  FileText,
  ChevronDown,
} from "lucide-react";

const TEAL = "#6B9A9A";
const TEXT = "#374151";
const BORDER = "#D1D5DB";
const BG = "#F9FAFB";

const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

/** @param {{ open: boolean, onClose: () => void, customer?: any, onSaved?: () => void, onSelect?: (c: any) => void }} props */
export default function CustomerDialog({ open, onClose, customer, onSaved, onSelect }) {
  const [form, setForm] = useState(/** @type {Record<string, any>} */ ({}));
  const [saving, setSaving] = useState(false);
  const refs = useRef({});

  useEffect(() => {
    if (open) {
      if (customer) {
        setForm({
          name: customer.name || "",
          document: customer.document || "",
          phone: customer.phone || "",
          email: customer.email || "",
          birthday: customer.birthday || "",
          cep: customer.cep || "",
          address: customer.address || "",
          address_number: customer.address_number || "",
          complement: customer.complement || "",
          neighborhood: customer.neighborhood || "",
          city: customer.city || "",
          state: customer.state || "",
          credit_limit: customer.credit_limit?.toString() || "",
          notes: customer.notes || "",
        });
      } else {
        setForm({
          name: "",
          document: "",
          phone: "",
          email: "",
          birthday: "",
          cep: "",
          address: "",
          address_number: "",
          complement: "",
          neighborhood: "",
          city: "",
          state: "",
          credit_limit: "",
          notes: "",
        });
      }
    }
  }, [customer, open]);

  const handleChange = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const isPF = () => {
    const doc = (form.document || "").replace(/\D/g, "");
    return doc.length <= 11;
  };

  // F10 to save
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "F10") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, form]);

  // Enter to go to next field
  const handleEnter = (e, nextField) => {
    if (e.key === "Enter" && nextField && refs.current[nextField]) {
      e.preventDefault();
      refs.current[nextField].focus();
    }
  };

  const setRef = (key) => (el) => {
    refs.current[key] = el;
  };

  const handleSave = async () => {
    if (!form.name) {
      toast.error("Preencha o nome.");
      refs.current["name"]?.focus();
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: form.name,
        document: form.document,
        phone: form.phone,
        email: form.email,
        birthday: form.birthday || undefined,
        cep: form.cep,
        address: form.address,
        address_number: form.address_number,
        complement: form.complement,
        neighborhood: form.neighborhood,
        city: form.city,
        state: form.state,
        credit_limit: parseFloat(form.credit_limit) || 0,
        notes: form.notes,
      };
      let created;
      if (customer) {
        await api.entities.Customer.update(customer.id, data);
        toast.success("Cliente atualizado!");
        created = { ...customer, ...data };
      } else {
        if (isOnline()) {
          created = await api.entities.Customer.create({
            ...data,
            credit_balance: 0,
          });
        } else {
          created = await createCustomerOffline({
            ...data,
            credit_balance: 0,
          });
        }
        toast.success("Cliente cadastrado!");
      }
      onSaved?.();
      // If in select flow (PDV), select the customer after creating
      if (onSelect && !customer) {
        onSelect(created);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao salvar cliente.");
    } finally {
      setSaving(false);
    }
  };

  const fieldOrder = [
    "document",
    "name",
    "phone",
    "email",
    "birthday",
  ];

  const inputClass =
    "h-10 rounded-lg border bg-white px-3 text-sm text-gray-700 placeholder:text-gray-400 transition-colors focus:outline-none focus:border-[#6B9A9A] focus:ring-2 focus:ring-[#6B9A9A]/20";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        style={{ background: BG }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <div>
            <DialogTitle
              className="text-xl font-bold leading-tight"
              style={{ color: TEXT }}
            >
              {customer ? "Editar Cliente" : "Novo Cliente"}
            </DialogTitle>
            <p className="text-xs mt-1" style={{ color: "#9CA3AF" }}>
              Enter • próximo campo • F10 • salvar • só o{" "}
              <span className="font-semibold">nome</span> é obrigatório
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-2 max-h-[60vh] overflow-y-auto">
          {/* Personal info grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* CPF/CNPJ */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Label
                  className="text-xs font-medium"
                  style={{ color: TEXT }}
                >
                  CPF / CNPJ
                </Label>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ background: `${TEAL}20`, color: TEAL }}
                >
                  {isPF() ? "PF" : "PJ"}
                </span>
              </div>
              <Input
                ref={setRef("document")}
                value={form.document || ""}
                onChange={(e) => handleChange("document", e.target.value)}
                onKeyDown={(e) => handleEnter(e, "name")}
                placeholder="000.000.000-00"
                className={inputClass}
                style={{ borderColor: BORDER }}
              />
            </div>

            {/* Nome */}
            <div className="sm:col-span-2">
              <div className="flex items-center gap-1 mb-1">
                <Label
                  className="text-xs font-medium"
                  style={{ color: TEXT }}
                >
                  Nome
                </Label>
                <span className="text-red-500 text-sm">*</span>
              </div>
              <Input
                ref={setRef("name")}
                value={form.name || ""}
                onChange={(e) => handleChange("name", e.target.value)}
                onKeyDown={(e) => handleEnter(e, "phone")}
                placeholder="Nome completo ou razão social"
                className={inputClass}
                style={{ borderColor: BORDER }}
              />
            </div>

            {/* WhatsApp */}
            <div>
              <Label
                className="text-xs font-medium mb-1 block"
                style={{ color: TEXT }}
              >
                WhatsApp
              </Label>
              <Input
                ref={setRef("phone")}
                value={form.phone || ""}
                onChange={(e) => handleChange("phone", e.target.value)}
                onKeyDown={(e) => handleEnter(e, "email")}
                placeholder="(00) 00000-0000"
                className={inputClass}
                style={{ borderColor: BORDER }}
              />
            </div>

            {/* Email */}
            <div>
              <Label
                className="text-xs font-medium mb-1 block"
                style={{ color: TEXT }}
              >
                Email (separe com ;)
              </Label>
              <Input
                ref={setRef("email")}
                type="email"
                value={form.email || ""}
                onChange={(e) => handleChange("email", e.target.value)}
                onKeyDown={(e) => handleEnter(e, "birthday")}
                placeholder="email@exemplo.com"
                className={inputClass}
                style={{ borderColor: BORDER }}
              />
            </div>

            {/* Nascimento */}
            <div>
              <Label
                className="text-xs font-medium mb-1 block"
                style={{ color: TEXT }}
              >
                Nascimento
              </Label>
              <Input
                ref={setRef("birthday")}
                type="date"
                value={form.birthday || ""}
                onChange={(e) => handleChange("birthday", e.target.value)}
                className={inputClass}
                style={{ borderColor: BORDER }}
              />
            </div>
          </div>

          {/* Endereço (expandable) */}
          <Accordion
            type="single"
            defaultValue="endereco"
            collapsible
            className="w-full mt-4"
          >
            <AccordionItem
              value="endereco"
              className="border rounded-lg px-3"
              style={{ borderColor: BORDER, background: "#fff" }}
            >
              <AccordionTrigger
                className="hover:no-underline py-3"
                style={{ color: TEXT }}
              >
                <span className="flex items-center gap-2 font-semibold text-sm">
                  <MapPin className="w-4 h-4" style={{ color: TEAL }} />
                  Endereço
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      CEP
                    </Label>
                    <Input
                      value={form.cep || ""}
                      onChange={(e) => handleChange("cep", e.target.value)}
                      placeholder="00000-000"
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      Logradouro
                    </Label>
                    <Input
                      value={form.address || ""}
                      onChange={(e) => handleChange("address", e.target.value)}
                      placeholder="Rua, Av..."
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      Número
                    </Label>
                    <Input
                      value={form.address_number || ""}
                      onChange={(e) =>
                        handleChange("address_number", e.target.value)
                      }
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      Complemento
                    </Label>
                    <Input
                      value={form.complement || ""}
                      onChange={(e) =>
                        handleChange("complement", e.target.value)
                      }
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      Bairro
                    </Label>
                    <Input
                      value={form.neighborhood || ""}
                      onChange={(e) =>
                        handleChange("neighborhood", e.target.value)
                      }
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      Cidade
                    </Label>
                    <Input
                      value={form.city || ""}
                      onChange={(e) => handleChange("city", e.target.value)}
                      className={inputClass}
                      style={{ borderColor: BORDER }}
                    />
                  </div>
                  <div>
                    <Label
                      className="text-xs font-medium mb-1 block"
                      style={{ color: TEXT }}
                    >
                      UF
                    </Label>
                    <div className="relative">
                      <select
                        value={form.state || ""}
                        onChange={(e) => handleChange("state", e.target.value)}
                        className={`${inputClass} w-full appearance-none pr-8`}
                        style={{ borderColor: BORDER }}
                      >
                        <option value="">—</option>
                        {UF_LIST.map((uf) => (
                          <option key={uf} value={uf}>
                            {uf}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        style={{ color: "#9CA3AF" }}
                      />
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t" style={{ borderColor: BORDER }}>
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 h-11 text-sm font-medium"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 h-11 text-sm font-semibold gap-2"
            style={{ background: TEAL, color: "#fff" }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {customer
              ? "Salvar alterações"
              : onSelect
                ? "Cadastrar e selecionar (F10)"
                : "Cadastrar (F10)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}