/**
 * Roda smokes de migração em sequência (sem mocks).
 * Uso: node scripts/smoke-all.mjs
 */
import { spawn } from "child_process";
import { resolve } from "path";

const scripts = [
  ["smoke-register-company.mjs", "B registerCompany"],
  ["smoke-plans-admin.mjs", "B list/activate"],
  ["smoke-plan-gate.mjs", "B gate trial/herança"],
  ["smoke-stale-session.mjs", "Auth sessão revogada"],
  ["smoke-stock-movement.mjs", "D baixa estoque transacional"],
  ["smoke-sale-number.mjs", "H numeração de vendas"],
  ["smoke-invite-user.mjs", "B invite-user"],
  ["smoke-assign-role.mjs", "B assign-role"],
  ["smoke-offline-sync.mjs", "D offline idempotency"],
  ["smoke-catalog-sync.mjs", "D catalog client_id"],
  ["smoke-sale-e2e.mjs", "H sale e2e"],
  ["smoke-sale-total-integrity.mjs", "H total/subtotal e caixa não confiam no cliente"],
  ["smoke-entities-extra.mjs", "H customers/delivery/nfce RLS"],
  ["smoke-extract-upload.mjs", "C storage extract"],
  ["smoke-storage-rls.mjs", "C storage upload com sessão do usuário"],
  ["smoke-team-visibility.mjs", "B equipe da mesma empresa visível"],
  ["smoke-company-fields.mjs", "B cadastro da empresa ida e volta"],
  ["smoke-compra-xml.mjs", "H compra por XML: conta, custo e duplicidade"],
  ["smoke-pix-edge.mjs", "A PIX real (pulado sem token de teste)"],
  ["smoke-pagamento-tenant.mjs", "A PIX: token e config por loja"],
  ["smoke-mp-webhook.mjs", "A webhook error path"],
  ["smoke-fiscal-rls.mjs", "I fiscal: isolamento, numeração e segredos"],
  ["smoke-fiscal-config.mjs", "I fiscal: configuração pela tela (Simples, MEI, produção, papéis)"],
  ["smoke-fiscal-emit.mjs", "I fiscal: fluxo de emissão sem autorização fictícia"],
  ["smoke-fiscal-certificado.mjs", "I fiscal: certificado A1 e assinatura XMLDSig"],
  ["smoke-fiscal-ciclo.mjs", "I fiscal: consulta e cancelamento sem cancelamento fictício"],
  ["smoke-fiscal-cadastros.mjs", "I fiscal: cadastro fiscal de produto e serviço"],
  ["smoke-fiscal-sefaz.mjs", "I fiscal: transmissão SEFAZ com endpoint oficial"],
  ["smoke-fiscal-nfeproc.mjs", "I fiscal: nfeProc e download do XML da NFC-e"],
  ["smoke-cancelamento-venda.mjs", "I fiscal: cancelamento de venda/NFC-e (regras e garantias, sem rede)"],
  ["smoke-gerenciador-acoes-fiscais.mjs", "I fiscal: ações fiscais no detalhe da venda (Gerenciador)"],
  ["smoke-reimprimir-venda.mjs", "I fiscal: reimprimir cupom e DANFE único no detalhe da venda"],
  ["smoke-finalizacao-nfce-incerto.mjs", "I fiscal: Tentar novamente da finalização não reenvia NFC-e em estado incerto"],
  ["smoke-bloqueio-fiscal-desfazer.mjs", "I fiscal: cancelar/devolver bloqueado com a NFC-e sem resolução"],
  ["smoke-email-indisponivel.mjs", "E-mail do comprovante indisponível, sem falso envio"],
  ["smoke-config-aba-e-pagamento.mjs", "Configurações: aba na URL e Pagamento sem salvar padrões"],
  ["verify-package-deps.mjs", "Desktop: dependências de runtime do main estão no electron-builder.yml"],
  ["smoke-destino-nao-autenticado.mjs", "Desktop: sem sessão abre o Login (web continua na landing); sem texto solto na tela"],
  ["smoke-app-version.mjs", "Versão única do app (package.json → APP_VERSION) e fluxo de atualização inalterado"],
  ["smoke-planos-comerciais.mjs", "Planos: textos e preços comerciais; TEF não incluso; espelho do servidor igual"],
  ["smoke-troco-dinheiro.mjs", "Checkout: dinheiro aplicado x recebido x troco; soma dos pagamentos == total"],
  ["smoke-mesas.mjs", "Mesas/comandas: almoço por peso, pagamento único/individual, fechamento, RLS da migration 080, PDV sem estoque para linha avulsa"],
  ["smoke-mesas-qr.mjs", "Cartões/comandas com QR: QR único por cartão e empresa, localizar por QR/número, DISPONÍVEL/EM USO, reutilização, mesa opcional, impressão, sem fiscal vende normalmente"],
  ["smoke-mesas-link.mjs", "Mesas: QR/link fixo da mesa (/m/<token>, atrás do login), invalidar QR (versão), cadastro de mesas (criar/remover faixa), Ver QR / link, confirmar abertura, ler QR/número no caixa, cartões escondidos por flag"],
  ["smoke-mesas-addon.mjs", "Mesas como adicional pago (R$ 19,90): catálogo, servidor, reajuste, Ativar Mesas, quem pode usar, planos e landing"],
  ["smoke-cupons-reajuste.mjs", "Cupons/bônus por ciclos e estrutura de reajuste (puro, sem ligar à cobrança)"],
  ["smoke-electron-impressao.mjs", "Desktop: impressão do cupom (mf:print:*) com janelas falsas, sem imprimir"],
  ["smoke-fechamento-backup.mjs", "Desktop: fechar/instalar com backup antes (closeFlow, limite de tempo, estados)"],
  ["smoke-atualizacao-desktop.mjs", "Desktop: painel e verificação da atualização real (progresso, MB, pronta)"],
  ["smoke-nfce-avisos.mjs", "NFC-e: avisos quando não há botão de emitir (desativada, config, sincronização)"],
  ["smoke-mensagem-erro.mjs", "mensagemDeErro: erro técnico vira mensagem útil"],
  ["smoke-connecttef-webhook-diag.mjs", "ConnectTEF: diagnóstico seguro do 401 do webhook"],
  // Requer `npm run build` (usa o dist/ atual); não depende do Supabase.
  ["verify-electron.mjs", "E desktop offline + sem Base44"],
  ["verify-schema-usage.mjs", "H schema cobre os campos da UI"],
  ["verify-migrated-data.mjs", "F dados migrados íntegros"],
  ["check-base44-urls.mjs", "G zero URLs Base44 nos dados"],
];

function run(file) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [resolve("scripts", file)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      resolvePromise({ file, code: code ?? 1, out: out.trim().slice(-2000) });
    });
  });
}

const results = [];
for (const [file, label] of scripts) {
  process.stdout.write(`→ ${label} (${file})...\n`);
  const r = await run(file);
  let parsed = null;
  try {
    parsed = JSON.parse(r.out.split("\n").filter((l) => l.startsWith("{")).pop() || "null");
  } catch {}
  results.push({
    label,
    file,
    exit: r.code,
    ok: r.code === 0,
    summary: parsed
      ? {
          ok: parsed.ok,
          mode: parsed.mode,
          company_id: parsed.company_id,
          unique_index_005: parsed.unique_index_005,
          non_admin_denied: parsed.non_admin_denied,
        }
      : r.out.slice(0, 300),
  });
}

const allOk = results.every((r) => r.ok);
console.log(JSON.stringify({ ok: allOk, results }, null, 2));
process.exit(allOk ? 0 : 1);
