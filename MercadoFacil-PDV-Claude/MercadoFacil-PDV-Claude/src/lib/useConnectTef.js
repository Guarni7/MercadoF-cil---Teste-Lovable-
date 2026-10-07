// Hooks do ConnectTEF no checkout.
import { useCallback, useEffect, useRef, useState } from "react";
import { isOnline } from "@/lib/dataLayer";
import { isDemoSession } from "@/lib/demoAccount";
import { getCachedAuth } from "@/lib/offlineAuth";
import { CobrancaTef, estadoConnectTef } from "@/lib/connectTefCheckout";
import { getCachedPaymentConfig, syncPaymentConfig } from "@/lib/paymentConfig";
import { canalDecidido, resolverCanalCartao } from "@/lib/cardChannel";
import { listarSmartPos, solicitarPagamentoTef, buscarPagamentoTef } from "@/lib/connectTef";

// Última resposta do SERVIDOR sobre "esta empresa tem Smart POS vinculado", por empresa.
const chaveCache = (companyId) => `connecttef_ativo:${companyId}`;
function lerCache(companyId) {
  if (!companyId) return null;
  try {
    const v = localStorage.getItem(chaveCache(companyId));
    return v === "1" ? true : v === "0" ? false : null;
  } catch { return null; }
}
function gravarCache(companyId, ativo) {
  if (!companyId) return;
  try { localStorage.setItem(chaveCache(companyId), ativo ? "1" : "0"); } catch { /* sem storage */ }
}
const empresaAtual = async () => (await getCachedAuth().catch(() => null))?.company_id || null;

/**
 * [estado, recarregar]: "verificando" enquanto consulta; depois "ativo" | "inativo" |
 * "indeterminado" (ver estadoConnectTef). Online sempre consulta o servidor ao abrir.
 */
export function useConnectTefEstado(open) {
  const [estado, setEstado] = useState("verificando");
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    let vivo = true;
    const aplicar = (e) => { if (vivo) setEstado(e); };
    setEstado("verificando");
    (async () => {
      const companyId = await empresaAtual();
      const cache = lerCache(companyId);
      const demo = isDemoSession();
      if (demo || !isOnline()) return aplicar(estadoConnectTef({ demo, online: false, cache }));
      let servidor = null;
      try {
        const rows = await listarSmartPos();
        servidor = (rows || []).some((r) => r.status === "vinculado");
        gravarCache(companyId, servidor);
      } catch { /* servidor sem resposta: decide estadoConnectTef */ }
      aplicar(estadoConnectTef({ online: true, servidor, cache }));
    })();
    const reavaliar = () => setTentativa((n) => n + 1);
    window.addEventListener("online", reavaliar);
    window.addEventListener("offline", reavaliar);
    return () => { vivo = false; window.removeEventListener("online", reavaliar); window.removeEventListener("offline", reavaliar); };
  }, [open, tentativa]);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return /** @type {[string, () => void]} */ ([estado, recarregar]);
}

/**
 * Canal do cartão (maquininha | tef | smartpos) para esta abertura do checkout.
 *
 * A configuração é lida ao abrir (do servidor quando online, senão do espelho local) e o canal
 * é CONGELADO até o checkout fechar: mudar a configuração com uma venda aberta não troca o
 * canal no meio. O que continua vivo é a disponibilidade do Smart POS (estadoSmartPos).
 * Nunca cai em outro canal: sem como decidir, o cartão fica bloqueado com o motivo.
 * @returns {{ resolucao: { habilitado: boolean, canal: string|null, liberado: boolean, motivo: string|null, verificando?: boolean },
 *            canal: string|null, estadoSmartPos: string, recarregar: () => void }}
 */
export function useCanalCartao(open) {
  const [estadoSmartPos, recarregar] = useConnectTefEstado(open);
  const [config, setConfig] = useState(null); // null = ainda lendo
  const congelado = useRef(null);
  useEffect(() => {
    congelado.current = null;
    if (!open) return undefined;
    let vivo = true;
    setConfig(null);
    (async () => {
      const espelho = getCachedPaymentConfig();
      let cfg = espelho;
      if (isOnline()) {
        try { cfg = await syncPaymentConfig(); } catch { cfg = espelho; }
      }
      if (vivo) setConfig(cfg);
    })();
    return () => { vivo = false; };
  }, [open]);

  const decidido = canalDecidido(config, estadoSmartPos);
  if (decidido && !congelado.current) congelado.current = { config, canal: decidido };
  const base = congelado.current;
  if (base) {
    const resolucao = resolverCanalCartao({ config: { ...base.config, card_channel: base.canal }, estadoSmartPos });
    return { resolucao, canal: base.canal, estadoSmartPos, recarregar };
  }
  const verificando = config === null || estadoSmartPos === "verificando";
  const habilitado = (config || getCachedPaymentConfig()).card_enabled !== false;
  return {
    resolucao: {
      habilitado, canal: null, liberado: false, verificando,
      motivo: verificando ? "Verificando o canal do cartão..." : "Não foi possível determinar o canal do cartão desta loja. Crédito e débito ficam bloqueados até verificar.",
    },
    canal: null, estadoSmartPos, recarregar,
  };
}

/** [estado, controlador] de UMA cobrança no Smart POS; zera ao abrir o checkout. */
export function useCobrancaTef(open) {
  const ref = useRef(null);
  const [estado, setEstado] = useState(null);
  if (!ref.current) {
    ref.current = new CobrancaTef({
      solicitar: solicitarPagamentoTef,
      buscar: buscarPagamentoTef,
      online: isOnline,
      uuid: () => crypto.randomUUID(),
      onChange: setEstado,
    });
  }
  useEffect(() => {
    if (open) ref.current.reset();
    return () => ref.current.parar();
  }, [open]);
  return [estado || ref.current.estado, ref.current];
}
