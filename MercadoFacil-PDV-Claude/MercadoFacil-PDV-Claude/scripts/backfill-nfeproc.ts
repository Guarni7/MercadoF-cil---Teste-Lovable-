// Backfill do nfeProc em NFC-e já autorizadas (xml_authorized ainda é a resposta SOAP da SEFAZ).
//
// Monta o nfeProc com a MESMA função do fiscal-emit (buildNfeProc), a partir do que a nota já
// guarda: o <NFe> enviado (xml_signed) e o <protNFe> da resposta (xml_authorized). Não fala com a
// SEFAZ e não reescreve o <NFe>.
//
// Seguro por padrão: sem --apply só LÊ e mostra se o nfeProc seria montado (dry-run). Com --apply
// grava só xml_authorized, só se a nota continuar autorizada, modelo 65 e ainda sem nfeProc, e só
// se o conteúdo atual for o mesmo que foi lido (nada é sobrescrito se mudou no meio).
// Registra uma linha na trilha fiscal (fiscal_audit_log, operação "backfill_nfeproc").
//
// Uso (um documento por vez, de propósito):
//   deno run --no-check --allow-net --allow-read --allow-env --env-file=.env.local \
//     scripts/backfill-nfeproc.ts --doc <uuid-do-documento> [--apply]
//
// Lê VITE_SUPABASE_URL (ou SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY do ambiente. Não imprime o
// XML nem chaves.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildNfeProc } from "../supabase/functions/_shared/fiscal/nfeProc.ts";

const args = Deno.args;
const docId = args[args.indexOf("--doc") + 1];
const aplicar = args.includes("--apply");

if (!args.includes("--doc") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(docId || "")) {
  console.error("Informe o documento: --doc <uuid>");
  Deno.exit(2);
}

const url = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !chaveServico) {
  console.error("Faltam VITE_SUPABASE_URL/SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  Deno.exit(2);
}
const admin = createClient(url, chaveServico);

const { data: doc, error } = await admin
  .from("fiscal_documents")
  .select("id, company_id, model, status, access_key, number, series, environment, xml_signed, xml_authorized")
  .eq("id", docId)
  .maybeSingle();
if (error) {
  console.error("Falha ao ler o documento:", error.message);
  Deno.exit(1);
}
if (!doc) {
  console.error("Documento não encontrado.");
  Deno.exit(1);
}

const recusar = (motivo: string): never => {
  console.error(`Não aplicável: ${motivo}`);
  Deno.exit(1);
};
if (doc.model !== "65") recusar(`modelo ${doc.model} (só NFC-e 65)`);
if (doc.status !== "authorized") recusar(`status ${doc.status} (só autorizada)`);
if (String(doc.xml_authorized || "").includes("<nfeProc")) recusar("já tem nfeProc");

const r = buildNfeProc(doc.xml_signed, doc.xml_authorized);
if (!r.ok) {
  console.error(`Não aplicável: nfeProc não montado: ${r.motivo}`);
  Deno.exit(1);
}

console.log(`NFC-e nº ${doc.number} série ${doc.series} (${doc.environment}), chave ${String(doc.access_key).slice(0, 6)}…${String(doc.access_key).slice(-4)}`);
console.log(`nfeProc montável: sim (${r.xml.length} caracteres)`);

if (!aplicar) {
  console.log("DRY-RUN: nada foi gravado. Repita com --apply para gravar.");
  Deno.exit(0);
}

const { data: atualizado, error: erroUpdate } = await admin
  .from("fiscal_documents")
  .update({ xml_authorized: r.xml, updated_at: new Date().toISOString() })
  .eq("id", doc.id)
  .eq("status", "authorized")
  .eq("model", "65")
  .eq("xml_authorized", doc.xml_authorized)
  .select("id");
if (erroUpdate) {
  console.error("Falha ao gravar:", erroUpdate.message);
  Deno.exit(1);
}
if (!atualizado?.length) recusar("o documento mudou desde a leitura; nada foi gravado");

const { error: erroAuditoria } = await admin.from("fiscal_audit_log").insert({
  company_id: doc.company_id,
  document_id: doc.id,
  operation: "backfill_nfeproc",
  model: "65",
  environment: doc.environment,
  response: { xml_authorized: "nfeProc montado a partir de xml_signed e protNFe guardados" },
});
if (erroAuditoria) console.error("Aviso: nfeProc gravado, mas a trilha fiscal não registrou:", erroAuditoria.message);

console.log("GRAVADO: xml_authorized agora é o nfeProc completo.");
