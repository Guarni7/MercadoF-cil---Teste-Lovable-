/**
 * Smoke da máquina de estados TEF (src/lib/tefState.js) — preparação interna
 * para a futura integração com SiTef/CliSiTef (Software Express).
 *
 * Roda sem rede e sem SDK nenhum: só garante que a classificação de
 * resultado, a geração de transactionId e a persistência de transação
 * pendente (recuperação após F5/queda) não regridem.
 *
 * Uso: node scripts/smoke-tef-state.mjs
 */
import assert from "node:assert/strict";

// sessionStorage não existe em Node — polyfill mínimo em memória só para
// exercitar savePendingTefTransaction/getPendingTefTransaction/clear.
globalThis.sessionStorage = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
})();

const {
  TefStatus,
  isTefApproved,
  isTefInFlight,
  createTefTransactionId,
  classifyTefResponse,
  savePendingTefTransaction,
  clearPendingTefTransaction,
  getPendingTefTransaction,
} = await import("../src/lib/tefState.js");

const falhas = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : falhas.push(msg));

// --- Classificação do resultado ---
check(classifyTefResponse({ approved: true }) === TefStatus.APPROVED, "approved:true classifica como APPROVED");
check(classifyTefResponse({ approved: false }) === TefStatus.DECLINED, "approved:false classifica como DECLINED");
check(classifyTefResponse({}) === TefStatus.DECLINED, "resposta sem approved classifica como DECLINED (nunca aprova por omissão)");
check(classifyTefResponse({ pending: true }) === TefStatus.PENDING, "pending:true classifica como PENDING, mesmo com approved ausente");
check(
  classifyTefResponse({ pending: true, approved: true }) === TefStatus.PENDING,
  "pending tem prioridade sobre approved — evita marcar como pago um resultado ainda incerto",
);

// --- Estados finais/aprovado ---
check(isTefApproved(TefStatus.APPROVED) === true, "isTefApproved só é true para APPROVED");
for (const s of [TefStatus.IDLE, TefStatus.PENDING, TefStatus.DECLINED, TefStatus.TIMEOUT, TefStatus.ERROR, TefStatus.CANCELLED]) {
  check(isTefApproved(s) === false, `isTefApproved(${s}) é false`);
}
check(isTefInFlight(TefStatus.INITIATING) === true, "INITIATING está em andamento");
check(isTefInFlight(TefStatus.PENDING) === true, "PENDING está em andamento");
check(isTefInFlight(TefStatus.APPROVED) === false, "APPROVED não está mais em andamento");
check(isTefInFlight(TefStatus.TIMEOUT) === false, "TIMEOUT não é 'em andamento' — exige ação explícita (consultar), não fica girando sozinho");

// --- transactionId único ---
const ids = new Set(Array.from({ length: 200 }, () => createTefTransactionId()));
check(ids.size === 200, "200 transactionIds gerados, todos únicos (sem colisão)");
check(typeof createTefTransactionId() === "string" && createTefTransactionId().length > 0, "transactionId é string não vazia");

// --- Recuperação de transação pendente ---
check(getPendingTefTransaction() === null, "sem transação salva, recuperação começa vazia");

const txId = createTefTransactionId();
savePendingTefTransaction({ transactionId: txId, amount: 49.9, type: "credito", startedAt: Date.now() });
const recuperada = getPendingTefTransaction();
check(recuperada?.transactionId === txId, "transação pendente salva é recuperada com o mesmo transactionId");
check(recuperada?.amount === 49.9, "valor da transação pendente é recuperado corretamente");

clearPendingTefTransaction();
check(getPendingTefTransaction() === null, "limpar a transação pendente remove a recuperação (fluxo resolvido)");

console.log("\nSmoke TEF — máquina de estados (preparação para SiTef/CliSiTef)\n");
for (const m of ok) console.log(`  PASS  ${m}`);
for (const m of falhas) console.log(`  FAIL  ${m}`);
console.log(`\n${ok.length} passaram, ${falhas.length} falharam\n`);
process.exit(falhas.length ? 1 : 0);
