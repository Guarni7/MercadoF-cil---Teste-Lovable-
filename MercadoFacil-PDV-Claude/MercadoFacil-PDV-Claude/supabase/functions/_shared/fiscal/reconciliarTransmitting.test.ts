// reconciliarTransmitting EXECUTADA de verdade (consulta e gravação simuladas por `deps`).
// Regressão dos ReferenceError "xmlAssinado is not defined" / "doc is not defined" do ramo
// authorized, que deixaram a NFC-e nº 5 autorizada na SEFAZ e presa em 'transmitting'.
// Qualquer nome fora de escopo nesse ramo lança aqui, sem depender de `deno check`.
//
// Uso: deno test --no-check --allow-read supabase/functions/_shared/fiscal/reconciliarTransmitting.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reconciliarTransmitting, type ReconciliacaoDeps } from "./reconciliarTransmitting.ts";

const CHAVE = "52261052481599000126650010000000051928064644";
const DIGEST = "abc123digest=";
const NFE =
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"></infNFe>` +
  `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><Reference URI="#NFe${CHAVE}"><DigestValue>${DIGEST}</DigestValue></Reference></SignedInfo></Signature></NFe>`;
const CONSULTA =
  `<retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><protNFe versao="4.00"><infProt>` +
  `<chNFe>${CHAVE}</chNFe><nProt>152260027754134</nProt><digVal>${DIGEST}</digVal><cStat>100</cStat>` +
  `<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retConsSitNFe>`;

// admin mínimo: cada from(tabela) responde ao maybeSingle com a linha da tabela.
const linhas: Record<string, unknown> = {
  company_fiscal_settings: { environment: "homologacao", uf: "GO" },
  fiscal_sefaz_endpoints: { url: "https://sefaz.exemplo/consulta" },
};
const admin = {
  rpc: () => ({ maybeSingle: () => Promise.resolve({ data: { certificate_pfx: "pfx", certificate_password: "senha" } }) }),
  from: (tabela: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: linhas[tabela] ?? null });
    return q;
  },
  // deno-lint-ignore no-explicit-any
} as any;

type Transicao = Record<string, any>; // deno-lint-ignore-line no-explicit-any
const montar = (consulta: unknown) => {
  const transicoes: Transicao[] = [];
  const auditorias: Transicao[] = [];
  const deps = {
    parsePfx: () => ({ certPem: "cert", keyPem: "key" }),
    consultarSituacaoNfe: () => Promise.resolve(consulta),
    audit: (_a: unknown, e: Transicao) => Promise.resolve(void auditorias.push(e)),
    transition: (_a: unknown, t: Transicao) => Promise.resolve(void transicoes.push(t)),
  } as unknown as ReconciliacaoDeps;
  return { deps, transicoes, auditorias };
};

const params = (extra: Record<string, unknown> = {}) => ({
  companyId: "empresa-1",
  documentId: "doc-5",
  model: "65" as const,
  accessKey: null,
  xmlSigned: NFE,
  userId: "user-1",
  userName: "Teste Maquininha",
  ...extra,
});

Deno.test("autorizada na SEFAZ: grava authorized no documento existente, com chave, protocolo e nfeProc", async () => {
  const { deps, transicoes } = montar({ outcome: "authorized", protocol: "152260027754134", xml: CONSULTA, raw: { cStat: "100" } });
  const r = await reconciliarTransmitting(admin, params(), deps);
  assertEquals(r, { outcome: "authorized", protocol: "152260027754134" });
  assertEquals(transicoes.length, 1);
  const t = transicoes[0];
  assertEquals([t.documentId, t.from, t.to, t.operation, t.protocol], ["doc-5", "transmitting", "authorized", "reconcile", "152260027754134"]);
  assertEquals(t.patch.access_key, CHAVE, "chave tirada do xml_signed");
  assertStringIncludes(t.patch.xml_authorized, "<nfeProc");
  assertStringIncludes(t.patch.xml_authorized, NFE);
  assertStringIncludes(t.patch.xml_authorized, "<nProt>152260027754134</nProt>");
});

Deno.test("nfeProc que não monta: ainda grava authorized e cai na resposta da SEFAZ (sem lançar)", async () => {
  const { deps, transicoes } = montar({ outcome: "authorized", protocol: "152260027754134", xml: "<retConsSitNFe></retConsSitNFe>", raw: {} });
  const r = await reconciliarTransmitting(admin, params(), deps);
  assertEquals(r.outcome, "authorized");
  assertEquals(transicoes[0].to, "authorized");
  assertEquals(transicoes[0].patch.xml_authorized, "<retConsSitNFe></retConsSitNFe>");
});

Deno.test("sem xml_signed (só a chave no documento): autoriza e grava sem nfeProc", async () => {
  const { deps, transicoes } = montar({ outcome: "authorized", protocol: "1", raw: {} });
  const r = await reconciliarTransmitting(admin, params({ xmlSigned: null, accessKey: CHAVE }), deps);
  assertEquals(r.outcome, "authorized");
  assertEquals([transicoes[0].patch.access_key, transicoes[0].patch.xml_authorized], [CHAVE, null]);
});

Deno.test("SEFAZ diz que não autorizou: libera (documento vai para error), sem authorized", async () => {
  const { deps, transicoes } = montar({ outcome: "not_authorized", code: "217", reason: "NF-e não consta na base", raw: {} });
  assertEquals((await reconciliarTransmitting(admin, params(), deps)).outcome, "released");
  assertEquals(transicoes.map((t) => t.to), ["error"]);
});

Deno.test("consulta falha: bloqueia e não grava nada (nunca arrisca duplicidade)", async () => {
  const { deps, transicoes } = montar({ outcome: "error", message: "rede" });
  assertEquals((await reconciliarTransmitting(admin, params(), deps)).outcome, "blocked");
  assertEquals(transicoes.length, 0);
});

Deno.test("sem chave em lugar nenhum: bloqueia antes de consultar a SEFAZ", async () => {
  const { deps, auditorias } = montar({ outcome: "authorized", protocol: "1" });
  const r = await reconciliarTransmitting(admin, params({ xmlSigned: null, accessKey: null }), deps);
  assertEquals(r.outcome, "blocked");
  assertEquals(auditorias.length, 0);
});
