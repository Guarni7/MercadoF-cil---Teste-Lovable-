// A regra que a tela Fiscal > Tributação grava precisa ser aceita pelo motor
// tributário do fiscal-emit. Importa o mesmo módulo puro que a tela usa.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @ts-ignore módulo JS da tela, sem tipos
import { formVazio, montarRegra, validarForm, ehRegraGeralVigente, regimeSuportado } from "../../../../src/lib/taxRulesForm.js";
import { applyTaxRules, type FiscalContext, type FiscalItem, type TaxRule } from "./taxEngine.ts";

const ctx: FiscalContext = { model: "65", uf: "GO", crt: "1", tax_regime: "simples", issued_at: new Date("2026-10-02T12:00:00Z") };
const item = (ncm: string): FiscalItem => ({ name: "Refrigerante", quantity: 1, price: 8, total: 8, ncm, cfop: "5102", unit: "UN", origin: "0" });
const comoRegra = (f: Record<string, unknown>, id: string): TaxRule => ({ id, company_id: "c1", ...montarRegra(f) } as unknown as TaxRule);

Deno.test("regra padrão do formulário é aceita pelo motor, sem erro de tributação", () => {
  const r = applyTaxRules([comoRegra(formVazio(), "geral")], [item("22021000")], ctx);
  assertEquals(r.errors.length, 0);
  const t = r.items[0].taxes;
  assertEquals((t.icms as { csosn: string }).csosn, "102");
  assertEquals((t.pis as { cst: string }).cst, "01");
  assertEquals((t.cofins as { aliquota: number }).aliquota, 0);
});

Deno.test("sem regra vigente continua sendo erro (nada de alíquota chutada)", () => {
  const futura = comoRegra({ ...formVazio(), validFrom: "2027-01-01" }, "futura");
  assertEquals(applyTaxRules([futura], [item("22021000")], ctx).errors.length, 1);
  const inativa = comoRegra({ ...formVazio(), active: false }, "inativa");
  assertEquals(applyTaxRules([inativa], [item("22021000")], ctx).errors.length, 1);
});

Deno.test("regra com NCM vence a regra geral só para aquele NCM", () => {
  const geral = comoRegra(formVazio(), "geral");
  const bebida = comoRegra({ ...formVazio(), ncm: "2202", csosn: "400" }, "bebida");
  const r = applyTaxRules([geral, bebida], [item("22021000"), item("19053100")], ctx);
  assertEquals((r.items[0].taxes.icms as { csosn: string }).csosn, "400");
  assertEquals((r.items[1].taxes.icms as { csosn: string }).csosn, "102");
});

Deno.test("validação do formulário e detecção da regra geral vigente", () => {
  assertEquals(validarForm(formVazio()).length, 0);
  assertEquals(validarForm({ ...formVazio(), ncm: "12" }).length, 0);
  assertEquals(validarForm({ ...formVazio(), ncm: "1" }).length, 1);
  assertEquals(validarForm({ ...formVazio(), csosn: "900" }).length, 1);
  assertEquals(validarForm({ ...formVazio(), pisAliquota: "150" }).length, 1);
  assertEquals(validarForm({ ...formVazio(), pisCst: "49" }).length, 1);
  assertEquals(validarForm({ ...formVazio(), validTo: "2020-01-01" }).length, 1);
  assertEquals(ehRegraGeralVigente({ ...montarRegra(formVazio()) }, "2026-10-02"), true);
  assertEquals(ehRegraGeralVigente({ ...montarRegra({ ...formVazio(), ncm: "2202" }) }, "2026-10-02"), false);
  assertEquals(regimeSuportado("1") && regimeSuportado("4") && !regimeSuportado("3"), true);
});
