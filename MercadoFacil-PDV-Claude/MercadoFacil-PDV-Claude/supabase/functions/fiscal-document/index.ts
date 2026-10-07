// Consulta e cancelamento de documento fiscal.
//
// Emitir é só metade do ciclo de vida. Duas coisas acontecem toda semana em
// loja e precisavam existir aqui:
//
//   1. a conexão cai depois do envio e o documento fica 'pending' ou 'error'.
//      A nota pode ter sido gerada do lado de lá. Sem consultar pela chave, a
//      loja reemite e fica com nota duplicada;
//   2. o lojista precisa cancelar uma nota. Cancelar só no nosso banco não
//      cancela nada perante o fisco — é preciso registrar o evento oficial.
//
// Nenhuma das duas operações inventa resultado: se o autorizador não confirmar,
// o documento não muda de status.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { consultarNfse, registrarEventoNfse, transmitCancelamentoNfe } from "../_shared/fiscal/transmitters.ts";
import { buildCancelamentoNfseXml, buildCancelamentoNfeXml, type MotivoCancelamento } from "../_shared/fiscal/documents.ts";
import { parsePfx } from "../_shared/fiscal/certificate.ts";
import { analisarPrazoCancelamento, mensagemPrazoExpirado, mensagemRejeicaoPrazo } from "../_shared/fiscal/prazoCancelamento.ts";
import { signXml } from "../_shared/fiscal/signature.ts";
import { audit, transition } from "../_shared/fiscal/flow.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const ADMINS = ["owner", "admin", "platform_admin"];

const bodySchema = z.object({
  action: z.enum(["consultar", "cancelar"]),
  document_id: z.string().uuid(),
  access_key: z.string().trim().max(60).optional(),
  motivo: z.enum(["1", "2", "9"]).optional(),
  justificativa: z.string().trim().max(500).optional(),
});

async function gzipBase64(xml: string) {
  const stream = new Blob([new TextEncoder().encode(xml)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { user, profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  const limited = await rateLimited(admin, {
    key: `fiscal:document:${companyId}`,
    max: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: "Corpo da requisição inválido" }, 400);
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return json({ error: "Dados inválidos", details: parsedBody.error.flatten() }, 400);
  }
  const body = parsedBody.data;

  const action = body.action;
  const documentId = body.document_id;

  const { data: doc } = await admin
    .from("fiscal_documents")
    .select("*")
    .eq("id", documentId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!doc) return json({ error: "Documento fiscal não encontrado para esta empresa" }, 404);

  const { data: settings } = await admin
    .from("company_fiscal_settings")
    .select("cnpj, environment, uf")
    .eq("company_id", companyId)
    .maybeSingle();

  // certificate_pfx/certificate_password vivem criptografados no Vault (migration 039).
  const { data: secrets } = await admin
    .rpc("get_fiscal_secrets", { p_company_id: companyId })
    .maybeSingle();

  if (!secrets?.certificate_pfx || !secrets?.certificate_password) {
    return json(
      {
        error:
          "Certificado digital não cadastrado. A consulta e o cancelamento exigem " +
          "conexão autenticada com o autorizador.",
      },
      422,
    );
  }

  let cert;
  try {
    cert = parsePfx(secrets.certificate_pfx, secrets.certificate_password);
  } catch (e) {
    // Certificado já validado ao salvar — falha aqui é inesperada, não input
    // do usuário. Detalhe só no log; mensagem exposta é genérica.
    console.error("fiscal-document: falha ao abrir certificado", e);
    return json({ error: "Falha ao abrir o certificado digital cadastrado" }, 422);
  }

  const environment = (doc.environment || settings?.environment || "homologacao") as
    | "homologacao"
    | "producao";
  const cred = { environment, certPem: cert.certPem, keyPem: cert.keyPem };

  // Consulta por chave de acesso (reconciliar pending/error) ainda não existe
  // para NFC-e/NF-e — só o cancelamento foi implementado. NFS-e continua
  // funcionando para os dois.
  if (action === "consultar" && doc.model !== "nfse") {
    return json(
      {
        error:
          `Consulta de ${doc.model === "65" ? "NFC-e" : "NF-e"} pela chave de acesso ainda não ` +
          "está disponível no MercadoFácil. A NFS-e Nacional já opera por aqui.",
      },
      422,
    );
  }

  // Consulta pela chave de acesso
  if (action === "consultar") {
    const chave = String(body.access_key || doc.access_key || "");
    if (!chave) {
      return json(
        { error: "Documento sem chave de acesso: ele não chegou a ser gerado no autorizador" },
        422,
      );
    }

    const resultado = await consultarNfse(chave, cred);

    await audit(admin, {
      company_id: companyId,
      document_id: doc.id,
      user_id: user.id,
      user_name: profile?.full_name ?? null,
      operation: "query",
      model: doc.model,
      environment,
      error_message: resultado.outcome === "error" ? resultado.message : null,
      response: resultado.raw ?? null,
    });

    if (resultado.outcome === "error") {
      return json({ status: "error", error: resultado.message }, 422);
    }
    if (resultado.outcome === "not_found") {
      return json({ status: "not_found", message: resultado.message });
    }

    // Documento existe no autorizador mas nosso registro ficou para trás. A
    // consulta é justamente para reconciliar isso — só que 'authorized' exige
    // protocolo, então ele vem do retorno oficial.
    const protocolo = String(
      (resultado.raw as Record<string, unknown>)?.nsu ?? resultado.accessKey,
    );

    if (["pending", "transmitting", "error"].includes(doc.status)) {
      await transition(admin, {
        documentId: doc.id,
        companyId,
        from: doc.status,
        to: "authorized",
        operation: "query_reconcile",
        userId: user.id,
        userName: profile?.full_name ?? null,
        model: doc.model,
        environment,
        protocol: protocolo,
        patch: {
          access_key: resultado.accessKey,
          authorizer_response: resultado.raw ?? null,
        },
        response: resultado.raw,
      });
    }

    return json({
      status: "found",
      document_id: doc.id,
      access_key: resultado.accessKey,
      protocol: protocolo,
    });
  }

  // Cancelamento por evento oficial
  if (action === "cancelar") {
    const papel = profile?.company_role || profile?.role;
    if (!ADMINS.includes(String(papel))) {
      return json({ error: "Apenas administradores podem cancelar documento fiscal" }, 403);
    }

    if (doc.status !== "authorized") {
      return json(
        {
          error:
            `Só é possível cancelar documento autorizado. Este está em '${doc.status}'.`,
        },
        422,
      );
    }
    if (!doc.access_key) {
      return json({ error: "Documento autorizado sem chave de acesso registrada" }, 422);
    }

    // NFC-e/NF-e: evento 110111 na SEFAZ da UF. Bloco isolado do fluxo de
    // NFS-e abaixo — protocolo oficial, janela de cancelamento e transporte
    // são todos diferentes (SOAP/mTLS direto, não REST/JSON gzip).
    if (doc.model === "55" || doc.model === "65") {
      if (!doc.protocol) {
        return json({ error: "Documento autorizado sem protocolo de autorização registrado" }, 422);
      }
      if (!doc.authorized_at) {
        return json({ error: "Documento autorizado sem data de autorização registrada" }, 422);
      }
      if (!settings?.uf) {
        return json({ error: "UF da empresa não configurada — necessária para o evento de cancelamento" }, 422);
      }

      // Prazo do cancelamento simples por UF e modelo (prazoCancelamento.ts): NFC-e em GO, 30 min;
      // NF-e, 24 h. Conta a partir da autorização REAL (authorized_at). Sem prazo conhecido para a
      // UF/modelo, não bloqueia aqui: a SEFAZ decide.
      const prazo = analisarPrazoCancelamento({ uf: settings.uf, model: doc.model, authorizedAt: doc.authorized_at });
      if (prazo.expirado) {
        return json(
          { error: mensagemPrazoExpirado({ model: doc.model, limiteMin: prazo.limiteMin!, decorridoMin: prazo.decorridoMin! }) },
          422,
        );
      }

      const justificativa = String(body.justificativa || "");
      let pedidoNfe: string;
      try {
        pedidoNfe = buildCancelamentoNfeXml({
          accessKey: doc.access_key,
          cnpjAutor: String(settings.cnpj || ""),
          uf: settings.uf,
          protocol: doc.protocol,
          justificativa,
          environment,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }

      const assinadoNfe = await signXml(pedidoNfe, cert, "infEvento");

      const { data: endpoint } = await admin
        .from("fiscal_sefaz_endpoints")
        .select("url")
        .eq("uf", settings.uf)
        .eq("environment", environment)
        .eq("model", doc.model)
        .eq("service", "evento")
        .maybeSingle();

      if (!endpoint?.url) {
        return json(
          {
            error:
              `Endereço do serviço de eventos da SEFAZ-${settings.uf} não cadastrado para este ambiente. ` +
              "O cancelamento não pode ser transmitido sem o endpoint oficial.",
          },
          422,
        );
      }

      const { data: eventoNfe } = await admin
        .from("fiscal_document_events")
        .insert({
          company_id: companyId,
          document_id: doc.id,
          event_type: "110111",
          status: "transmitting",
          reason: justificativa,
          request_payload: { xml: pedidoNfe },
          created_by: user.id,
        })
        .select()
        .single();

      const resultadoNfe = await transmitCancelamentoNfe({
        xmlAssinado: assinadoNfe,
        endpoint: endpoint.url,
        certPem: cert.certPem,
        keyPem: cert.keyPem,
        uf: settings.uf,
      });

      if (resultadoNfe.outcome === "registered") {
        await admin
          .from("fiscal_document_events")
          .update({
            status: "authorized",
            protocol: resultadoNfe.protocol,
            xml: assinadoNfe,
            authorizer_response: resultadoNfe.raw ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", eventoNfe.id);

        await transition(admin, {
          documentId: doc.id,
          companyId,
          from: "authorized",
          to: "cancelled",
          operation: "cancel",
          userId: user.id,
          userName: profile?.full_name ?? null,
          model: doc.model,
          environment,
          patch: {
            cancelled_at: new Date().toISOString(),
            cancel_protocol: resultadoNfe.protocol,
            cancel_reason: justificativa,
          },
          response: resultadoNfe.raw,
        });

        return json({ status: "cancelled", document_id: doc.id, protocol: resultadoNfe.protocol });
      }

      await admin
        .from("fiscal_document_events")
        .update({
          status: resultadoNfe.outcome === "rejected" ? "rejected" : "error",
          authorizer_response: resultadoNfe.raw ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventoNfe.id);

      await audit(admin, {
        company_id: companyId,
        document_id: doc.id,
        user_id: user.id,
        user_name: profile?.full_name ?? null,
        operation: "cancel_failed",
        model: doc.model,
        environment,
        rejection_code: resultadoNfe.outcome === "rejected" ? resultadoNfe.code : null,
        rejection_message: resultadoNfe.outcome === "rejected" ? resultadoNfe.message : null,
        error_message: resultadoNfe.outcome === "error" ? resultadoNfe.message : null,
        response: resultadoNfe.raw ?? null,
      });

      // O documento continua autorizado: cancelamento recusado não cancela nada.
      return json(
        {
          status: resultadoNfe.outcome,
          document_id: doc.id,
          code: resultadoNfe.outcome === "rejected" ? resultadoNfe.code : null,
          // 501 = prazo de cancelamento superior ao previsto na legislação. O texto cru da SEFAZ
          // continua gravado no evento e na auditoria; para o usuário, uma mensagem que explica.
          message: resultadoNfe.outcome === "rejected" && resultadoNfe.code === "501"
            ? mensagemRejeicaoPrazo(doc.model)
            : resultadoNfe.message,
        },
        422,
      );
    }

    const motivo = String(body.motivo || "1") as MotivoCancelamento;
    if (!["1", "2", "9"].includes(motivo)) {
      return json({ error: "Motivo de cancelamento inválido. Use 1, 2 ou 9." }, 400);
    }

    let pedido: string;
    try {
      pedido = buildCancelamentoNfseXml({
        accessKey: doc.access_key,
        cnpjAutor: String(settings?.cnpj || ""),
        motivo,
        justificativa: String(body.justificativa || ""),
        environment,
      });
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    const assinado = await signXml(pedido, cert, "infPedReg");

    const { data: evento } = await admin
      .from("fiscal_document_events")
      .insert({
        company_id: companyId,
        document_id: doc.id,
        event_type: "101101",
        status: "transmitting",
        reason: String(body.justificativa || ""),
        request_payload: { motivo, xml: pedido },
        created_by: user.id,
      })
      .select()
      .single();

    const resultado = await registrarEventoNfse(
      doc.access_key,
      await gzipBase64(assinado),
      cred,
    );

    if (resultado.outcome === "registered") {
      const protocolo = String(
        (resultado.raw as Record<string, unknown>)?.idEvento ?? "registrado",
      );

      await admin
        .from("fiscal_document_events")
        .update({
          status: "authorized",
          protocol: protocolo,
          xml: assinado,
          authorizer_response: resultado.raw ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", evento.id);

      await transition(admin, {
        documentId: doc.id,
        companyId,
        from: "authorized",
        to: "cancelled",
        operation: "cancel",
        userId: user.id,
        userName: profile?.full_name ?? null,
        model: doc.model,
        environment,
        patch: {
          cancelled_at: new Date().toISOString(),
          cancel_protocol: protocolo,
          cancel_reason: String(body.justificativa || ""),
        },
        response: resultado.raw,
      });

      return json({ status: "cancelled", document_id: doc.id, protocol: protocolo });
    }

    const mensagem = resultado.outcome === "rejected" ? resultado.message : resultado.message;

    await admin
      .from("fiscal_document_events")
      .update({
        status: resultado.outcome === "rejected" ? "rejected" : "error",
        authorizer_response: resultado.raw ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", evento.id);

    await audit(admin, {
      company_id: companyId,
      document_id: doc.id,
      user_id: user.id,
      user_name: profile?.full_name ?? null,
      operation: "cancel_failed",
      model: doc.model,
      environment,
      rejection_code: resultado.outcome === "rejected" ? resultado.code : null,
      rejection_message: resultado.outcome === "rejected" ? resultado.message : null,
      error_message: resultado.outcome === "error" ? resultado.message : null,
      response: resultado.raw ?? null,
    });

    // O documento continua autorizado: cancelamento recusado não cancela nada.
    return json(
      {
        status: resultado.outcome,
        document_id: doc.id,
        code: resultado.outcome === "rejected" ? resultado.code : null,
        message: mensagem,
      },
      422,
    );
  }

  return json({ error: "Ação inválida. Use 'consultar' ou 'cancelar'." }, 400);
});
