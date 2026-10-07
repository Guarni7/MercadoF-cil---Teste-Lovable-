/**
 * Smoke do "E-mail" do comprovante da venda: sem integração real, nada de falso "enviado" (sem rede).
 *
 * Não existe envio de e-mail no sistema (nenhuma Edge Function, provedor ou SMTP para comprovantes).
 * O diálogo deve dizer isso, não oferecer ação e nunca simular sucesso.
 *
 * Uso: node scripts/smoke-email-indisponivel.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));
const ler = (p) => readFileSync(resolve(process.cwd(), p), "utf8").split("\r\n").join("\n");
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const dialogo = ler("src/components/sales/SendEmailDialog.jsx");
const codigo = semComentarios(dialogo);

// ---------- 1. nada de falso "enviado" ----------
check(!/enviado por e-mail/i.test(dialogo) && !/simula/i.test(codigo), 'não existe mais o texto "Comprovante enviado por e-mail (simulação)"');
check(!/toast/.test(codigo) && !/sonner/.test(codigo), "o diálogo não dispara nenhum toast (nem sucesso, nem erro): não há ação a confirmar");
check(!/handleSend|onClick=\{handleSend\}/.test(codigo), "não existe mais a função que fingia o envio");
check(codigo.split("onClose()").length === 2 && /const handleClose = \(\) => \{[^}]*onClose\(\);/.test(codigo), "o diálogo só fecha por handleClose (X ou clicar fora), nunca por uma ação de envio inexistente");

// ---------- 2. aviso e botão ----------
check(dialogo.includes('export const MSG_EMAIL_INDISPONIVEL = "O envio por e-mail ainda não está disponível. Nada será enviado.";'), "o aviso é exatamente: O envio por e-mail ainda não está disponível. Nada será enviado.");
check(dialogo.includes("{MSG_EMAIL_INDISPONIVEL}") && dialogo.includes('role="status"'), "o aviso aparece na tela (área de status), antes de qualquer clique");
check(/<Button[^>]*\bdisabled\b[^>]*>\s*<Send[^>]*\/>\s*Enviar\s*<\/Button>/.test(dialogo), 'o botão "Enviar" está desabilitado');
check(!/onClick=\{[^}]*\}[^>]*>\s*<Send/.test(dialogo), 'o botão "Enviar" não tem ação de clique');

// ---------- 3. código morto removido ----------
check(!dialogo.includes("Nada para enviar") && !/\berror\b|setError|AlertCircle/.test(codigo), 'a tela morta "Nada para enviar" (o estado error nunca era ativado) foi removida');

// ---------- 4. o resto continua ----------
const detalhe = ler("src/components/sales/SaleDetailDialog.jsx");
check(
  detalhe.includes('import SendEmailDialog from "@/components/sales/SendEmailDialog";') && detalhe.includes("<SendEmailDialog") && detalhe.includes("const handleEmail = () => setEmailOpen(true);") && detalhe.includes("onClick={handleEmail}"),
  "o diálogo continua abrindo pelo botão E-mail do detalhe da venda",
);
check(detalhe.includes("SendWhatsAppDialog") && detalhe.includes("handleWhatsApp"), "WhatsApp não foi tocado");
check(!/functions\.invoke|supabase|fetch\(/.test(codigo), "nenhuma integração ou chamada de rede foi criada neste diálogo");
const funcoes = readdirSync(resolve(process.cwd(), "supabase/functions"));
check(!funcoes.some((f) => /mail/i.test(f)), "continua sem Edge Function de e-mail (a integração real é outra etapa)");

console.log("\nSmoke — E-mail do comprovante indisponível (sem falso envio)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
