// Fluxo de emissão fiscal centralizado.
//
// Venda/Serviço → validação → montagem → assinatura → transmissão →
// autorização → retorno oficial → documento disponível.
//
// Antes disso a "emissão" acontecia inteira no navegador: o NfceDialog montava
// uma chave de acesso com Math.random(), escrevia status "emitida" e mostrava
// check verde. Nada saía do cliente. Aqui o cliente não decide status: ele pede
// a emissão e recebe o que o autorizador respondeu, inclusive quando a resposta
// é "não deu".

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { applyTaxRules, type FiscalContext, type FiscalItem, type TaxRule } from "../_shared/fiscal/taxEngine.ts";
import { validateItems, validateRecipient, validateSettings } from "../_shared/fiscal/validation.ts";
import { audit, transition } from "../_shared/fiscal/flow.ts";
import { transmit } from "../_shared/fiscal/transmitters.ts";
import { reconciliarTransmitting } from "../_shared/fiscal/reconciliarTransmitting.ts";
import { buildNfceXml, buildDpsXml, type SalePayment } from "../_shared/fiscal/documents.ts";
import { parsePfx } from "../_shared/fiscal/certificate.ts";
import { signXml } from "../_shared/fiscal/signature.ts";
import { xmlAutorizadoDaTransmissao } from "../_shared/fiscal/nfeProc.ts";
import { buildNfceQrCode, insertInfNFeSupl } from "../_shared/fiscal/qrcode.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { z } from "https://esm.sh/zod@3.23.8";

// Forma/tipo apenas — a validação fiscal de verdade (validateSettings/
// validateItems/validateRecipient) roda depois, com contexto de regime
// tributário que zod sozinho não tem. items/customer usam passthrough:
// campos de classificação fiscal (ncm, cfop, lc116_item...) são sobrescritos
// abaixo a partir do cadastro do produto/serviço, nunca aceitos do corpo.
const bodySchema = z.object({
  model: z.enum(["55", "65", "nfse"]),
  sale_id: z.string().uuid().nullish(),
  series: z.union([z.number(), z.string()]).optional(),
  customer: z.object({}).passthrough().nullish(),
  items: z.array(z.object({}).passthrough()).optional(),
});

// A DPS vai compactada em gzip e base64 no POST /nfse.
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

  // Emissão fiscal chama SEFAZ/Sefin Nacional (custo e risco de bloqueio no
  // autorizador em excesso) — 20/min por loja cobre uma venda atrás da outra
  // num dia de movimento sem abrir para disparo automatizado.
  const limited = await rateLimited(admin, {
    key: `fiscal:emit:${companyId}`,
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
  const body: Record<string, unknown> = parsedBody.data;

  const model = body.model as "55" | "65" | "nfse";

  const saleId = (body.sale_id as string) || null;

  // 0. Duplicidade: mesma venda não pode ter duas emissões em andamento nem
  // duas autorizadas. Cobre o caso comum (segunda tentativa, F5, ou clicar
  // "emitir" de novo depois de já ter uma nota pending/transmitting/
  // authorized). Sozinha esta consulta tem uma janela de corrida entre o
  // select e o insert do rascunho abaixo — quem fecha essa janela é o índice
  // único parcial (061_fiscal_documents_sale_unique.sql), tratado no catch do
  // insert.
  if (saleId) {
    const { data: existente } = await admin
      .from("fiscal_documents")
      .select("id, status, protocol, number, series, model, access_key, xml_signed")
      .eq("company_id", companyId)
      .eq("sale_id", saleId)
      .in("status", ["draft", "validating", "transmitting", "pending", "authorized"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existente?.status === "authorized") {
      return json({
        status: "authorized",
        document_id: existente.id,
        protocol: existente.protocol,
        number: existente.number,
        series: existente.series,
        already_authorized: true,
      });
    }

    // 'transmitting' é o estado órfão possível: SEFAZ pode ter autorizado e a
    // gravação local ter falhado depois (ver reconciliarTransmitting acima).
    // Reconciliar ANTES de bloquear — nunca deixa uma nova emissão prosseguir
    // sem antes confirmar com a SEFAZ o que aconteceu com a tentativa presa.
    if (existente?.status === "transmitting" && existente.model !== "nfse") {
      const reconciliacao = await reconciliarTransmitting(admin, {
        companyId,
        documentId: existente.id,
        model: existente.model as "55" | "65",
        accessKey: existente.access_key,
        xmlSigned: existente.xml_signed,
        userId: user.id,
        userName: profile?.full_name || null,
      });

      if (reconciliacao.outcome === "authorized") {
        return json({
          status: "authorized",
          document_id: existente.id,
          protocol: reconciliacao.protocol,
          already_authorized: true,
          reconciled: true,
        });
      }
      if (reconciliacao.outcome === "blocked") {
        return json({ error: reconciliacao.message, status: "transmitting", document_id: existente.id }, 409);
      }
      // outcome === "released": documento preso foi movido para 'error',
      // libera esta requisição para seguir e criar um rascunho novo abaixo.
    } else if (existente) {
      return json(
        {
          error: `Já existe uma emissão em andamento para esta venda (status: ${existente.status})`,
          status: existente.status,
          document_id: existente.id,
        },
        409,
      );
    }
  }

  // 1. Configuração fiscal da empresa
  const { data: settings } = await admin
    .from("company_fiscal_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  const environment = (settings?.environment || "homologacao") as "homologacao" | "producao";

  // 2. Itens: vêm da venda gravada, não do que o cliente mandar no corpo, para
  // a nota não divergir do que foi efetivamente vendido.
  let items: FiscalItem[] = [];
  let recipient = (body.customer as Record<string, unknown>) || null;
  let saleRow: Record<string, unknown> | null = null;

  if (saleId) {
    const { data: sale } = await admin
      .from("sales")
      .select("*")
      .eq("id", saleId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!sale) return json({ error: "Venda não encontrada para esta empresa" }, 404);
    saleRow = sale;

    const rawItems = (sale.items as Record<string, unknown>[]) || [];
    const productIds = rawItems.map((i) => i.product_id).filter(Boolean);
    const { data: products } = await admin
      .from("products")
      .select("id, ncm, cest, cfop, origin, unit, unit_trib, gtin, barcode, icms_cst, icms_csosn, ibscbs_cst, ibscbs_class_trib")
      .eq("company_id", companyId)
      .in("id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]);

    const byId = new Map((products || []).map((p) => [p.id, p]));

    items = rawItems.map((i) => {
      const p = byId.get(i.product_id as string) || {};
      return {
        product_id: (i.product_id as string) || null,
        name: String(i.name || ""),
        quantity: Number(i.quantity || 0),
        unit: (p.unit as string) || (i.unit as string) || null,
        price: Number(i.price || 0),
        total: Number(i.total || 0),
        discount: Number(i.discount || 0),
        ncm: (p.ncm as string) || null,
        cest: (p.cest as string) || null,
        cfop: (p.cfop as string) || null,
        origin: (p.origin as string) || null,
        gtin: (p.gtin as string) || (p.barcode as string) || null,
      };
    });

    if (!recipient && sale.customer_id) {
      const { data: customer } = await admin
        .from("customers")
        .select("name, document, city, state, ie, ie_indicator")
        .eq("id", sale.customer_id)
        .maybeSingle();
      if (customer) recipient = customer as Record<string, unknown>;
    }

    // Consumidor final que pediu CPF no cupom não vira cadastro de cliente: o
    // documento fica na própria venda. Sem isto a nota sairia sem destinatário
    // mesmo com o CPF informado no caixa.
    if (!recipient && sale.customer_document) {
      recipient = {
        name: sale.customer_name || null,
        document: sale.customer_document,
      };
    }
  } else if (Array.isArray(body.items)) {
    items = body.items as FiscalItem[];
  }

  // Serviço: a classificação fiscal sai do cadastro, nunca do corpo da
  // requisição. Item da LC 116 e código de tributação nacional informados pelo
  // cliente seriam a porta para emitir nota com enquadramento escolhido a dedo.
  const serviceIds = items.map((i) => i.service_id).filter(Boolean) as string[];
  if (serviceIds.length) {
    const { data: services } = await admin
      .from("services")
      .select(
        "id, name, unit, lc116_item, service_national_code, nbs_code, city_ibge_code, iss_rate, iss_withheld, iss_exigibility, ibscbs_cst, ibscbs_class_trib",
      )
      .eq("company_id", companyId)
      .in("id", serviceIds);

    const byService = new Map((services || []).map((s) => [s.id, s]));
    items = items.map((i) => {
      if (!i.service_id) return i;
      const s = byService.get(i.service_id);
      if (!s) return i;
      return {
        ...i,
        name: i.name || String(s.name || ""),
        unit: i.unit || (s.unit as string) || null,
        lc116_item: (s.lc116_item as string) || null,
        service_national_code: (s.service_national_code as string) || null,
      };
    });
  }

  // 3. Documento em rascunho. Existir desde já garante que toda tentativa, mesmo
  // a que falhar na validação, fica registrada e auditável.
  const { data: doc, error: erroDoc } = await admin
    .from("fiscal_documents")
    .insert({
      company_id: companyId,
      model,
      environment,
      status: "draft",
      sale_id: saleId,
      customer_id: (saleRow?.customer_id as string) || null,
      customer_name: (recipient?.name as string) || null,
      customer_document: (recipient?.document as string) || null,
      items,
      payload: { requested_by: user.id },
      created_by: user.id,
      issue_date: new Date().toISOString(),
    })
    .select()
    .single();

  if (erroDoc) {
    // 23505 = unique_violation no índice fiscal_documents_sale_active_idx —
    // outra requisição simultânea (duplo clique) ganhou a corrida entre a
    // checagem acima e este insert. Devolve o documento vencedor em vez de
    // estourar erro genérico.
    if (erroDoc.code === "23505" && saleId) {
      const { data: concorrente } = await admin
        .from("fiscal_documents")
        .select("id, status, protocol, number, series")
        .eq("company_id", companyId)
        .eq("sale_id", saleId)
        .in("status", ["draft", "validating", "transmitting", "pending", "authorized"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json(
        {
          error: `Já existe uma emissão em andamento para esta venda${concorrente ? ` (status: ${concorrente.status})` : ""}`,
          status: concorrente?.status ?? null,
          document_id: concorrente?.id ?? null,
        },
        409,
      );
    }
    return json({ error: `Não foi possível abrir o documento: ${erroDoc.message}` }, 500);
  }

  const ctx = {
    companyId,
    documentId: doc.id,
    userId: user.id,
    userName: profile?.full_name || null,
    model,
    environment,
  };

  const falhar = async (from: string, message: string, details?: unknown) => {
    await transition(admin, {
      ...ctx,
      from: from as never,
      to: "error",
      operation: "emit",
      errorMessage: message,
      patch: { authorizer_response: details ?? null },
      response: details,
    });
    return json({ error: message, details: details ?? null, document_id: doc.id }, 422);
  };

  // 4. Validação fiscal
  await transition(admin, { ...ctx, from: "draft", to: "validating", operation: "validate" });

  const issues = [
    ...validateSettings(settings, model),
    ...validateItems(items, model),
    ...validateRecipient(recipient as never, model),
  ];

  if (issues.length) {
    return await falhar("validating", "Documento reprovado na validação fiscal", issues);
  }

  // 5. Tributação pela regra vigente
  const { data: ruleRows } = await admin
    .from("tax_rules")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .eq("active", true);

  const fiscalCtx: FiscalContext = {
    model,
    uf: settings!.uf,
    city_ibge_code: settings!.city_ibge_code,
    crt: settings!.crt,
    tax_regime: settings!.tax_regime,
    issued_at: new Date(),
  };

  const taxed = applyTaxRules((ruleRows || []) as TaxRule[], items, fiscalCtx);
  if (taxed.errors.length) {
    return await falhar("validating", "Tributação não pôde ser determinada", taxed.errors);
  }

  // 6. Numeração. Só aqui, depois de validado: número de série fiscal é
  // sequencial e não pode ser queimado por documento que nunca sairia.
  // NFC-e: a série vem da configuração da empresa (Configurações > Fiscal >
  // NFC-e), nunca de um valor fixo. O corpo só confirma a série que a tela viu;
  // se divergir, a configuração mudou no meio do caminho e é melhor parar antes
  // de reservar o número. Outros modelos seguem aceitando series no corpo.
  const serieConfigurada = Number(settings?.nfce_series) || 1;
  if (model === "65" && body.series != null && Number(body.series) !== serieConfigurada) {
    return await falhar("validating", "A série da NFC-e foi alterada nas configurações. Recarregue a tela e tente de novo.");
  }
  const series = model === "65" ? serieConfigurada : Number(body.series || 1);
  const { data: numero, error: erroNumero } = await admin.rpc("next_fiscal_number", {
    p_company_id: companyId,
    p_model: model,
    p_series: series,
    p_environment: environment,
  });

  if (erroNumero) {
    // Mensagem crua do driver/RPC fica só no log do servidor — nunca na
    // resposta HTTP, mesmo padrão do catch de certificado logo abaixo.
    console.error("fiscal-emit: falha ao reservar número fiscal", erroNumero);
    return await falhar("validating", "Falha ao reservar número fiscal. Tente novamente ou contate o suporte.");
  }

  // 7. Montagem do documento
  let xml: string;
  try {
    xml = model === "nfse"
      ? buildDpsXml({ settings: settings!, items: taxed.items, totals: taxed.totals, recipient, series, number: Number(numero), environment })
      : buildNfceXml({ settings: settings!, items: taxed.items, totals: taxed.totals, recipient, series, number: Number(numero), environment, model, saleNumber: saleRow?.number as number, paymentMethod: saleRow?.payment_method as string, payments: saleRow?.payments as SalePayment[] | null });
  } catch (e) {
    return await falhar("validating", `Falha ao montar o documento: ${(e as Error).message}`);
  }

  await admin
    .from("fiscal_documents")
    .update({ series, number: Number(numero), totals: taxed.totals, items: taxed.items, xml_signed: null, payload: { xml_unsigned: xml } })
    .eq("id", doc.id);

  // 8. Transmissão
  await transition(admin, { ...ctx, from: "validating", to: "transmitting", operation: "transmit" });

  // certificate_pfx/certificate_password vivem criptografados no Vault (migration 039).
  const { data: secrets } = await admin
    .rpc("get_fiscal_secrets", { p_company_id: companyId })
    .maybeSingle();

  // O .pfx é aberto aqui, em memória, só para assinar e abrir a conexão. Nem o
  // arquivo nem a chave privada entram na resposta.
  let certPem: string | null = null;
  let keyPem: string | null = null;
  let xmlAssinado = xml;

  if (secrets?.certificate_pfx && secrets?.certificate_password) {
    try {
      const cert = parsePfx(secrets.certificate_pfx, secrets.certificate_password);
      certPem = cert.certPem;
      keyPem = cert.keyPem;
      xmlAssinado = await signXml(xml, cert, model === "nfse" ? "infDPS" : "infNFe");
    } catch (e) {
      // Certificado já validado ao salvar (save-fiscal-settings) — uma falha
      // aqui é inesperada (ex.: erro da lib de assinatura), não um problema de
      // input do usuário. Detalhe fica só no log; a mensagem exposta é genérica.
      console.error("fiscal-emit: falha ao abrir/usar certificado", e);
      return await falhar("transmitting", "Falha ao usar o certificado digital cadastrado");
    }
  }

  // QR Code da NFC-e (NT 2015.002): exige CSC + ID CSC da empresa para este
  // ambiente e a URL de consulta pública, ambos obrigatórios para o documento
  // valer como NFC-e — sem eles o cupom não tem como ser conferido pelo
  // consumidor, então a emissão para aqui, sem inventar QR nem pular a etapa.
  if (model === "65" && certPem) {
    const cscValor = environment === "producao" ? secrets?.csc_producao : secrets?.csc_homologacao;
    const cscId = environment === "producao" ? settings?.csc_id_producao : settings?.csc_id_homologacao;

    if (!cscValor || !cscId) {
      return await falhar(
        "transmitting",
        `CSC/ID CSC não cadastrado para o ambiente de ${environment}. Configure em Configurações > Fiscal antes de emitir NFC-e.`,
      );
    }

    const { data: qrEndpoint } = await admin
      .from("fiscal_sefaz_endpoints")
      .select("url")
      .eq("uf", settings!.uf)
      .eq("environment", environment)
      .eq("model", "65")
      .eq("service", "qrcode")
      .maybeSingle();

    if (!qrEndpoint?.url) {
      return await falhar(
        "transmitting",
        `Endereço de consulta do QR Code da SEFAZ${settings?.uf ? `-${settings.uf}` : ""} não cadastrado para este ambiente.`,
      );
    }

    const chaveMatch = xmlAssinado.match(/Id="NFe(\d{44})"/);
    if (!chaveMatch) {
      return await falhar(
        "transmitting",
        "Não foi possível localizar a chave de acesso no XML assinado para montar o QR Code",
      );
    }

    const qr = await buildNfceQrCode({
      accessKey: chaveMatch[1],
      environment,
      idCsc: cscId,
      csc: cscValor,
      baseUrl: qrEndpoint.url,
    });
    xmlAssinado = insertInfNFeSupl(xmlAssinado, qr);
  }

  await admin.from("fiscal_documents").update({ xml_signed: xmlAssinado }).eq("id", doc.id);

  // Endereço do autorizador estadual vem da tabela oficial carregada, nunca de
  // constante no código: cada UF publica o seu e a lista muda.
  let endpointSefaz: string | null = null;
  if (model !== "nfse") {
    const { data: endpoint } = await admin
      .from("fiscal_sefaz_endpoints")
      .select("url")
      .eq("uf", settings!.uf)
      .eq("environment", environment)
      .eq("model", model)
      .eq("service", "autorizacao")
      .maybeSingle();
    endpointSefaz = endpoint?.url ?? null;
  }

  const resultado = await transmit({
    model,
    environment,
    xml: xmlAssinado,
    xmlGzipBase64: model === "nfse" ? await gzipBase64(xmlAssinado) : null,
    certPem,
    keyPem,
    uf: settings!.uf,
    cityIbgeCode: settings!.city_ibge_code,
    endpoint: endpointSefaz,
  });

  // 9. Retorno oficial
  if (resultado.outcome === "authorized") {
    // NFC-e: nfeProc completo; se não montar, grava a resposta da SEFAZ (a autorização nunca se perde).
    const { xml: xmlAutorizado, aviso } = xmlAutorizadoDaTransmissao(model, xmlAssinado, resultado.xml);
    if (aviso) console.error(`fiscal-emit: nfeProc não montado (documento ${doc.id}), gravando a resposta da SEFAZ:`, aviso);
    await transition(admin, {
      ...ctx,
      from: "transmitting",
      to: "authorized",
      operation: "authorize",
      protocol: resultado.protocol,
      patch: {
        access_key: resultado.accessKey ?? null,
        xml_authorized: xmlAutorizado,
        authorizer_response: resultado.raw ?? null,
      },
      response: resultado.raw,
    });
    return json({ status: "authorized", document_id: doc.id, protocol: resultado.protocol, number: Number(numero), series });
  }

  if (resultado.outcome === "rejected") {
    await transition(admin, {
      ...ctx,
      from: "transmitting",
      to: "rejected",
      operation: "reject",
      rejectionCode: resultado.code,
      rejectionMessage: resultado.message,
      patch: { authorizer_response: resultado.raw ?? null },
      response: resultado.raw,
    });
    return json({ status: "rejected", document_id: doc.id, code: resultado.code, message: resultado.message }, 422);
  }

  if (resultado.outcome === "pending") {
    await transition(admin, {
      ...ctx,
      from: "transmitting",
      to: "pending",
      operation: "transmit",
      patch: { authorizer_response: resultado.raw ?? null },
      response: resultado.raw,
    });
    return json({ status: "pending", document_id: doc.id, message: "Autorizador está processando. Consulte novamente em instantes." });
  }

  await transition(admin, {
    ...ctx,
    from: "transmitting",
    to: "error",
    operation: "transmit",
    errorMessage: resultado.message,
    response: resultado.raw,
  });

  await audit(admin, {
    company_id: companyId,
    document_id: doc.id,
    user_id: user.id,
    operation: "emit_failed",
    model,
    environment,
    error_message: resultado.message,
  });

  return json({ status: "error", document_id: doc.id, error: resultado.message }, 422);
});
