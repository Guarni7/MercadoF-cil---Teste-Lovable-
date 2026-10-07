// Fluxo de emissão fiscal — máquina de estados e trilha de auditoria.
//
// Regra que governa este arquivo: 'authorized' só pode ser gravado junto com um
// protocolo devolvido pelo autorizador oficial. Qualquer outro caminho (falha
// de validação, certificado ausente, erro de rede, integração inexistente)
// termina em 'error', 'rejected' ou 'pending' — nunca em autorizado.
//
// A tabela nfces antiga nasceu com status "autorizada" e protocolo nulo. É
// exatamente isso que a função abaixo impede.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Admin = ReturnType<typeof createClient>;

export type FiscalStatus =
  | "draft"
  | "validating"
  | "transmitting"
  | "authorized"
  | "rejected"
  | "pending"
  | "cancelled"
  | "error"
  | "contingency";

const ALLOWED: Record<FiscalStatus, FiscalStatus[]> = {
  draft: ["validating", "error", "cancelled"],
  validating: ["transmitting", "error", "contingency"],
  transmitting: ["authorized", "rejected", "pending", "error", "contingency"],
  pending: ["authorized", "rejected", "error"],
  contingency: ["transmitting", "authorized", "rejected", "error"],
  authorized: ["cancelled"],
  rejected: ["draft", "validating", "transmitting"],
  error: ["draft", "validating", "transmitting"],
  cancelled: [],
};

export const canTransition = (from: FiscalStatus, to: FiscalStatus) =>
  (ALLOWED[from] || []).includes(to);

export type AuditEntry = {
  company_id: string;
  document_id?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  operation: string;
  model?: string | null;
  environment?: string | null;
  status_from?: string | null;
  status_to?: string | null;
  protocol?: string | null;
  rejection_code?: string | null;
  rejection_message?: string | null;
  error_message?: string | null;
  response?: unknown;
};

export async function audit(admin: Admin, entry: AuditEntry) {
  const { error } = await admin.from("fiscal_audit_log").insert({
    ...entry,
    response: entry.response ?? null,
  });
  // A auditoria não pode derrubar a emissão, mas também não pode sumir calada:
  // se ela falhar, o erro precisa aparecer no log da função.
  if (error) console.error("Falha ao gravar auditoria fiscal:", error.message);
}

export type TransitionInput = {
  documentId: string;
  companyId: string;
  from: FiscalStatus;
  to: FiscalStatus;
  operation: string;
  userId?: string | null;
  userName?: string | null;
  model?: string | null;
  environment?: string | null;
  patch?: Record<string, unknown>;
  protocol?: string | null;
  rejectionCode?: string | null;
  rejectionMessage?: string | null;
  errorMessage?: string | null;
  response?: unknown;
};

export async function transition(admin: Admin, input: TransitionInput) {
  if (!canTransition(input.from, input.to)) {
    throw new Error(
      `Transição fiscal inválida: ${input.from} → ${input.to} (documento ${input.documentId})`,
    );
  }

  // Só existe nota autorizada com protocolo. Sem isso, a transição é barrada
  // aqui dentro, antes de chegar no banco.
  if (input.to === "authorized" && !input.protocol) {
    throw new Error(
      "Tentativa de marcar documento como autorizado sem protocolo do autorizador",
    );
  }

  const patch: Record<string, unknown> = {
    status: input.to,
    updated_at: new Date().toISOString(),
    ...(input.patch || {}),
  };

  if (input.protocol !== undefined) patch.protocol = input.protocol;
  if (input.rejectionCode !== undefined) patch.rejection_code = input.rejectionCode;
  if (input.rejectionMessage !== undefined) patch.rejection_message = input.rejectionMessage;
  if (input.to === "authorized") patch.authorized_at = new Date().toISOString();

  // O update é condicionado ao status de origem: se outra chamada mexeu no
  // documento no meio do caminho, esta não sobrescreve.
  const { data, error } = await admin
    .from("fiscal_documents")
    .update(patch)
    .eq("id", input.documentId)
    .eq("status", input.from)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Falha ao atualizar documento fiscal: ${error.message}`);
  if (!data) {
    throw new Error(
      `Documento fiscal ${input.documentId} não estava em '${input.from}' — outra operação alterou o status`,
    );
  }

  await audit(admin, {
    company_id: input.companyId,
    document_id: input.documentId,
    user_id: input.userId ?? null,
    user_name: input.userName ?? null,
    operation: input.operation,
    model: input.model ?? null,
    environment: input.environment ?? null,
    status_from: input.from,
    status_to: input.to,
    protocol: input.protocol ?? null,
    rejection_code: input.rejectionCode ?? null,
    rejection_message: input.rejectionMessage ?? null,
    error_message: input.errorMessage ?? null,
    response: input.response,
  });

  return data;
}
