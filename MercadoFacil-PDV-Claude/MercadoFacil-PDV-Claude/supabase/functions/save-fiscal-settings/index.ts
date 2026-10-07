// Gravação da configuração fiscal e do certificado digital.
//
// O certificado entra por aqui em base64, é aberto com a senha, validado e
// guardado em company_fiscal_secrets — tabela que o navegador não lê. O que
// volta para a tela é titular, validade e CNPJ do certificado, nunca o arquivo.
//
// Só admin da empresa altera configuração fiscal: um operador de caixa não pode
// trocar o CNPJ do emitente nem o ambiente de emissão.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { certificateHint, parsePfx } from "../_shared/fiscal/certificate.ts";
import { rateLimited } from "../_shared/rateLimit.ts";
import { validateFiscalSettingsInput } from "../_shared/fiscal/nfceConfig.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const CAMPOS = [
  "cnpj", "legal_name", "trade_name", "ie", "ie_isento", "im", "uf",
  "city_name", "city_ibge_code", "cnae_main", "cnae_secondary",
  "tax_regime", "crt", "taxpayer_type", "mei_scope", "environment",
  "nfce_enabled", "nfe_enabled", "nfse_enabled",
  "nfse_provider", "nfse_special_regime", "nfse_simples_optant",
  "nfse_issqn_withheld_default",
  "address", "address_number", "complement", "neighborhood", "cep", "phone",
  "csc_id_homologacao", "csc_id_producao",
] as const;

const ADMINS = ["owner", "admin", "platform_admin"];

// Forma/tipo, não a regra de negócio (que continua abaixo, com contexto de
// certificado/CNPJ que zod sozinho não valida). Todos opcionais: PATCH parcial.
const bodySchema = z.object({
  cnpj: z.string().trim().max(20).nullish(),
  legal_name: z.string().trim().max(200).nullish(),
  trade_name: z.string().trim().max(200).nullish(),
  ie: z.string().trim().max(20).nullish(),
  ie_isento: z.boolean().nullish(),
  im: z.string().trim().max(20).nullish(),
  uf: z.string().trim().max(2).nullish(),
  city_name: z.string().trim().max(100).nullish(),
  city_ibge_code: z.union([z.string(), z.number()]).nullish(),
  cnae_main: z.string().trim().max(20).nullish(),
  cnae_secondary: z.string().trim().max(200).nullish(),
  tax_regime: z.string().trim().max(50).nullish(),
  crt: z.union([z.string(), z.number()]).nullish(),
  taxpayer_type: z.string().trim().max(50).nullish(),
  mei_scope: z.enum(["mercadorias", "servicos", "ambos"]).nullish(),
  environment: z.enum(["homologacao", "producao"]).nullish(),
  nfce_enabled: z.boolean().nullish(),
  nfe_enabled: z.boolean().nullish(),
  nfse_enabled: z.boolean().nullish(),
  nfse_provider: z.string().trim().max(50).nullish(),
  nfse_special_regime: z.string().trim().max(50).nullish(),
  nfse_simples_optant: z.boolean().nullish(),
  nfse_issqn_withheld_default: z.boolean().nullish(),
  address: z.string().trim().max(200).nullish(),
  address_number: z.string().trim().max(20).nullish(),
  complement: z.string().trim().max(100).nullish(),
  neighborhood: z.string().trim().max(100).nullish(),
  cep: z.string().trim().max(10).nullish(),
  phone: z.string().trim().max(20).nullish(),
  certificate_pfx: z.string().max(10_000_000).optional(),
  certificate_password: z.string().max(500).optional(),
  csc_id_homologacao: z.string().trim().max(20).nullish(),
  csc_id_producao: z.string().trim().max(20).nullish(),
  csc_homologacao: z.string().trim().max(200).optional(),
  csc_producao: z.string().trim().max(200).optional(),
}).passthrough();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { user, profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  const papel = profile?.company_role || profile?.role;
  if (!ADMINS.includes(String(papel))) {
    return json({ error: "Apenas administradores podem alterar a configuração fiscal" }, 403);
  }

  const limited = await rateLimited(admin, {
    key: `fiscal:save-settings:${companyId}`,
    max: 10,
    windowSeconds: 300,
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

  const patch: Record<string, unknown> = { company_id: companyId, updated_at: new Date().toISOString() };
  for (const campo of CAMPOS) {
    if (campo in body) patch[campo] = body[campo] === "" ? null : body[campo];
  }

  // Formato dos dados fiscais (CNPJ, IE, CEP, IBGE, UF, ID CSC, CSC, CRT/regime).
  // O corpo é validado já combinado com o que está gravado, porque IE e IBGE
  // dependem da UF.
  const { data: atual } = await admin
    .from("company_fiscal_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  const problemas = validateFiscalSettingsInput(body, { ...(atual || {}), ...patch });
  if (problemas.length) {
    return json(
      { error: `Dados fiscais inválidos: ${problemas.map((p) => p.message).join("; ")}`, details: problemas },
      422,
    );
  }

  // Trocar para produção sem certificado válido deixaria a loja achando que
  // está emitindo de verdade. Melhor recusar a troca com o motivo.
  if (patch.environment === "producao") {
    // certificate_pfx vive criptografado no Vault (migration 039).
    const { data: atual } = await admin
      .rpc("get_fiscal_secrets", { p_company_id: companyId })
      .maybeSingle();
    if (!atual?.certificate_pfx && !body.certificate_pfx) {
      return json(
        { error: "Não é possível ativar o ambiente de produção sem certificado digital cadastrado" },
        422,
      );
    }
  }

  let certificado: ReturnType<typeof parsePfx> | null = null;

  if (body.certificate_pfx) {
    const senha = String(body.certificate_password || "");
    if (!senha) return json({ error: "Informe a senha do certificado" }, 400);

    try {
      certificado = parsePfx(String(body.certificate_pfx), senha);
    } catch (e) {
      return json({ error: (e as Error).message }, 422);
    }

    if (certificado.validTo.getTime() < Date.now()) {
      return json(
        { error: `Certificado vencido em ${certificado.validTo.toLocaleDateString("pt-BR")}` },
        422,
      );
    }

    // Certificado de outra empresa no cadastro desta seria emissão em nome de
    // terceiro. Confere quando dá para ler o CNPJ do certificado.
    // Sem CNPJ no corpo, vale o já gravado: enviar só o certificado não pula a conferência.
    const cnpjConfig = String(patch.cnpj ?? body.cnpj ?? atual?.cnpj ?? "").replace(/\D/g, "");
    if (certificado.cnpj && cnpjConfig && certificado.cnpj !== cnpjConfig) {
      return json(
        {
          error:
            `O certificado pertence ao CNPJ ${certificado.cnpj}, diferente do CNPJ ` +
            `${cnpjConfig} configurado para esta empresa`,
        },
        422,
      );
    }

    // Convenção do RPC (migration 039/043): null = não mexe, "" = apaga, valor = grava.
    const { error: erroSegredo } = await admin.rpc("set_fiscal_secrets", {
      p_company_id: companyId,
      p_certificate_pfx: String(body.certificate_pfx),
      p_certificate_password: senha,
      p_nfse_client_id: null,
      p_nfse_client_secret: null,
    });
    if (erroSegredo) {
      console.error("save-fiscal-settings: set_fiscal_secrets", erroSegredo);
      return json({ error: "Falha ao guardar o certificado" }, 500);
    }

    patch.certificate_subject = certificateHint(certificado);
    patch.certificate_valid_until = certificado.validTo.toISOString();
    patch.certificate_updated_at = new Date().toISOString();
  }

  // CNPJ alterado com certificado já cadastrado: o certificado precisa ser do
  // novo CNPJ. Sem esta conferência, trocar o CNPJ depois do upload deixava a
  // loja assinando documento de um CNPJ com o certificado de outro (a SEFAZ
  // recusaria na primeira emissão). O envio de um certificado novo, na mesma
  // gravação, já foi conferido acima.
  const cnpjDe = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  if (!certificado && "cnpj" in patch && cnpjDe(patch.cnpj) !== cnpjDe(atual?.cnpj)) {
    const { data: guardado } = await admin
      .rpc("get_fiscal_secrets", { p_company_id: companyId })
      .maybeSingle<{ certificate_pfx: string | null; certificate_password: string | null }>();
    if (guardado?.certificate_pfx && guardado?.certificate_password) {
      let cnpjDoCertificado: string | null;
      try {
        cnpjDoCertificado = parsePfx(guardado.certificate_pfx, guardado.certificate_password).cnpj;
      } catch {
        return json(
          {
            error:
              "Não foi possível abrir o certificado cadastrado para conferir o novo CNPJ. " +
              "Envie o certificado A1 novamente junto com o CNPJ.",
          },
          422,
        );
      }
      if (cnpjDoCertificado && cnpjDoCertificado !== cnpjDe(patch.cnpj)) {
        return json(
          {
            error:
              `O certificado cadastrado pertence ao CNPJ ${cnpjDoCertificado}, diferente do novo CNPJ ` +
              `${cnpjDe(patch.cnpj)}. Para trocar o CNPJ, envie na mesma gravação o certificado A1 do novo CNPJ.`,
          },
          422,
        );
      }
    }
  }

  // CSC é independente do certificado — a loja pode trocar um sem mexer no
  // outro. Convenção do RPC: null = não mexe, "" = apaga, valor = grava.
  const cscHomologacao = "csc_homologacao" in body ? String(body.csc_homologacao ?? "") : null;
  const cscProducao = "csc_producao" in body ? String(body.csc_producao ?? "") : null;

  if (cscHomologacao !== null || cscProducao !== null) {
    const { error: erroCsc } = await admin.rpc("set_fiscal_secrets", {
      p_company_id: companyId,
      p_certificate_pfx: null,
      p_certificate_password: null,
      p_nfse_client_id: null,
      p_nfse_client_secret: null,
      p_csc_homologacao: cscHomologacao,
      p_csc_producao: cscProducao,
    });
    if (erroCsc) {
      console.error("save-fiscal-settings: set_fiscal_secrets (csc)", erroCsc);
      return json({ error: "Falha ao guardar o CSC" }, 500);
    }
    patch.csc_updated_at = new Date().toISOString();
  }

  const { data, error } = await admin
    .from("company_fiscal_settings")
    .upsert(patch, { onConflict: "company_id" })
    .select()
    .single();

  if (error) {
    console.error("save-fiscal-settings: upsert company_fiscal_settings", error);
    return json({ error: "Falha ao salvar a configuração fiscal" }, 500);
  }

  await admin.from("fiscal_audit_log").insert({
    company_id: companyId,
    user_id: user.id,
    user_name: profile?.full_name ?? null,
    operation: certificado ? "settings_update_with_certificate" : "settings_update",
    environment: String(data.environment ?? ""),
    response: { fields: Object.keys(patch).filter((k) => k !== "company_id") },
  });

  return json({
    settings: data,
    certificate: certificado
      ? {
        subject: certificateHint(certificado),
        issuer: certificado.issuer,
        valid_from: certificado.validFrom.toISOString(),
        valid_to: certificado.validTo.toISOString(),
        cnpj: certificado.cnpj,
      }
      : null,
  });
});
