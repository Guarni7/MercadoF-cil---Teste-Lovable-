// ConnectTEF no checkout — regras puras (sem React, sem imports `@/`) para testar em Node.
//
// Regra central: HTTP 202 do pedido NÃO aprova nada. A venda só é liberada quando a
// operação (connecttef_payments) chega em "aprovado", confirmada pelo webhook.
//
// CobrancaTef controla UMA tentativa de cobrança:
//  - duplo clique enquanto há cobrança em andamento é ignorado;
//  - offline: não envia nada;
//  - a mesma chave de idempotência vale para todos os retries da tentativa (o servidor
//    devolve a mesma operação em vez de cobrar de novo); chave nova só depois de
//    recusado/falhou/abandonar;
//  - "indeterminado" continua consultando, nunca cobra de novo sozinho.

export const MSG_OFFLINE_SMARTPOS = "Conexão com a internet necessária para pagamento no Smart POS.";

/**
 * A loja usa ConnectTEF (Smart POS vinculado)? Decide o que crédito/débito podem fazer:
 *  "ativo"         → cobrar pelo Smart POS (offline: bloqueado, nunca cai no TEF antigo);
 *  "inativo"       → sem Smart POS: comportamento antigo do checkout;
 *  "indeterminado" → não dá para saber com segurança: crédito/débito ficam BLOQUEADOS.
 * servidor/cache: true | false | null (null = sem resposta/sem dado). Só a resposta do
 * servidor é autoridade; o cache é a última resposta do servidor e só vale offline (ou
 * para "ativo" quando o servidor falha — a cobrança em si exige o servidor de qualquer jeito).
 */
export function estadoConnectTef({ demo = false, online, servidor = null, cache = null }) {
  if (demo) return "inativo";
  if (online) {
    if (servidor === true) return "ativo";
    if (servidor === false) return "inativo";
    return cache === true ? "ativo" : "indeterminado";
  }
  if (cache === true) return "ativo";
  if (cache === false) return "inativo";
  return "indeterminado";
}

export const valorParaCentavos = (reais) => Math.round(Number(reais) * 100);

const FINAIS = ["aprovado", "recusado", "falhou"];
const ESTADO_INICIAL = { fase: "ocioso", op: null, erro: null, valorCentavos: 0, longa: false };

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));

export class CobrancaTef {
  /** @type {any} */ solicitar; /** @type {any} */ buscar; /** @type {any} */ online; /** @type {any} */ uuid; /** @type {any} */ esperar; /** @type {any} */ agora; /** @type {any} */ onChange; intervaloMs = 0; avisoLongoMs = 0;
  /** @param {any} d { solicitar, buscar, online, uuid, esperar, intervaloMs, avisoLongoMs, agora, onChange } */
  constructor({ solicitar, buscar, online, uuid, esperar = esperarPadrao, intervaloMs = 2000, avisoLongoMs = 120000, agora = Date.now, onChange = () => {} }) {
    Object.assign(this, { solicitar, buscar, online, uuid, esperar, intervaloMs, avisoLongoMs, agora, onChange });
    this.estado = { ...ESTADO_INICIAL };
    this.chave = null;
    this.token = 0;
  }

  _set(patch) {
    this.estado = { ...this.estado, ...patch };
    this.onChange(this.estado);
  }

  get emAndamento() {
    return ["enviando", "aguardando", "indeterminado"].includes(this.estado.fase);
  }

  async iniciar({ valorReais, formaPagamento, parcelas = 1 }) {
    if (this.emAndamento || this.estado.fase === "aprovado") return this.estado;
    const valorCentavos = valorParaCentavos(valorReais);
    if (!(valorCentavos > 0)) {
      this._set({ fase: "erro", erro: "Valor inválido para a cobrança." });
      return this.estado;
    }
    if (!this.online()) {
      this._set({ fase: "offline", erro: MSG_OFFLINE_SMARTPOS });
      return this.estado;
    }
    this.chave = this.chave || this.uuid();
    const meu = ++this.token;
    this._set({ fase: "enviando", erro: null, op: null, valorCentavos, longa: false });
    const n = Number(parcelas) || 1;
    try {
      const op = await this.solicitar({
        valorCentavos, formaPagamento, parcelas: n,
        parcelamento: n > 1 ? "estabelecimento" : undefined,
        chaveIdempotencia: this.chave,
      });
      if (meu !== this.token) return this.estado;
      this._set({ op, fase: "aguardando" });
    } catch (err) {
      if (meu !== this.token) return this.estado;
      const body = err?.body || {};
      const msg = body.error || err?.message || "Falha ao falar com o ConnectTEF.";
      if (body.id && body.status === "indeterminado") {
        // O servidor não sabe se o Smart POS recebeu: acompanhar, nunca cobrar de novo.
        this._set({ op: { id: body.id, status: "indeterminado" }, fase: "indeterminado", erro: msg });
      } else if (body.id && body.status === "falhou") {
        this.chave = null;
        this._set({ op: { id: body.id, status: "falhou" }, fase: "falhou", erro: msg });
        return this.estado;
      } else {
        // Nada foi criado/enviado: retry seguro com a mesma chave.
        this._set({ fase: "erro", erro: msg });
        return this.estado;
      }
    }
    this._acompanhar(meu);
    return this.estado;
  }

  async _acompanhar(meu) {
    const inicio = this.agora();
    for (;;) {
      if (meu !== this.token) return;
      const r = await this._consultar();
      if (meu !== this.token || r === "final") return;
      if (!this.estado.longa && this.agora() - inicio >= this.avisoLongoMs) this._set({ longa: true });
      await this.esperar(this.intervaloMs);
    }
  }

  // Lê a operação e aplica o estado. Devolve "final" quando terminou.
  async _consultar() {
    let row = null;
    try {
      row = await this.buscar(this.estado.op.id);
    } catch {
      return "erro"; // rede instável: tenta de novo no próximo ciclo
    }
    if (!row) return "erro";
    if (FINAIS.includes(row.status)) {
      if (row.status !== "aprovado") this.chave = null;
      const erro = row.status === "recusado" ? (row.motivo || "Pagamento recusado.")
        : row.status === "falhou" ? (row.erro || "A cobrança falhou.") : null;
      this._set({ op: { ...this.estado.op, ...row }, fase: row.status, erro });
      return "final";
    }
    if (row.status === "indeterminado" && this.estado.fase !== "indeterminado") {
      this._set({ fase: "indeterminado" });
    } else if (row.status !== "indeterminado" && this.estado.fase === "indeterminado") {
      this._set({ fase: "aguardando", erro: null });
    }
    return "aberto";
  }

  /** Consulta imediata (botão "Verificar situação"). */
  async verificarAgora() {
    if (this.estado.op?.id) await this._consultar();
    return this.estado;
  }

  /** Desiste de esperar. A operação pode ser aprovada depois — o operador confirma na tela. */
  abandonar() {
    if (!this.emAndamento || !this.estado.longa) return false;
    this.reset();
    return true;
  }

  /** Para o acompanhamento (desmontar tela) sem mexer no estado. */
  parar() {
    this.token++;
  }

  reset() {
    this.token++;
    this.chave = null;
    this.estado = { ...ESTADO_INICIAL };
    this.onChange(this.estado);
  }
}

const ehTef = (p) => p?.provider === "connecttef";

/**
 * Antes de criar a venda: cada pagamento ConnectTEF precisa estar "aprovado" no
 * servidor, ainda sem venda e com o mesmo valor. Sem conseguir confirmar → bloqueia.
 */
export async function validarPagamentosParaVenda(payments, buscar) {
  const vistos = new Set();
  for (const p of (payments || []).filter(ehTef)) {
    const id = p.connectTefPaymentId;
    if (!id || vistos.has(id)) return { ok: false, erro: "Pagamento do Smart POS duplicado na venda." };
    vistos.add(id);
    let row;
    try {
      row = await buscar(id);
    } catch {
      return { ok: false, erro: "Não foi possível confirmar o pagamento do Smart POS. Verifique a conexão." };
    }
    if (!row || row.status !== "aprovado") return { ok: false, erro: "Pagamento do Smart POS não está aprovado." };
    if (row.sale_id) return { ok: false, erro: "Este pagamento do Smart POS já foi usado em outra venda." };
    if (Number(row.valor_centavos) !== valorParaCentavos(p.amount)) {
      return { ok: false, erro: "Valor do pagamento do Smart POS difere do valor lançado." };
    }
  }
  return { ok: true };
}

/** Depois de criar a venda: vincula cada pagamento ConnectTEF a ela. */
export async function vincularPagamentosDaVenda(payments, saleId, vincular) {
  const falhas = [];
  for (const p of (payments || []).filter(ehTef)) {
    try {
      await vincular(p.connectTefPaymentId, saleId);
    } catch (e) {
      falhas.push({ id: p.connectTefPaymentId, erro: e?.message || String(e) });
    }
  }
  return { ok: falhas.length === 0, falhas };
}
