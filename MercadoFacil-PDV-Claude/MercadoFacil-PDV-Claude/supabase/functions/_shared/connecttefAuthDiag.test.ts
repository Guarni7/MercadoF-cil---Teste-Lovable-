// Diagnóstico seguro do 401 do connecttef-webhook: acerta a causa e NUNCA deixa o token escapar.
//
// Uso: deno test --no-check --allow-read supabase/functions/_shared/connecttefAuthDiag.test.ts
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { diagnosticarAutorizacao, nomesDosCabecalhos } from "./connecttefAuthDiag.ts";

const SEGREDO = "s3cr3t-T0k3n-ABCDEF-0123456789";
const igual = (a: string, b: string) => Promise.resolve(a === b);
const diag = (auth: string | null | undefined) => diagnosticarAutorizacao(auth, SEGREDO, igual);

Deno.test("sem cabeçalho: presente=false, esquema 'ausente', nada bate", async () => {
  for (const auth of [null, undefined, "", "   "]) {
    const d = await diag(auth);
    assertEquals([d.presente, d.esquema, d.valorBate, d.cabecalhoInteiroBate, d.tamanhoRecebido], [false, "ausente", false, false, 0]);
    assertEquals(d.tamanhoEsperado, SEGREDO.length);
  }
});

Deno.test("Bearer com o token certo: valorBate (é o que autentica)", async () => {
  const d = await diag(`Bearer ${SEGREDO}`);
  assertEquals([d.presente, d.esquema, d.valorBate, d.tamanhosIguais, d.comEspacoInterno, d.comAspasNasPontas], [true, "bearer", true, true, false, false]);
  assertEquals((await diag(`bearer   ${SEGREDO}  `)).valorBate, true, "esquema em minúsculas e espaços nas pontas");
});

Deno.test("Bearer com token diferente: não bate, mesmo tamanho ou não", async () => {
  const mesmoTamanho = await diag(`Bearer ${"x".repeat(SEGREDO.length)}`);
  assertEquals([mesmoTamanho.valorBate, mesmoTamanho.tamanhosIguais], [false, true]);
  const diferente = await diag("Bearer curto");
  assertEquals([diferente.valorBate, diferente.tamanhosIguais, diferente.tamanhoRecebido], [false, false, 5]);
});

Deno.test("token puro, sem 'Bearer': o código recusa, o diagnóstico aponta cabecalhoInteiroBate", async () => {
  const d = await diag(SEGREDO);
  assertEquals([d.esquema, d.cabecalhoInteiroBate, d.valorBate], ["sem-esquema", true, true]);
  assertEquals(d.tamanhoRecebido, SEGREDO.length);
});

Deno.test("aspas sobrando: valorSemAspasBate acusa", async () => {
  const d = await diag(`Bearer "${SEGREDO}"`);
  assertEquals([d.valorBate, d.valorSemAspasBate, d.comAspasNasPontas, d.tamanhoRecebido], [false, true, true, SEGREDO.length + 2]);
  assertEquals((await diag(`Bearer '${SEGREDO}'`)).valorSemAspasBate, true);
});

Deno.test("espaço ou quebra de linha dentro do valor", async () => {
  assertEquals((await diag(`Bearer ${SEGREDO.slice(0, 5)} ${SEGREDO.slice(5)}`)).comEspacoInterno, true);
  assertEquals((await diag(`Bearer ${SEGREDO.slice(0, 5)}\n${SEGREDO.slice(5)}`)).comEspacoInterno, true);
});

Deno.test("esquemas: só os conhecidos aparecem pelo nome; o resto vira 'outro'", async () => {
  assertEquals((await diag("Basic YWJjOmRlZg==")).esquema, "basic");
  assertEquals((await diag("Token abc")).esquema, "token");
  // uma palavra qualquer antes de um espaço podia ser pedaço do token: nunca vai para o log pelo nome
  assertEquals((await diag("meuTokenSecretoParte1 parte2")).esquema, "outro");
  assertEquals((await diag("UmaPalavraSoSemEspaco")).esquema, "sem-esquema");
});

Deno.test("SEGURANÇA: o resultado nunca contém o token, o secret nem pedaços dele", async () => {
  const entradas = [
    `Bearer ${SEGREDO}`,
    `Bearer "${SEGREDO}"`,
    SEGREDO,
    `Bearer ${SEGREDO}x`,
    `Token ${SEGREDO}`,
    `${SEGREDO.slice(0, 8)} ${SEGREDO.slice(8)}`,
    `Bearer outro-valor-qualquer-123456`,
  ];
  for (const auth of entradas) {
    const saida = JSON.stringify(await diag(auth));
    assertFalse(saida.includes(SEGREDO), `vazou o secret em: ${saida}`);
    for (let i = 0; i + 6 <= SEGREDO.length; i++) assertFalse(saida.includes(SEGREDO.slice(i, i + 6)), `vazou um pedaço do secret em: ${saida}`);
    const recebido = auth.replace(/^\S+\s+/, "");
    if (recebido.length >= 6) assertFalse(saida.includes(recebido), `vazou o valor recebido em: ${saida}`);
    // só tipos inofensivos: booleanos, números e o nome do esquema
    for (const [campo, valor] of Object.entries(JSON.parse(saida))) {
      assert(["boolean", "number", "string"].includes(typeof valor), campo);
      if (typeof valor === "string") assert(["ausente", "sem-esquema", "outro", "bearer", "basic", "token", "apikey", "api-key"].includes(valor), `string inesperada em ${campo}`);
    }
  }
});

Deno.test("nomesDosCabecalhos: só os nomes, nunca os valores, ordenados e limitados", () => {
  const h = new Headers({ authorization: `Bearer ${SEGREDO}`, "x-connecttef-event-id": "evt-123", "content-type": "application/json" });
  const nomes = nomesDosCabecalhos(h);
  assertEquals(nomes, ["authorization", "content-type", "x-connecttef-event-id"]);
  const saida = JSON.stringify(nomes);
  assertFalse(saida.includes(SEGREDO) || saida.includes("evt-123") || saida.includes("application/json"));
  const muitos = new Headers();
  for (let i = 0; i < 80; i++) muitos.set(`x-h-${String(i).padStart(2, "0")}`, "v");
  assertEquals(nomesDosCabecalhos(muitos).length, 30);
});
