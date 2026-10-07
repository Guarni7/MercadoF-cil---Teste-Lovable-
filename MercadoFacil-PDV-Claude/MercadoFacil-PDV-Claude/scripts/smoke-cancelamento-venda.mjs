/**
 * Smoke do cancelamento de venda/NFC-e: regras puras e o que o código tem de garantir.
 *
 * Roda sem Supabase, sem navegador e sem SEFAZ: nenhuma chamada de rede. O comportamento do
 * cancelamento de verdade (SEFAZ confirma → venda cancela; SEFAZ recusa → nada muda) foi
 * exercitado com a API simulada; aqui ficam as regras e as garantias no código.
 *
 * A assinatura do evento de cancelamento é testada em
 * supabase/functions/_shared/fiscal/cancelamentoNfe.test.ts (deno, com xml-crypto).
 *
 * Uso: node scripts/smoke-cancelamento-venda.mjs
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  JUSTIFICATIVA_MAX,
  JUSTIFICATIVA_MIN,
  justificativaValida,
  podeCancelarDocumentoFiscal,
  vendaSincronizada,
} from "../src/lib/saleCancellationRules.js";
import { montarPayloadCancelamento } from "../src/lib/fiscalDocumentPayload.js";
import { analisarPrazoCancelamento, mensagemPrazoExpirado, prazoCancelamentoMin } from "../src/lib/prazoCancelamento.js";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const ordem = (texto, a, b) => texto.indexOf(a) >= 0 && texto.indexOf(b) >= 0 && texto.indexOf(a) < texto.indexOf(b);

// ---------- regras puras ----------
check(["owner", "admin", "platform_admin"].every((p) => podeCancelarDocumentoFiscal({ company_role: p })), "owner, admin e platform_admin podem cancelar documento fiscal");
check(!["operador", "caixa", "vendedor", "member", "user", ""].some((p) => podeCancelarDocumentoFiscal({ company_role: p, role: "user" })), "operador comum não pode");
check(podeCancelarDocumentoFiscal({ company_role: null, role: "admin" }), "sem papel da empresa vale o papel geral (como no servidor)");
check(!podeCancelarDocumentoFiscal({ company_role: "operador", role: "admin" }), "o papel da empresa tem precedência sobre o papel geral (como no servidor)");
check(!podeCancelarDocumentoFiscal(null) && !podeCancelarDocumentoFiscal(undefined) && !podeCancelarDocumentoFiscal({}), "sem usuário ou sem papel não pode");

check(JUSTIFICATIVA_MIN === 15 && JUSTIFICATIVA_MAX === 255, "limites do motivo: 15 a 255 caracteres (xJust do evento)");
check(!justificativaValida("a".repeat(14)) && justificativaValida("a".repeat(15)) && justificativaValida("a".repeat(255)) && !justificativaValida("a".repeat(256)), "motivo de 14 e 256 caracteres recusado; 15 e 255 aceito");
check(!justificativaValida("  " + "a".repeat(10) + "  ") && !justificativaValida("               ") && !justificativaValida(null) && !justificativaValida(undefined), "espaços não contam; vazio e nulo recusados");

check(vendaSincronizada({ id: "9c1856d5-00fa-4e44-8238-18a5420e7f2a" }) && !vendaSincronizada({ id: "local_abc" }) && !vendaSincronizada({}) && !vendaSincronizada(null), "só venda com UUID de servidor é cancelável (a offline não sincronizada, não)");

// ---------- corpo enviado ao fiscal-document ----------
// (a validação contra o schema real do servidor está em _shared/fiscal/cancelamentoPayload.test.ts)
const DOC = "f23af9f4-622a-47b4-a0dc-b90491f2837e";
const J = "Erro na digitacao do valor da venda";
const naRede = (p) => JSON.parse(JSON.stringify(p));
const semMotivo = naRede(montarPayloadCancelamento({ documentId: DOC, justificativa: J }));
check(!("motivo" in semMotivo) && semMotivo.action === "cancelar" && semMotivo.document_id === DOC && semMotivo.justificativa === J, "corpo de NFC-e/NF-e: sem o campo motivo");
check(![undefined, null, ""].some((m) => "motivo" in naRede(montarPayloadCancelamento({ documentId: DOC, motivo: m, justificativa: J }))), "motivo undefined, null ou vazio nunca vai no corpo");
check(["1", "2", "9"].every((m) => naRede(montarPayloadCancelamento({ documentId: DOC, motivo: m, justificativa: J })).motivo === m), "NFS-e: motivo 1, 2 e 9 continuam sendo enviados");
check([undefined, null, "", "1", "9"].every((m) => [undefined, null, "", J].every((j) => !JSON.stringify(naRede(montarPayloadCancelamento({ documentId: DOC, motivo: m, justificativa: j }))).includes("null"))), "nunca vai null no corpo (o servidor recusa com 'Dados inválidos')");
const cfg = ler("src/lib/fiscalConfig.js");
check(cfg.includes("montarPayloadCancelamento({ documentId, motivo, justificativa })") && !/motivo = null/.test(cfg), "cancelarDocumento monta o corpo pela função que omite o vazio (sem o antigo motivo = null)");

// ---------- prazo do cancelamento (NFC-e em GO: 30 min) ----------
// (o gêmeo servidor/interface e as bordas estão em _shared/fiscal/prazoCancelamento.test.ts)
const AUT = new Date("2026-10-04T14:57:27.930Z");
const apos = (min) => new Date(AUT.getTime() + min * 60_000);
check(prazoCancelamentoMin("GO", "65") === 30 && prazoCancelamentoMin("GO", "55") === 1440, "prazo em GO: NFC-e 30 min, NF-e 24 h");
check(prazoCancelamentoMin("SP", "65") === null && prazoCancelamentoMin(null, "65") === null && prazoCancelamentoMin("GO", "nfse") === null, "sem prazo conhecido (outra UF, UF ausente, NFS-e): não bloqueia localmente");
check(!analisarPrazoCancelamento({ uf: "GO", model: "65", authorizedAt: AUT, agora: apos(29) }).expirado && analisarPrazoCancelamento({ uf: "GO", model: "65", authorizedAt: AUT, agora: apos(31) }).expirado, "NFC-e: 29 min cabe, 31 min expirou");
check(!analisarPrazoCancelamento({ uf: "GO", model: "55", authorizedAt: AUT, agora: apos(31) }).expirado, "NF-e com 31 min não expira (a NFC-e não arrasta a NF-e)");
check(/Prazo de cancelamento expirado: esta NFC-e foi autorizada há 2 h 27 min e o prazo é de 30 minutos/.test(mensagemPrazoExpirado({ model: "65", limiteMin: 30, decorridoMin: 147 })), "mensagem do caso real (2 h 27 min) clara");

const docServ = ler("supabase/functions/fiscal-document/index.ts");
check(docServ.includes("analisarPrazoCancelamento({ uf: settings.uf, model: doc.model, authorizedAt: doc.authorized_at })"), "fiscal-document calcula o prazo por UF e modelo com analisarPrazoCancelamento");
check(docServ.includes("JANELA_CANCELAMENTO_HORAS") === false, "a constante antiga JANELA_CANCELAMENTO_HORAS (24 h fixas) não existe mais em fiscal-document (a checagem exige que ela esteja AUSENTE)");
check(docServ.includes("if (prazo.expirado)") && docServ.indexOf("if (prazo.expirado)") < docServ.indexOf("buildCancelamentoNfeXml({"), "o prazo é checado antes de montar e transmitir o evento");
check(docServ.includes('resultadoNfe.code === "501"') && docServ.includes("mensagemRejeicaoPrazo(doc.model)"), "cStat 501 da SEFAZ vira mensagem que explica (o texto cru segue gravado no evento)");

// ---------- lib de cancelamento ----------
const lib = ler("src/lib/saleCancellation.js");
check(ordem(lib, "await cancelarDocumento(", "api.entities.Product.bulkUpdate(") && ordem(lib, "await cancelarDocumento(", 'api.entities.Sale.update(sale.id, { status: "cancelada" })'), "a nota é cancelada na SEFAZ ANTES de devolver estoque e cancelar a venda");
check(lib.includes('resultado?.status !== "cancelled" || !resultado?.protocol') && lib.includes('etapa: "nota"'), "só segue se a SEFAZ confirmar (status cancelled com protocolo); senão para na etapa 'nota'");
check(lib.includes("justificativaValida(justificativa)") && ordem(lib, "justificativaValida(justificativa)", "await cancelarDocumento("), "o motivo é validado antes de ir à SEFAZ");
check(lib.includes("notaCancelada") && lib.includes("A nota fiscal foi cancelada na SEFAZ, mas a venda não foi cancelada por completo"), "falha depois da SEFAZ avisa que a nota já foi cancelada");

check(lib.includes("prazoDaNotaFiscal(fiscal)") && ordem(lib, "prazoDaNotaFiscal(fiscal)", "await cancelarDocumento("), "cancelarVendaCompleta confere o prazo antes de ir à SEFAZ");
check(ler("src/pages/Sales.jsx").includes("prazoDaNotaFiscal(bloqueio)") && ordem(ler("src/pages/Sales.jsx"), "prazoDaNotaFiscal(bloqueio)", "prompt("), "Sales.jsx confere o prazo antes de pedir o motivo");
check(ler("src/components/sales/ReturnExchangeDialog.jsx").includes("prazoDaNotaFiscal(fiscalBlock)"), "a devolução confere o prazo da nota antes de cancelar");

// ---------- Gerenciador (detalhe da venda) ----------
const detalhe = ler("src/components/sales/SaleDetailDialog.jsx");
check(!detalhe.includes("requer confirmação do administrador"), "a mensagem enganosa 'Cancelamento requer confirmação do administrador' saiu");
check(detalhe.includes("setCancelOpen(true)") && detalhe.includes("<CancelSaleDialog"), "o botão abre o modal de confirmação");
check(!detalhe.includes("XCircle") && detalhe.includes("<Ban ") && detalhe.includes('variant="destructive"'), "botão de cancelar com ícone de proibido e estilo destrutivo (sem o X que parece fechar)");
check(detalhe.includes('nfceDoc ? "Cancelar NFC-e" : "Cancelar venda"'), 'o botão diz "Cancelar NFC-e" quando há nota autorizada');
check(detalhe.includes("disabled={!!prazoNota?.expirado || !!bloqueioFiscal}") && detalhe.includes("dicaDoPrazo") && detalhe.includes("dicaPrazoExpirado(") && detalhe.includes("Fale com o seu contador"), "botão Cancelar NFC-e desabilitado, com a dica do prazo, quando os 30 min passaram");
check(detalhe.includes("setInterval(() => setAgora(Date.now()), 30_000)"), "o botão reavalia o prazo com o diálogo aberto");
check(detalhe.includes('sale.status !== "cancelada"'), "venda já cancelada não oferece o botão");
const importLucide = detalhe.split('from "lucide-react"')[0];
check(!detalhe.includes("onClick={onClose}") && !/X,/.test(importLucide), "um só X de fechar (o do DialogContent): o X duplicado do cabeçalho saiu");

const modal = ler("src/components/sales/CancelSaleDialog.jsx");
check(modal.includes("podeCancelarDocumentoFiscal(usuario)") && modal.includes("Somente administradores"), "operador comum vê que não pode, e nada é iniciado");
check(/podeConfirmar = [^;]*\bpode\b[^;]*\bciente\b[^;]*\bmotivoOk\b/.test(modal) || (modal.includes("const podeConfirmar") && ["pode", "!impedimento", "ciente", "motivoOk"].every((t) => modal.split("const podeConfirmar")[1].split(";")[0].includes(t))), "confirmar exige administrador, sem impedimento, confirmação marcada e motivo válido");
check(modal.includes("if (!podeConfirmar) return;") && ordem(modal, "if (!podeConfirmar) return;", "await cancelarVendaCompleta("), "a função de cancelar só roda com tudo confirmado");
check((modal.match(/cancelarVendaCompleta\(/g) || []).length === 1 && !modal.includes("cancelarDocumento"), "o modal usa só o fluxo compartilhado (sem chamar a SEFAZ por conta própria)");
check(modal.includes("justificativaValida(motivo)") && modal.includes("vendaTemDevolucao(sale)") && modal.includes("vendaSincronizada(sale)"), "motivo, devolução e venda não sincronizada são conferidos");
check(modal.includes("analisarPrazoCancelamento(") && modal.includes("prazo?.expirado") && modal.includes("restam {prazo.restanteMin < 1") && modal.includes("formatarDuracao(prazo.restanteMin)"), "o modal mostra o tempo restante e bloqueia o confirmar quando o prazo expira");
check(modal.includes("setInterval(() => setAgora(Date.now()), 15_000)") && modal.includes("const agoraExato = prazoDe(Date.now());"), "o modal reavalia o prazo a cada 15 s e de novo no clique de confirmar");
check(modal.includes("depois que a SEFAZ autorizar o cancelamento"), "o texto explica que a venda só cancela depois da SEFAZ");

const ger = ler("src/pages/Gerenciador.jsx");
check(ger.includes("onCancelled={() => {") && ger.includes("loadData();"), "Gerenciador recarrega a lista depois do cancelamento");

// ---------- Sales.jsx (fluxo existente preservado) ----------
const vendas = ler("src/pages/Sales.jsx");
check(vendas.includes("cancelarVendaCompleta(sale, { justificativa, bloqueio })") && !vendas.includes("cancelarDocumento"), "Sales.jsx usa o fluxo compartilhado");
check(vendas.includes("confirm(`Cancelar venda") && vendas.includes("Digite o motivo do cancelamento (mín. 15 caracteres)"), "Sales.jsx mantém a confirmação e o motivo");
check(ordem(vendas, "vendaTemDevolucao(sale)", "confirm(`Cancelar venda"), "Sales.jsx confere a devolução antes de qualquer efeito");

// ---------- o que não pode mudar ----------
const xmlDoc = ler("supabase/functions/_shared/fiscal/documents.ts");
const evento = xmlDoc.slice(xmlDoc.indexOf("export const buildCancelamentoNfeXml"), xmlDoc.indexOf("function isoComFuso"));
check(evento.includes('return xml.replace(/>\\s+</g, "><");'), "buildCancelamentoNfeXml devolve o evento sem espaço entre as tags");
const nfse = xmlDoc.slice(xmlDoc.indexOf("export const buildCancelamentoNfseXml"), xmlDoc.indexOf("export const buildCancelamentoNfeXml"));
check(!nfse.includes('.replace(/>\\s+</g'), "o cancelamento de NFS-e não foi tocado");
check(ler("supabase/functions/_shared/fiscal/signature.ts").includes("canonicalize") && !ler("supabase/functions/fiscal-document/index.ts").includes("replace(/>\\s+</g"), "assinatura e fiscal-document não foram tocados");
check(!ler("supabase/functions/_shared/fiscal/transmitters.ts").includes("replace(/>\\s+</g"), "a transmissão não foi tocada");

console.log("\nSmoke — cancelamento de venda/NFC-e\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
