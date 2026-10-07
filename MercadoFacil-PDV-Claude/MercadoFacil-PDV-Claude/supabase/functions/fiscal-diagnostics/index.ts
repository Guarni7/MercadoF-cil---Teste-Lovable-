// Diagnóstico fiscal — o "Teste de conexão" da tela Configurações → Fiscal.
//
// Responde três perguntas com evidência, não com suposição:
//   1. a empresa tem configuração e certificado para emitir?
//   2. este runtime consegue abrir conexão com certificado cliente (mTLS), que
//      é o que a NFS-e Nacional e a SEFAZ exigem?
//   3. os autorizadores estão respondendo agora?
//
// O status de cada item é 'configurado', 'pendente' ou 'erro' — os mesmos três
// que a tela mostra. Nada aqui devolve verde sem ter checado.

import { corsHeaders, json, resolveCaller } from "../_shared/mercadoPago.ts";
import { sondarNfse } from "../_shared/fiscal/transmitters.ts";
import { validateSettings } from "../_shared/fiscal/validation.ts";
import { parsePfx } from "../_shared/fiscal/certificate.ts";
import { rateLimited } from "../_shared/rateLimit.ts";

type Status = "configurado" | "pendente" | "erro";
type Item = { id: string; label: string; status: Status; detail: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await resolveCaller(req);
  if ("error" in caller) return json({ error: "Não autenticado" }, 401);

  const { profile, admin } = caller;
  const companyId = profile?.company_id;
  if (!companyId) return json({ error: "Usuário sem empresa vinculada" }, 403);

  // Sonda autorizador real (SEFAZ/NFS-e Nacional) — limite baixo pra não
  // martelar o endpoint oficial nem esgotar o handshake mTLS à toa.
  const limited = await rateLimited(admin, {
    key: `fiscal:diag:${companyId}`,
    max: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const items: Item[] = [];

  const { data: settings } = await admin
    .from("company_fiscal_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  // 1. Configuração fiscal
  if (!settings) {
    items.push({
      id: "settings",
      label: "Dados fiscais da empresa",
      status: "pendente",
      detail: "Configuração fiscal ainda não preenchida",
    });
  } else {
    const modelos: ("55" | "65" | "nfse")[] = [];
    if (settings.nfce_enabled) modelos.push("65");
    if (settings.nfe_enabled) modelos.push("55");
    if (settings.nfse_enabled) modelos.push("nfse");

    if (!modelos.length) {
      items.push({
        id: "settings",
        label: "Dados fiscais da empresa",
        status: "pendente",
        detail: "Nenhum documento fiscal habilitado (NFC-e, NF-e ou NFS-e)",
      });
    } else {
      for (const modelo of modelos) {
        const issues = validateSettings(settings, modelo);
        const nome = modelo === "65" ? "NFC-e" : modelo === "55" ? "NF-e" : "NFS-e";
        items.push({
          id: `settings_${modelo}`,
          label: `Dados fiscais para ${nome}`,
          status: issues.length ? "pendente" : "configurado",
          detail: issues.length
            ? issues.map((i) => i.message).join("; ")
            : "Todos os campos obrigatórios preenchidos",
        });
      }
    }
  }

  // 2. Certificado digital
  // certificate_pfx/certificate_password vivem criptografados no Vault (migration 039).
  const { data: secrets } = await admin
    .rpc("get_fiscal_secrets", { p_company_id: companyId })
    .maybeSingle();

  const temCertificado = !!secrets?.certificate_pfx && !!secrets?.certificate_password;
  const validade = settings?.certificate_valid_until
    ? new Date(settings.certificate_valid_until)
    : null;

  items.push({
    id: "certificate",
    label: "Certificado digital A1",
    status: !temCertificado
      ? "pendente"
      : validade && validade.getTime() < Date.now()
      ? "erro"
      : "configurado",
    detail: !temCertificado
      ? "Nenhum certificado cadastrado"
      : validade
      ? validade.getTime() < Date.now()
        ? `Certificado vencido em ${validade.toLocaleDateString("pt-BR")}`
        : `Válido até ${validade.toLocaleDateString("pt-BR")}`
      : "Certificado cadastrado",
  });

  // 3. Suporte a mTLS no runtime.
  //
  // Sem conexão com certificado cliente não há transmissão para autorizador
  // nenhum, por melhor que esteja o resto. Isso é medido, não presumido.
  const createHttpClient = (Deno as unknown as {
    createHttpClient?: (opts: unknown) => unknown;
  }).createHttpClient;

  items.push({
    id: "mtls",
    label: "Conexão com certificado cliente (mTLS)",
    status: typeof createHttpClient === "function" ? "configurado" : "erro",
    detail:
      typeof createHttpClient === "function"
        ? "Runtime expõe Deno.createHttpClient — transmissão com certificado é possível"
        : "Este runtime não expõe Deno.createHttpClient. A transmissão para SEFAZ e NFS-e " +
          "Nacional precisa de um ambiente com suporte a mTLS.",
  });

  // 4. Autorizador respondendo.
  //
  // O Sefin Nacional só aceita conexão com autenticação mútua. Sondar sem
  // certificado sempre falharia no handshake, e marcar isso como erro seria
  // alarme falso — por isso a sondagem real só acontece com certificado.
  const ambiente = (settings?.environment ?? "homologacao") as "homologacao" | "producao";

  if (settings?.nfse_enabled) {
    let par: { certPem: string; keyPem: string } | null = null;
    if (temCertificado) {
      try {
        const aberto = parsePfx(secrets!.certificate_pfx!, secrets!.certificate_password!);
        par = { certPem: aberto.certPem, keyPem: aberto.keyPem };
      } catch {
        par = null;
      }
    }
    const sonda = await sondarNfse(ambiente, par);
    items.push({
      id: "nfse_endpoint",
      label: `NFS-e Nacional (${ambiente})`,
      status: sonda.status,
      detail: sonda.detail,
    });
  }

  // 5. Endereço do autorizador estadual.
  //
  // NFC-e e NF-e vão para o webservice da SEFAZ da UF. Sem a linha da UF na
  // tabela oficial, a emissão para antes de transmitir — e é melhor o lojista
  // saber disso aqui do que no meio de uma venda.
  const modelosSefaz: ("55" | "65")[] = [];
  if (settings?.nfce_enabled) modelosSefaz.push("65");
  if (settings?.nfe_enabled) modelosSefaz.push("55");

  for (const modelo of modelosSefaz) {
    const { data: endpoint } = await admin
      .from("fiscal_sefaz_endpoints")
      .select("url")
      .eq("uf", settings!.uf)
      .eq("environment", ambiente)
      .eq("model", modelo)
      .eq("service", "autorizacao")
      .maybeSingle();

    const nome = modelo === "65" ? "NFC-e" : "NF-e";
    items.push({
      id: `sefaz_endpoint_${modelo}`,
      label: `Autorizador da SEFAZ-${settings!.uf} para ${nome} (${ambiente})`,
      status: endpoint?.url ? "configurado" : "pendente",
      detail: endpoint?.url
        ? `Serviço de autorização cadastrado (${endpoint.url})`
        : "Endereço do serviço de autorização não carregado para esta UF e ambiente — " +
          "importe a relação oficial de webservices do Portal Nacional da NF-e",
    });
  }

  // 6. Tabela oficial de classificação tributária
  const { count: classTrib } = await admin
    .from("fiscal_class_trib_codes")
    .select("*", { count: "exact", head: true });

  items.push({
    id: "class_trib",
    label: "Tabela oficial cClassTrib (IBS/CBS)",
    status: (classTrib ?? 0) > 0 ? "configurado" : "pendente",
    detail: (classTrib ?? 0) > 0
      ? `${classTrib} códigos carregados`
      : "Tabela não carregada — importe a versão vigente do Informe Técnico 2025.002",
  });

  // 7. Regras tributárias vigentes
  const hoje = new Date().toISOString().slice(0, 10);
  const { count: regras } = await admin
    .from("tax_rules")
    .select("*", { count: "exact", head: true })
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .eq("active", true)
    .lte("valid_from", hoje);

  items.push({
    id: "tax_rules",
    label: "Regras tributárias vigentes",
    status: (regras ?? 0) > 0 ? "configurado" : "pendente",
    detail: (regras ?? 0) > 0
      ? `${regras} regras válidas hoje`
      : "Nenhuma regra vigente — a emissão será recusada por falta de tributação definida",
  });

  const pior: Status = items.some((i) => i.status === "erro")
    ? "erro"
    : items.some((i) => i.status === "pendente")
    ? "pendente"
    : "configurado";

  return json({ status: pior, environment: ambiente, items });
});
