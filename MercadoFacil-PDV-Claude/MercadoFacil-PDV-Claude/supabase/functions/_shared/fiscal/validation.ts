// Validação fiscal — primeira etapa do fluxo de emissão.
//
// Roda antes de montar o documento para que o erro apareça como "falta o NCM do
// produto X" em vez de voltar da SEFAZ como rejeição 999 três minutos depois.
// Nada aqui preenche valor padrão: campo obrigatório ausente é erro.

import type { FiscalItem } from "./taxEngine.ts";

export type FiscalSettings = {
  company_id: string;
  cnpj?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  ie?: string | null;
  ie_isento?: boolean;
  im?: string | null;
  uf?: string | null;
  city_name?: string | null;
  city_ibge_code?: string | null;
  cnae_main?: string | null;
  tax_regime?: string | null;
  crt?: string | null;
  taxpayer_type?: string | null;
  mei_scope?: string | null;
  environment?: string | null;
  nfce_enabled?: boolean;
  nfe_enabled?: boolean;
  nfse_enabled?: boolean;
  address?: string | null;
  address_number?: string | null;
  neighborhood?: string | null;
  cep?: string | null;
  certificate_valid_until?: string | null;
};

export type ValidationIssue = { field: string; message: string };

const onlyDigits = (v?: string | null) => String(v ?? "").replace(/\D/g, "");

// Dígitos verificadores do CNPJ. Mantido aqui porque validar antes evita
// consumir um número da série com um emitente impossível.
export const isValidCnpj = (value?: string | null) => {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const check = (length: number) => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += Number(cnpj[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return check(12) === Number(cnpj[12]) && check(13) === Number(cnpj[13]);
};

export const isValidCpf = (value?: string | null) => {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return check(9) === Number(cpf[9]) && check(10) === Number(cpf[10]);
};

export const validateSettings = (
  settings: FiscalSettings | null,
  model: "55" | "65" | "nfse",
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!settings) {
    return [{ field: "fiscal", message: "Configuração fiscal da empresa não preenchida" }];
  }

  if (!isValidCnpj(settings.cnpj)) {
    issues.push({ field: "cnpj", message: "CNPJ do emitente inválido ou não preenchido" });
  }
  if (!settings.legal_name) issues.push({ field: "legal_name", message: "Razão social não preenchida" });
  if (!settings.uf) issues.push({ field: "uf", message: "UF do emitente não preenchida" });
  if (!settings.city_ibge_code) {
    issues.push({ field: "city_ibge_code", message: "Código IBGE do município não preenchido" });
  }
  if (!settings.crt) issues.push({ field: "crt", message: "CRT (regime tributário) não definido" });
  if (!settings.environment) issues.push({ field: "environment", message: "Ambiente de emissão não definido" });

  if (model === "55" || model === "65") {
    // Contribuinte de ICMS sem IE não emite NF-e/NFC-e; isento precisa estar
    // marcado como isento, não deixado em branco.
    if (!settings.ie && !settings.ie_isento) {
      issues.push({ field: "ie", message: "Inscrição estadual não preenchida (marque isento se for o caso)" });
    }
    if (model === "65" && !settings.nfce_enabled) {
      issues.push({ field: "nfce_enabled", message: "Emissão de NFC-e não está habilitada nas configurações" });
    }
    if (model === "55" && !settings.nfe_enabled) {
      issues.push({ field: "nfe_enabled", message: "Emissão de NF-e não está habilitada nas configurações" });
    }
    if (!settings.address || !settings.address_number || !settings.neighborhood || !settings.cep) {
      issues.push({ field: "address", message: "Endereço fiscal incompleto (logradouro, número, bairro e CEP)" });
    }
  }

  if (model === "nfse") {
    if (!settings.nfse_enabled) {
      issues.push({ field: "nfse_enabled", message: "Emissão de NFS-e não está habilitada nas configurações" });
    }
    if (!settings.im && settings.tax_regime !== "mei") {
      issues.push({ field: "im", message: "Inscrição municipal não preenchida" });
    }
    if (settings.tax_regime === "mei" && settings.mei_scope === "mercadorias") {
      issues.push({
        field: "mei_scope",
        message: "Empresa marcada como MEI apenas de mercadorias — habilite serviços para emitir NFS-e",
      });
    }
  }

  if (settings.certificate_valid_until) {
    const validUntil = new Date(settings.certificate_valid_until);
    if (validUntil.getTime() < Date.now()) {
      issues.push({ field: "certificate", message: "Certificado digital vencido" });
    }
  }

  return issues;
};

export const validateItems = (
  items: FiscalItem[],
  model: "55" | "65" | "nfse",
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (!items.length) {
    return [{ field: "items", message: "Documento sem itens" }];
  }

  items.forEach((item, index) => {
    const label = item.name || `item ${index + 1}`;

    if (!item.quantity || item.quantity <= 0) {
      issues.push({ field: `items[${index}].quantity`, message: `${label}: quantidade inválida` });
    }
    if (item.total === null || item.total === undefined || item.total < 0) {
      issues.push({ field: `items[${index}].total`, message: `${label}: valor inválido` });
    }

    if (model === "55" || model === "65") {
      if (!item.ncm) {
        issues.push({ field: `items[${index}].ncm`, message: `${label}: NCM não cadastrado` });
      } else if (!/^\d{8}$/.test(String(item.ncm))) {
        issues.push({ field: `items[${index}].ncm`, message: `${label}: NCM deve ter 8 dígitos` });
      }
      if (!item.cfop) {
        issues.push({ field: `items[${index}].cfop`, message: `${label}: CFOP não definido` });
      }
      if (!item.unit) {
        issues.push({ field: `items[${index}].unit`, message: `${label}: unidade comercial não definida` });
      }
      if (item.origin === null || item.origin === undefined || item.origin === "") {
        issues.push({ field: `items[${index}].origin`, message: `${label}: origem da mercadoria não definida` });
      }
    }

    if (model === "nfse") {
      if (!item.service_national_code && !item.lc116_item) {
        issues.push({
          field: `items[${index}].service_code`,
          message: `${label}: código do serviço (lista nacional ou item da LC 116) não definido`,
        });
      }
    }
  });

  return issues;
};

export type Recipient = {
  name?: string | null;
  document?: string | null;
  city_ibge_code?: string | null;
  uf?: string | null;
};

export const validateRecipient = (
  recipient: Recipient | null,
  model: "55" | "65" | "nfse",
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  // NFC-e aceita venda a consumidor não identificado; NF-e e NFS-e não.
  if (model === "65") {
    if (recipient?.document) {
      const doc = onlyDigits(recipient.document);
      const ok = doc.length === 11 ? isValidCpf(doc) : isValidCnpj(doc);
      if (!ok) issues.push({ field: "customer.document", message: "CPF/CNPJ do consumidor inválido" });
    }
    return issues;
  }

  if (!recipient?.document) {
    issues.push({ field: "customer.document", message: "Documento do destinatário obrigatório" });
  } else {
    const doc = onlyDigits(recipient.document);
    const ok = doc.length === 11 ? isValidCpf(doc) : isValidCnpj(doc);
    if (!ok) issues.push({ field: "customer.document", message: "CPF/CNPJ do destinatário inválido" });
  }

  if (!recipient?.name) {
    issues.push({ field: "customer.name", message: "Nome do destinatário obrigatório" });
  }

  return issues;
};
