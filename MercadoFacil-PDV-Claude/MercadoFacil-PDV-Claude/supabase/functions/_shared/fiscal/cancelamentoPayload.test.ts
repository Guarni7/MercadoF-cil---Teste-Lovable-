// O corpo que o front envia para cancelar (src/lib/fiscalDocumentPayload.js) tem de passar na
// validação REAL da Edge Function fiscal-document.
//
// O defeito que isto cobre: cancelarDocumento mandava `motivo: null`, e o schema do servidor
// (`motivo: z.enum(["1","2","9"]).optional()`) aceita o campo ausente mas não null. Resultado:
// HTTP 400 "Dados inválidos" antes de qualquer evento, e o cancelamento nunca chegava à SEFAZ.
//
// O schema não é copiado para cá: é lido do próprio fiscal-document/index.ts e avaliado com o
// mesmo zod. Se o servidor mudar o que aceita, este teste acompanha. Nenhuma chamada de rede à
// SEFAZ nem ao Supabase.
//
// Uso: deno test --no-check --allow-net --allow-read supabase/functions/_shared/fiscal/cancelamentoPayload.test.ts
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "https://esm.sh/zod@3.23.8";
import { montarPayloadCancelamento } from "../../../../src/lib/fiscalDocumentPayload.js";

const fonte = await Deno.readTextFile(new URL("../../fiscal-document/index.ts", import.meta.url));
const trecho = fonte.match(/const bodySchema = (z\.object\(\{[\s\S]*?\n\}\));/);
assert(trecho, "não achei o bodySchema em fiscal-document/index.ts");
// deno-lint-ignore no-explicit-any
const bodySchema: any = new Function("z", `return ${trecho[1]}`)(z);

const DOC = "f23af9f4-622a-47b4-a0dc-b90491f2837e";
const JUSTIFICATIVA = "Erro na digitacao do valor da venda";

// O que de fato trafega: supabase.functions.invoke faz JSON.stringify do corpo.
const naRede = (payload: unknown) => JSON.parse(JSON.stringify(payload));
const aceita = (payload: unknown) => bodySchema.safeParse(naRede(payload));

Deno.test("o schema lido do servidor é o esperado (motivo '1'|'2'|'9' opcional, justificativa texto opcional)", () => {
  assert(aceita({ action: "cancelar", document_id: DOC }).success);
  assertFalse(aceita({ action: "cancelar", document_id: DOC, motivo: null }).success, "o servidor recusa motivo null");
  assertFalse(aceita({ action: "cancelar", document_id: DOC, justificativa: null }).success, "o servidor recusa justificativa null");
  assertFalse(aceita({ action: "cancelar", document_id: DOC, motivo: "3" }).success, "motivo fora de 1/2/9 é recusado");
});

Deno.test("regressão: o corpo ANTIGO do front (motivo: null) era recusado com 'Dados inválidos'", () => {
  const antigo = { action: "cancelar", document_id: DOC, motivo: null, justificativa: JUSTIFICATIVA };
  const r = aceita(antigo);
  assertFalse(r.success);
  assertEquals(Object.keys(r.error.flatten().fieldErrors), ["motivo"]);
});

Deno.test("NFC-e/NF-e (sem motivo): o campo motivo é omitido e o corpo passa no schema", () => {
  for (const motivo of [undefined, null, ""]) {
    const payload = montarPayloadCancelamento({ documentId: DOC, motivo, justificativa: JUSTIFICATIVA });
    assertFalse("motivo" in payload, `motivo ${JSON.stringify(motivo)} não pode ir no corpo`);
    assertFalse("motivo" in naRede(payload));
    assertEquals(naRede(payload), { action: "cancelar", document_id: DOC, justificativa: JUSTIFICATIVA });
    assert(aceita(payload).success, "o corpo sem motivo tem de passar no schema do servidor");
  }
});

Deno.test("nunca vai null no corpo, em nenhum campo", () => {
  const combinacoes = [undefined, null, "", "1", "2", "9"];
  for (const motivo of combinacoes) {
    for (const justificativa of [undefined, null, "", JUSTIFICATIVA]) {
      const corpo = naRede(montarPayloadCancelamento({ documentId: DOC, motivo, justificativa }));
      assert(Object.values(corpo).every((v) => v !== null), `null no corpo: ${JSON.stringify(corpo)}`);
      assertFalse(JSON.stringify(corpo).includes("null"));
    }
  }
});

Deno.test("NFS-e: quando o motivo existe, ele continua sendo enviado e passa no schema", () => {
  for (const motivo of ["1", "2", "9"]) {
    const payload = montarPayloadCancelamento({ documentId: DOC, motivo, justificativa: JUSTIFICATIVA });
    assertEquals(naRede(payload), { action: "cancelar", document_id: DOC, motivo, justificativa: JUSTIFICATIVA });
    assert(aceita(payload).success);
  }
});

Deno.test("os dois chamadores atuais (Sales/Gerenciador e devolução) geram corpos aceitos", () => {
  // saleCancellation.js: cancelarDocumento({ documentId, justificativa: texto })
  assert(aceita(montarPayloadCancelamento({ documentId: DOC, justificativa: JUSTIFICATIVA })).success);
  // ReturnExchangeDialog.jsx: cancelarDocumento({ documentId, justificativa: reason })
  assert(aceita(montarPayloadCancelamento({ documentId: DOC, justificativa: "Devolucao total da venda pelo cliente" })).success);
});

Deno.test("ação e documento seguem no corpo, e id inválido continua sendo recusado pelo servidor", () => {
  const payload = montarPayloadCancelamento({ documentId: DOC, justificativa: JUSTIFICATIVA });
  assertEquals([payload.action, payload.document_id], ["cancelar", DOC]);
  assertFalse(aceita(montarPayloadCancelamento({ documentId: "nao-e-uuid", justificativa: JUSTIFICATIVA })).success);
});
