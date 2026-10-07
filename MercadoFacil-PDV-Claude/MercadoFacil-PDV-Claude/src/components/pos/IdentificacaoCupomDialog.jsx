import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadCustomers as loadCustomersData } from "@/lib/dataLayer";

const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

const formatDoc = (raw) => {
  const digits = onlyDigits(raw).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};

function isValidCpf(cpf) {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let rev = (sum * 10) % 11;
  if (rev === 10) rev = 0;
  if (rev !== Number(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  rev = (sum * 10) % 11;
  if (rev === 10) rev = 0;
  return rev === Number(d[10]);
}

function isValidCnpj(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (base, factors) => {
    let sum = 0;
    for (let i = 0; i < factors.length; i++) sum += Number(base[i]) * factors[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const f1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const f2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(d, f1);
  if (d1 !== Number(d[12])) return false;
  return calc(d, f2) === Number(d[13]);
}

function normalizeDocKey(doc) {
  return onlyDigits(doc);
}

export default function IdentificacaoCupomDialog({ open, onClose, onConfirm, customer }) {
  const [document, setDocument] = useState("");
  const [touched, setTouched] = useState(false);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    if (!open) return;
    setDocument(customer?.document ? formatDoc(customer.document) : "");
    setTouched(false);
    loadCustomersData()
      .then((list) => setCustomers(Array.isArray(list) ? list : []))
      .catch(() => setCustomers([]));
  }, [open, customer]);

  const digits = onlyDigits(document);
  const isCpfLen = digits.length > 0 && digits.length <= 11;
  const isComplete = digits.length === 11 || digits.length === 14;

  const docError = useMemo(() => {
    if (!touched || !digits) return "";
    if (digits.length < 11) return "";
    if (digits.length === 11) {
      if (!isValidCpf(digits)) return "CPF inexistente, confira!";
      return "";
    }
    if (digits.length > 11 && digits.length < 14) return "";
    if (digits.length === 14) {
      if (!isValidCnpj(digits)) return "CNPJ inexistente, confira!";
      return "";
    }
    return "";
  }, [digits, touched]);

  const matchedCustomer = useMemo(() => {
    if (!isComplete || docError) return null;
    const key = normalizeDocKey(document);
    return (
      customers.find((c) => normalizeDocKey(c.document) === key) ||
      (customer && normalizeDocKey(customer.document) === key ? customer : null)
    );
  }, [customers, customer, document, isComplete, docError]);

  const handleChange = (e) => {
    setDocument(formatDoc(e.target.value));
    setTouched(true);
  };

  const handleWithDoc = () => {
    setTouched(true);
    const d = onlyDigits(document);
    if (d.length === 11 && !isValidCpf(d)) return;
    if (d.length === 14 && !isValidCnpj(d)) return;
    if (d.length !== 11 && d.length !== 14) return;
    onConfirm?.(formatDoc(d), matchedCustomer || null);
    onClose();
  };

  const handleNoDoc = () => {
    onConfirm?.("", null);
    onClose();
  };

  const canConfirm =
    isComplete && !docError && (digits.length === 11 ? isValidCpf(digits) : isValidCnpj(digits));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="text-base font-bold">Identificação no Cupom</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Deseja informar CPF ou CNPJ no cupom fiscal?
          </p>

          {matchedCustomer?.name && (
            <p className="text-xs text-primary font-medium">
              Cliente encontrado: {matchedCustomer.name}
            </p>
          )}

          <div className="space-y-1.5">
            <Input
              value={document}
              onChange={handleChange}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (canConfirm) handleWithDoc();
                  else setTouched(true);
                }
              }}
              placeholder="000.000.000-00"
              className={
                docError
                  ? "border-red-500 focus-visible:ring-red-500"
                  : "border-primary"
              }
              autoFocus
              inputMode="numeric"
            />
            {docError ? (
              <p className="text-xs font-medium text-red-600">{docError}</p>
            ) : isCpfLen && digits.length === 11 && !docError ? (
              <p className="text-xs text-muted-foreground">CPF válido para o cupom</p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleNoDoc} className="flex-1">
              Sem documento
            </Button>
            <Button onClick={handleWithDoc} disabled={!canConfirm} className="flex-1">
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
