// Configuração de NFC-e (SEFAZ-GO, homologação): "Testar configuração" e
// gravação de série / próximo número.
//
// Nada aqui emite nota nem transmite para a SEFAZ. O teste só abre o
// certificado com a senha guardada no Vault, confere CNPJ, validade e o
// formato do CSC, e devolve itens por status — nunca o certificado, a senha ou
// o CSC. Só admin da empresa pode usar; esta etapa trabalha só em homologação.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { parsePfx } from "../_shared/fiscal/certificate.ts";
import { buildNfceChecks, type CertState } from "../_shared/fiscal/nfceConfig.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const ADMINS = ["owner", "admin", "platform_admin"];

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test") }),
  z.object({
    action: z.literal("set_numbering"),
    series: z.coerce.number().int().min(1).max(999),
    next_number: z.coerce.number().int().min(1).max(999_999_999),
  }),
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { user, profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  const papel = profile?.company_role || profile?.role;
  if (!ADMINS.includes(String(papel))) {
    return json({ error: "Apenas administradores podem usar a configuração de NFC-e" }, 403);
  }

  const limited = await rateLimited(admin, {
    key: `fiscal:nfce-config:${companyId}`,
    max: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Dados inválidos" }, 400);
  const body = parsed.data;

  const { data: settings } = await admin
    .from("company_fiscal_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (body.action === "set_numbering") {
    if (!settings) return json({ error: "Preencha os dados fiscais da empresa antes" }, 422);

    // Esta etapa só mexe na numeração de homologação, que não vale fiscalmente.
    const { error: erroNumero } = await admin.rpc("set_fiscal_next_number", {
      p_company_id: companyId,
      p_model: "65",
      p_series: body.series,
      p_environment: "homologacao",
      p_next: body.next_number,
    });
    if (erroNumero) {
      // A RPC só levanta mensagens de regra de negócio (número repetido, faixa).
      return json({ error: erroNumero.message.replace(/^.*?:\s*/, "") }, 422);
    }

    const { error: erroSerie } = await admin
      .from("company_fiscal_settings")
      .update({ nfce_series: body.series, updated_at: new Date().toISOString() })
      .eq("company_id", companyId);
    if (erroSerie) {
      console.error("fiscal-nfce-config: update nfce_series", erroSerie);
      return json({ error: "Falha ao salvar a série" }, 500);
    }

    await admin.from("fiscal_audit_log").insert({
      company_id: companyId,
      user_id: user.id,
      user_name: profile?.full_name ?? null,
      operation: "nfce_numbering_update",
      model: "65",
      environment: "homologacao",
      response: { series: body.series, next_number: body.next_number },
    });

    return json({ series: body.series, next_number: body.next_number });
  }

  // action === "test"
  const { data: secrets } = await admin
    .rpc("get_fiscal_secrets", { p_company_id: companyId })
    .maybeSingle<{
      certificate_pfx: string | null;
      certificate_password: string | null;
      csc_homologacao: string | null;
    }>();

  let cert: CertState = { state: "absent" };
  if (secrets?.certificate_pfx && secrets?.certificate_password) {
    try {
      const aberto = parsePfx(secrets.certificate_pfx, secrets.certificate_password);
      cert = { state: "ok", validTo: aberto.validTo, cnpj: aberto.cnpj };
    } catch (e) {
      cert = { state: "unreadable", message: (e as Error).message };
    }
  }

  const { data: endpoint } = await admin
    .from("fiscal_sefaz_endpoints")
    .select("url")
    .eq("uf", "GO")
    .eq("environment", "homologacao")
    .eq("model", "65")
    .eq("service", "autorizacao")
    .maybeSingle();

  const serie = Number(settings?.nfce_series ?? 1);
  const { data: linhaSerie } = await admin
    .from("fiscal_document_series")
    .select("current_number")
    .eq("company_id", companyId)
    .eq("model", "65")
    .eq("series", serie)
    .eq("environment", "homologacao")
    .maybeSingle();

  // Regras tributárias (da empresa e globais) e dados fiscais mínimos dos
  // produtos: sem eles a emissão para na tributação/validação, mesmo com tudo
  // acima configurado.
  const { data: regras } = await admin
    .from("tax_rules")
    .select("active, valid_from, valid_to, match, taxes")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .eq("active", true);

  const LIMITE_PRODUTOS = 2000;
  const { data: produtos, count: totalProdutos } = await admin
    .from("products")
    .select("name, ncm, cfop, unit, origin", { count: "exact" })
    .eq("company_id", companyId)
    .limit(LIMITE_PRODUTOS);
  const faltando = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
  const incompletos = (produtos || []).filter(
    (p) => !/^\d{8}$/.test(String(p.ncm ?? "")) || faltando(p.cfop) || faltando(p.unit) || faltando(p.origin),
  );

  const resultado = buildNfceChecks({
    settings,
    cert,
    cscHomologacao: secrets?.csc_homologacao ?? null,
    hasEndpoint: !!endpoint?.url,
    nextNumber: Number(linhaSerie?.current_number ?? 0) + 1,
    regras: regras || [],
    produtos: {
      total: totalProdutos ?? (produtos || []).length,
      incompletos: incompletos.length,
      exemplos: incompletos.slice(0, 3).map((p) => String(p.name || "sem nome")),
      amostra: (totalProdutos ?? 0) > LIMITE_PRODUTOS,
    },
  });

  return json({ ...resultado, environment: "homologacao" });
});
