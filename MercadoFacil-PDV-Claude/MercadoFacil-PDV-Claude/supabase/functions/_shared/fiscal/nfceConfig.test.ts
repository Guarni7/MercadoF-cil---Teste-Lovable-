import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNfceChecks,
  validateCep,
  validateCscFormat,
  validateFiscalSettingsInput,
  validateIbge,
  validateIdCsc,
  validateIe,
  validateIeGo,
} from "./nfceConfig.ts";

const ok = {
  cnpj: "11222333000181",
  legal_name: "Loja",
  ie: "109876547", // DV calculado pelo algoritmo (pesos 9..2, módulo 11)
  ie_isento: false,
  uf: "GO",
  crt: "1",
  tax_regime: "simples",
  environment: "homologacao",
  nfce_enabled: true,
  nfce_series: 1,
  csc_id_homologacao: "000001",
  address: "Rua Teste",
  address_number: "1",
  neighborhood: "Centro",
  cep: "74000-000",
  city_name: "Goiânia",
  city_ibge_code: "5208707",
};
const regraGeral = { active: true, valid_from: "2026-01-01", valid_to: null, match: { model: "65" }, taxes: { icms: { csosn: "102" } } };
const base = {
  settings: ok,
  cert: { state: "ok" as const, validTo: new Date("2027-01-01"), cnpj: "11222333000181" },
  cscHomologacao: "12345678-1234-1234-1234-123456789012",
  hasEndpoint: true,
  nextNumber: 1,
  regras: [regraGeral],
  produtos: { total: 3, incompletos: 0, exemplos: [], amostra: false },
  now: new Date("2026-10-02"),
};
const por = (r: ReturnType<typeof buildNfceChecks>, id: string) => r.items.find((i) => i.id === id)?.status;
const campos = (i: { field: string }[]) => i.map((x) => x.field).sort();

Deno.test("IE GO: dv, tamanho e prefixo", () => {
  assertEquals(validateIeGo("10.987.654-7").ok, true);
  assertEquals(validateIeGo("109876548").ok, false);
  assertEquals(validateIeGo("12345").ok, false);
  assertEquals(validateIeGo("309876547").ok, false);
});

Deno.test("IE por UF: GO com dígito, demais só formato", () => {
  assertEquals(validateIe("109876547", "GO").ok, true);
  assertEquals(validateIe("109876548", "GO").ok, false);
  assertEquals(validateIe("1234567890", "MG").ok, true);
  assertEquals(validateIe("1", "MG").ok, false);
});

Deno.test("CSC e ID CSC: formato", () => {
  assertEquals(validateIdCsc("000001"), true);
  assertEquals(validateIdCsc("0"), false);
  assertEquals(validateIdCsc("1234567"), false);
  assertEquals(validateIdCsc("12a"), false);
  assertEquals(validateCscFormat("12345678-1234-1234-1234-123456789012"), true);
  assertEquals(validateCscFormat("curto"), false);
});

Deno.test("CEP e IBGE", () => {
  assertEquals(validateCep("74000-000"), true);
  assertEquals(validateCep("7400000"), false);
  assertEquals(validateCep("00000000"), false);
  assertEquals(validateIbge("5208707", "GO").ok, true);
  assertEquals(validateIbge("3106200", "GO").ok, false); // Belo Horizonte não é GO
  assertEquals(validateIbge("520870", "GO").ok, false);
  assertEquals(validateIbge("3106200", "MG").ok, true);
  assertEquals(validateIbge("3106200", "").ok, true); // UF ainda desconhecida: só o formato
});

Deno.test("gravação: dados válidos passam", () => {
  assertEquals(validateFiscalSettingsInput(ok, ok), []);
});

Deno.test("gravação: cada dado inválido é recusado", () => {
  const invalido = { ...ok, cnpj: "11222333000182", ie: "109876548", cep: "123", city_ibge_code: "3106200", csc_id_homologacao: "12a", crt: "3" };
  assertEquals(
    campos(validateFiscalSettingsInput(invalido, invalido)),
    ["cep", "city_ibge_code", "cnpj", "crt", "csc_id_homologacao", "ie"],
  );
  assertEquals(campos(validateFiscalSettingsInput({ uf: "go" }, { ...ok, uf: "go" })).includes("uf"), true);
  assertEquals(campos(validateFiscalSettingsInput({ csc_homologacao: "curto" }, ok)), ["csc_homologacao"]);
  assertEquals(campos(validateFiscalSettingsInput({ cnae_main: "123" }, { ...ok, cnae_main: "123" })), ["cnae_main"]);
});

Deno.test("gravação: só valida o que veio no corpo; trocar a UF revalida IE e IBGE", () => {
  // IE inválida já gravada não bloqueia quem mexe só no telefone
  assertEquals(validateFiscalSettingsInput({ phone: "1" }, { ...ok, ie: "000" }), []);
  // mas trocar a UF para GO revalida a IE que já estava lá
  assertEquals(campos(validateFiscalSettingsInput({ uf: "GO" }, { ...ok, ie: "1234567890" })), ["ie"]);
  // e o IBGE de outra UF
  assertEquals(campos(validateFiscalSettingsInput({ uf: "GO" }, { ...ok, city_ibge_code: "3106200" })), ["city_ibge_code"]);
  // campo vazio (limpar) não é erro de formato
  assertEquals(validateFiscalSettingsInput({ cep: null, csc_id_homologacao: "" }, { ...ok, cep: null, csc_id_homologacao: "" }), []);
});

Deno.test("gravação: isento não valida IE; regime x CRT", () => {
  assertEquals(validateFiscalSettingsInput({ ie: "x", ie_isento: true }, { ...ok, ie: "x", ie_isento: true }), []);
  assertEquals(validateFiscalSettingsInput({ tax_regime: "mei" }, { ...ok, tax_regime: "mei", crt: "1" }).length, 1);
  assertEquals(validateFiscalSettingsInput({ tax_regime: "mei", crt: "4" }, { ...ok, tax_regime: "mei", crt: "4" }), []);
  assertEquals(validateFiscalSettingsInput({ crt: "2" }, { ...ok, crt: "2" }), []); // Simples, excesso de sublimite
});

Deno.test("teste: configuração completa → tudo configurado", () => {
  assertEquals(buildNfceChecks(base).status, "configurado");
});

Deno.test("teste: dados mínimos da emissão (F6)", () => {
  const sem = (campo: Record<string, unknown>) => buildNfceChecks({ ...base, settings: { ...ok, ...campo } });
  assertEquals(por(sem({ nfce_enabled: false }), "nfce_habilitada"), "erro");
  assertEquals(por(sem({ legal_name: " " }), "razao_social"), "erro");
  assertEquals(por(sem({ address: "" }), "endereco"), "erro");
  assertEquals(por(sem({ neighborhood: null }), "endereco"), "erro");
  assertEquals(por(sem({ cep: "123" }), "cep"), "erro");
  assertEquals(por(sem({ cep: "" }), "cep"), "erro");
  assertEquals(por(sem({ city_name: "" }), "municipio"), "erro");
  assertEquals(por(sem({ city_ibge_code: "3106200" }), "municipio"), "erro");
  assertEquals(por(sem({ uf: "MG" }), "uf"), "erro");
  assertEquals(por(sem({ ie: "109876548" }), "ie"), "erro");
  assertEquals(por(sem({ tax_regime: "mei" }), "regime"), "erro"); // CRT 1 x MEI
  assertEquals(por(sem({ tax_regime: "presumido", crt: "3" }), "regime"), "erro"); // regime normal ainda sem ICMS no XML
});

Deno.test("teste: regras tributárias vigentes", () => {
  const com = (regras: unknown[]) => por(buildNfceChecks({ ...base, regras: regras as never }), "regras_tributarias");
  assertEquals(com([regraGeral]), "configurado");
  assertEquals(com([]), "erro");
  assertEquals(com([{ ...regraGeral, active: false }]), "erro");
  assertEquals(com([{ ...regraGeral, valid_from: "2027-01-01" }]), "erro"); // futura
  assertEquals(com([{ ...regraGeral, valid_to: "2026-06-30" }]), "erro"); // vencida
  assertEquals(com([{ ...regraGeral, match: { model: "55" } }]), "erro"); // outro modelo
  assertEquals(com([{ ...regraGeral, match: { model: "65", uf: "MG" } }]), "erro"); // outra UF
  assertEquals(com([{ ...regraGeral, taxes: {} }]), "pendente"); // vigente mas sem ICMS: não serve para todos
  assertEquals(com([{ ...regraGeral, match: { model: "65", ncm: "2202" } }]), "pendente"); // só por NCM
  assertEquals(com([{ ...regraGeral, match: { model: "65", ncm: "2202" } }, regraGeral]), "configurado");
});

Deno.test("teste: dados fiscais dos produtos", () => {
  const com = (produtos: unknown) => por(buildNfceChecks({ ...base, produtos: produtos as never }), "produtos");
  assertEquals(com({ total: 5, incompletos: 0, exemplos: [], amostra: false }), "configurado");
  assertEquals(com({ total: 5, incompletos: 2, exemplos: ["Arroz"], amostra: false }), "pendente");
  assertEquals(com({ total: 0, incompletos: 0, exemplos: [], amostra: false }), "pendente");
  assertEquals(por(buildNfceChecks({ ...base, produtos: null }), "produtos"), undefined); // não verificado
});

Deno.test("teste: certificado vencido, CNPJ diferente, produção, sem CSC", () => {
  assertEquals(por(buildNfceChecks({ ...base, cert: { ...base.cert, validTo: new Date("2026-09-01") } }), "validade"), "erro");
  assertEquals(por(buildNfceChecks({ ...base, cert: { ...base.cert, cnpj: "99999999000191" } }), "certificado_cnpj"), "erro");
  assertEquals(por(buildNfceChecks({ ...base, settings: { ...ok, environment: "producao" } }), "ambiente"), "erro");
  assertEquals(por(buildNfceChecks({ ...base, cscHomologacao: null }), "csc"), "pendente");
});

Deno.test("teste: senha errada = erro; sem certificado = pendente; vence em 30 dias avisa", () => {
  assertEquals(por(buildNfceChecks({ ...base, cert: { state: "unreadable", message: "Senha do certificado incorreta" } }), "certificado"), "erro");
  assertEquals(por(buildNfceChecks({ ...base, cert: { state: "absent" } }), "certificado"), "pendente");
  assertEquals(por(buildNfceChecks({ ...base, cert: { ...base.cert, validTo: new Date("2026-10-20") } }), "validade"), "pendente");
});
