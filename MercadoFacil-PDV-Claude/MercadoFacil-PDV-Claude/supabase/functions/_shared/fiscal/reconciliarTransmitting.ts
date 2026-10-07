// Reconciliação de um documento fiscal preso em 'transmitting'. Fica fora do index.ts do
// fiscal-emit para poder ser executada de verdade nos testes (o index.ts sobe um servidor ao ser
// importado). Dependências externas entram por `deps`; em produção valem as reais.
import { audit, transition } from "./flow.ts";
import { consultarSituacaoNfe } from "./transmitters.ts";
import { parsePfx } from "./certificate.ts";
import { xmlAutorizadoDaTransmissao } from "./nfeProc.ts";

export type ReconciliacaoDeps = {
  parsePfx: typeof parsePfx;
  consultarSituacaoNfe: typeof consultarSituacaoNfe;
  audit: typeof audit;
  transition: typeof transition;
};

const depsReais: ReconciliacaoDeps = { parsePfx, consultarSituacaoNfe, audit, transition };

export type ReconciliacaoResultado =
  | { outcome: "authorized"; protocol: string }
  | { outcome: "released" }
  | { outcome: "blocked"; message: string };

/**
 * Reconcilia um documento preso em 'transmitting' (SEFAZ pode ter autorizado
 * a NFC-e/NF-e e a gravação local ter falhado depois — gap documentado desta
 * correção). Consulta a situação real na SEFAZ ANTES de deixar uma nova
 * emissão prosseguir para a mesma venda:
 *  - autorizada de verdade → grava com o protocolo real, devolve o documento
 *    existente (nunca cria um segundo);
 *  - SEFAZ confirma que não autorizou (cStat de rejeição/cancelamento/"não
 *    consta") → move para 'error', libera a venda para uma nova tentativa
 *    (novo rascunho, número novo — não reaproveita nada do tentativa presa);
 *  - consulta falha (rede, certificado, endpoint) → não dá pra confirmar nem
 *    negar, então bloqueia — mais seguro que arriscar duplicidade.
 * NFS-e fica de fora (fluxo próprio, sem esse gap: consultarNfse já existe
 * separadamente em fiscal-document).
 */
export async function reconciliarTransmitting(
  admin: Parameters<typeof transition>[0],
  params: {
    companyId: string;
    documentId: string;
    model: "55" | "65";
    accessKey: string | null;
    xmlSigned: string | null;
    userId: string;
    userName: string | null;
  },
  deps: ReconciliacaoDeps = depsReais,
): Promise<ReconciliacaoResultado> {
  const { companyId, documentId, model, userId, userName } = params;

  const chave = params.accessKey || params.xmlSigned?.match(/Id="NFe(\d{44})"/)?.[1] || null;
  if (!chave) {
    return {
      outcome: "blocked",
      message:
        "Documento preso em 'transmitting' sem chave de acesso registrada — não é possível " +
        "reconciliar automaticamente. Consulte manualmente antes de tentar de novo.",
    };
  }

  const { data: settings } = await admin
    .from("company_fiscal_settings")
    .select("environment, uf")
    .eq("company_id", companyId)
    .maybeSingle();

  const { data: secrets } = await admin
    .rpc("get_fiscal_secrets", { p_company_id: companyId })
    .maybeSingle();

  if (!settings?.uf || !secrets?.certificate_pfx || !secrets?.certificate_password) {
    return {
      outcome: "blocked",
      message:
        "Não foi possível reconciliar o documento preso em 'transmitting' (certificado ou " +
        "configuração fiscal ausente) — verifique manualmente antes de tentar de novo.",
    };
  }

  let cert;
  try {
    cert = deps.parsePfx(secrets.certificate_pfx, secrets.certificate_password);
  } catch {
    return {
      outcome: "blocked",
      message: "Falha ao abrir o certificado digital ao tentar reconciliar o documento preso.",
    };
  }

  const environment = (settings.environment || "homologacao") as "homologacao" | "producao";

  const { data: endpoint } = await admin
    .from("fiscal_sefaz_endpoints")
    .select("url")
    .eq("uf", settings.uf)
    .eq("environment", environment)
    .eq("model", model)
    .eq("service", "consulta")
    .maybeSingle();

  if (!endpoint?.url) {
    return {
      outcome: "blocked",
      message: `Endereço de consulta da SEFAZ-${settings.uf} não cadastrado — não é possível reconciliar automaticamente.`,
    };
  }

  const resultado = await deps.consultarSituacaoNfe({
    accessKey: chave,
    environment,
    certPem: cert.certPem,
    keyPem: cert.keyPem,
    endpoint: endpoint.url,
    uf: settings.uf,
  });

  await deps.audit(admin, {
    company_id: companyId,
    document_id: documentId,
    user_id: userId,
    user_name: userName,
    operation: "reconcile_query",
    model,
    environment,
    error_message: resultado.outcome === "error" ? resultado.message : null,
    response: resultado.raw ?? null,
  });

  if (resultado.outcome === "authorized") {
    // NFC-e: guarda o XML autorizado completo (nfeProc = NFe enviada + protNFe) para o cliente e o
    // contador baixarem. Melhor esforço: se não montar, grava a resposta da SEFAZ como antes e
    // só registra o motivo — a autorização já obtida nunca é perdida por causa disso.
    const { xml: xmlAutorizado, aviso } = xmlAutorizadoDaTransmissao(model, params.xmlSigned, resultado.xml);
    if (aviso) console.error(`fiscal-emit: nfeProc não montado (documento ${documentId}), gravando a resposta da SEFAZ:`, aviso);
    await deps.transition(admin, {
      companyId,
      documentId,
      from: "transmitting",
      to: "authorized",
      operation: "reconcile",
      userId,
      userName,
      model,
      environment,
      protocol: resultado.protocol,
      patch: { access_key: chave, xml_authorized: xmlAutorizado, authorizer_response: resultado.raw ?? null },
      response: resultado.raw,
    });
    return { outcome: "authorized", protocol: resultado.protocol };
  }

  if (resultado.outcome === "not_authorized") {
    await deps.transition(admin, {
      companyId,
      documentId,
      from: "transmitting",
      to: "error",
      operation: "reconcile",
      userId,
      userName,
      model,
      environment,
      errorMessage: resultado.reason,
      patch: { authorizer_response: resultado.raw ?? null },
      response: resultado.raw,
    });
    return { outcome: "released" };
  }

  return {
    outcome: "blocked",
    message: `Não foi possível confirmar a situação do documento na SEFAZ (${resultado.message}) — tente de novo em instantes.`,
  };
}
