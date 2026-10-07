// Prazo do cancelamento simples (110111): tabela por UF e modelo, bordas, mensagens, e a garantia de
// que o gêmeo em JS da interface (src/lib/prazoCancelamento.js) dá SEMPRE o mesmo resultado do
// módulo do servidor.
//
// Nenhuma chamada à SEFAZ: tudo é conta de data.
//
// Uso: deno test --no-check --allow-read supabase/functions/_shared/fiscal/prazoCancelamento.test.ts
import { assert, assertEquals, assertMatch, assertNotMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  analisarPrazoCancelamento,
  formatarDuracao,
  mensagemPrazoExpirado,
  mensagemRejeicaoPrazo,
  PRAZO_CANCELAMENTO_MIN,
  prazoCancelamentoMin,
} from "./prazoCancelamento.ts";
import * as web from "../../../../src/lib/prazoCancelamento.js";

const AUTORIZADA = new Date("2026-10-04T14:57:27.930Z"); // NFC-e nº 4 (homologação)
const depois = (min: number) => new Date(AUTORIZADA.getTime() + min * 60_000);
const analisa = (model: string | number | null, min: number, uf: string | null = "GO") =>
  analisarPrazoCancelamento({ uf, model, authorizedAt: AUTORIZADA, agora: depois(min) });

Deno.test("tabela: GO/NFC-e = 30 min, GO/NF-e = 24 h", () => {
  assertEquals(prazoCancelamentoMin("GO", "65"), 30);
  assertEquals(prazoCancelamentoMin("GO", 65), 30);
  assertEquals(prazoCancelamentoMin("GO", "55"), 24 * 60);
  assertEquals(prazoCancelamentoMin(" go ", "65"), 30, "UF em minúsculo ou com espaço");
});

Deno.test("sem prazo conhecido (outra UF, modelo sem linha, UF ausente) NÃO bloqueia: a SEFAZ decide", () => {
  for (const [uf, model] of [["SP", "65"], ["MG", "55"], [null, "65"], ["", "65"], ["GO", "nfse"], ["GO", null], ["GO", "99"]] as const) {
    assertEquals(prazoCancelamentoMin(uf, model), null, `${uf}/${model}`);
    const a = analisarPrazoCancelamento({ uf, model, authorizedAt: AUTORIZADA, agora: depois(100_000) });
    assertEquals([a.limiteMin, a.expirado, a.restanteMin], [null, false, null], `${uf}/${model} nunca expira localmente`);
  }
});

Deno.test("NFC-e em GO: bordas de 30 minutos", () => {
  assertEquals(analisa("65", 0).expirado, false);
  assertEquals(analisa("65", 29.99).expirado, false);
  assertEquals(analisa("65", 30).expirado, false, "exatamente 30:00 ainda cabe (a SEFAZ confirma)");
  assertEquals(analisa("65", 30.01).expirado, true);
  assertEquals(analisa("65", 31).expirado, true);
  assertEquals(analisa("65", 147).expirado, true, "o caso real: 2 h 27 min depois");
  assertEquals(analisa("65", 29).restanteMin! > 0.99 && analisa("65", 29).restanteMin! < 1.01, true);
  assertEquals(analisa("65", 31).restanteMin, 0, "o que resta nunca é negativo");
});

Deno.test("NF-e em GO: continua com 24 horas (a NFC-e não arrasta a NF-e para 30 min)", () => {
  assertEquals(analisa("55", 31).expirado, false, "31 min em NF-e não expira");
  assertEquals(analisa("55", 23 * 60 + 59).expirado, false);
  assertEquals(analisa("55", 24 * 60).expirado, false);
  assertEquals(analisa("55", 24 * 60 + 1).expirado, true);
});

Deno.test("data de autorização ausente ou inválida não bloqueia por conta própria", () => {
  for (const authorizedAt of [null, undefined, "", "não é data"]) {
    const a = analisarPrazoCancelamento({ uf: "GO", model: "65", authorizedAt: authorizedAt as never, agora: depois(500) });
    assertEquals([a.decorridoMin, a.expirado, a.restanteMin], [null, false, null]);
  }
});

Deno.test("formatarDuracao", () => {
  assertEquals([0, 0.9, 5, 59.9, 60, 61, 147, 1440].map(formatarDuracao), ["0 min", "0 min", "5 min", "59 min", "1 h", "1 h 1 min", "2 h 27 min", "24 h"]);
});

Deno.test("mensagem de prazo expirado: clara, diz que a nota vale, que a venda não foi cancelada e manda ao contador", () => {
  const m = mensagemPrazoExpirado({ model: "65", limiteMin: 30, decorridoMin: 147.2 });
  assertEquals(
    m,
    "Prazo de cancelamento expirado: esta NFC-e foi autorizada há 2 h 27 min e o prazo é de 30 minutos. A nota continua válida e a venda não foi cancelada. Fale com o seu contador.",
  );
  assertMatch(m, /Prazo de cancelamento expirado/i); // o smoke do cancelamento procura este trecho
  const nfe = mensagemPrazoExpirado({ model: "55", limiteMin: 1440, decorridoMin: 26 * 60 });
  assertMatch(nfe, /esta NF-e foi autorizada há 26 h e o prazo é de 24 horas/);
  assertNotMatch(m, /Rejeição|cStat|501/);
});

Deno.test("mensagem para a rejeição 501 da SEFAZ (quando o bloqueio local não pegou)", () => {
  const m = mensagemRejeicaoPrazo("65");
  assertMatch(m, /A SEFAZ recusou o cancelamento: o prazo legal para cancelar esta NFC-e já passou/);
  assertMatch(m, /A nota continua válida e a venda não foi cancelada/);
  assertNotMatch(m, /Rejeição: Prazo de cancelamento superior/);
});

Deno.test("gêmeo da interface: mesma tabela e mesmos resultados do servidor em toda uma grade de casos", () => {
  assertEquals(JSON.parse(JSON.stringify(web.PRAZO_CANCELAMENTO_MIN)), JSON.parse(JSON.stringify(PRAZO_CANCELAMENTO_MIN)));
  const ufs = ["GO", "go", " GO ", "SP", "MG", null, ""];
  const modelos = ["65", "55", 65, 55, "nfse", null];
  const minutos = [-5, 0, 29.99, 30, 30.01, 147, 1439.99, 1440, 1440.01, 100_000];
  for (const uf of ufs) {
    for (const model of modelos) {
      assertEquals(web.prazoCancelamentoMin(uf, model), prazoCancelamentoMin(uf as never, model as never));
      for (const min of minutos) {
        const entrada = { uf: uf as never, model: model as never, authorizedAt: AUTORIZADA, agora: depois(min) };
        assertEquals(web.analisarPrazoCancelamento(entrada), analisarPrazoCancelamento(entrada), `${uf}/${model}/${min}`);
      }
    }
  }
  for (const m of [0, 0.5, 30, 59.99, 60, 90, 147.2, 1440, 5000]) assertEquals(web.formatarDuracao(m), formatarDuracao(m));
  for (const model of ["65", "55", 65, null]) {
    assertEquals(web.mensagemRejeicaoPrazo(model), mensagemRejeicaoPrazo(model));
    for (const [limiteMin, decorridoMin] of [[30, 31], [30, 147.2], [1440, 1500], [60, 61]]) {
      assertEquals(web.mensagemPrazoExpirado({ model, limiteMin, decorridoMin }), mensagemPrazoExpirado({ model, limiteMin, decorridoMin }));
    }
  }
});

Deno.test("dica do botão desabilitado menciona o prazo e a hora da autorização", () => {
  const dica = web.dicaPrazoExpirado({ model: "65", limiteMin: 30, authorizedAt: AUTORIZADA });
  assertMatch(dica, /^Prazo de 30 minutos para cancelar a NFC-e expirado \(autorizada às \d{2}:\d{2}\)$/);
  assert(web.dicaPrazoExpirado({ model: "55", limiteMin: 1440, authorizedAt: AUTORIZADA }).includes("24 horas"));
});
