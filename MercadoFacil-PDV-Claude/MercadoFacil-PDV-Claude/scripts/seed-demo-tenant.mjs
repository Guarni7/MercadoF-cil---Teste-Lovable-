/**
 * Cria uma loja de demonstração com movimento suficiente para exercitar as
 * telas (relatórios, caixa, financeiro, compras) com dados reais.
 *
 * Existe porque validar relatório em loja vazia não prova nada: filtro de
 * período, ranking e margem só mostram defeito quando há venda de dias
 * diferentes, formas de pagamento distintas, sangria, suprimento, conta paga e
 * conta em aberto.
 *
 * Uso:
 *   node scripts/seed-demo-tenant.mjs            # cria e imprime as credenciais
 *   node scripts/seed-demo-tenant.mjs --cleanup <company_id> <email>
 *
 * Nunca toca em loja existente: cria empresa e usuário próprios.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);

if (args[0] === "--cleanup") {
  const companyId = args[1];
  const email = args[2];
  if (!companyId) throw new Error("Informe o company_id para limpar.");
  const tabelas = [
    "activity_logs",
    "stock_movements",
    "delivery_orders",
    "bills",
    "sales",
    "cash_registers",
    "products",
    "customers",
    "categories",
    "brands",
    "company_payment_settings",
    "company_payment_secrets",
    "pix_charges",
  ];
  for (const t of tabelas) {
    const { error } = await admin.from(t).delete().eq("company_id", companyId);
    if (error) console.error(`${t}: ${error.message}`);
  }
  if (email) {
    const { data } = await admin.auth.admin.listUsers();
    const user = data?.users?.find((u) => u.email === email);
    if (user) {
      await admin.from("profiles").delete().eq("id", user.id);
      await admin.auth.admin.deleteUser(user.id);
    }
  }
  await admin.from("companies").delete().eq("id", companyId);
  console.log(JSON.stringify({ ok: true, removido: companyId }, null, 2));
  process.exit(0);
}

const stamp = Date.now();
const email = `guarni07+mf.demo.${stamp}@gmail.com`;
const password = `Demo-${stamp}aA1!`;
const terminalId = `term-demo-${stamp}`;

const { data: criado, error: userErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Ana Demonstração" },
});
if (userErr) throw userErr;

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await sb.auth.signInWithPassword({ email, password });

const { data: company, error: bootErr } = await sb.rpc("bootstrap_company", {
  p_trade_name: `Mercado Demonstração ${stamp}`,
  p_email: email,
});
if (bootErr) throw bootErr;

const companyId = company.id;
const vendedor = { id: criado.user.id, nome: "Ana Demonstração" };

await sb
  .from("companies")
  .update({
    legal_name: "Mercado Demonstração LTDA",
    document: "12345678000199",
    phone: "62992506433",
    city: "Goiânia",
    state: "GO",
    neighborhood: "Setor Central",
    address: "Rua Um",
    address_number: "100",
  })
  .eq("id", companyId);

function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Catálogo
const categorias = [
  { name: "Mercearia", color: "#16a34a" },
  { name: "Bebidas", color: "#2563eb" },
  { name: "Limpeza", color: "#f59e0b" },
];
await sb.from("categories").insert(categorias.map((c) => ({ ...c, company_id: companyId })));
await sb.from("brands").insert(
  ["Tio João", "Coca-Cola", "Ypê"].map((name) => ({ name, company_id: companyId }))
);

const catalogo = [
  { name: "Arroz 5kg", price: 27.9, cost: 19.5, stock: 40, min_stock: 10, category: "Mercearia", brand: "Tio João", unit: "UN", barcode: "7891000001", ncm: "10063021" },
  { name: "Feijão 1kg", price: 8.49, cost: 5.9, stock: 60, min_stock: 15, category: "Mercearia", unit: "UN", barcode: "7891000002", ncm: "07133319" },
  { name: "Refrigerante 2L", price: 9.99, cost: 6.2, stock: 35, min_stock: 12, category: "Bebidas", brand: "Coca-Cola", unit: "UN", barcode: "7891000003", ncm: "22021000" },
  { name: "Detergente 500ml", price: 3.29, cost: 1.95, stock: 8, min_stock: 20, category: "Limpeza", brand: "Ypê", unit: "UN", barcode: "7891000004", ncm: "34022000" },
  { name: "Café 500g", price: 18.9, cost: 13.4, stock: 22, min_stock: 8, category: "Mercearia", unit: "UN", barcode: "7891000005", ncm: "09012100" },
];
const { data: produtos, error: prodErr } = await sb
  .from("products")
  .insert(catalogo.map((p) => ({ ...p, active: true, company_id: companyId })))
  .select();
if (prodErr) throw prodErr;

// Clientes, um deles com crediário em aberto
const { data: clientes, error: cliErr } = await sb
  .from("customers")
  .insert([
    { name: "João da Silva", phone: "62991110001", document: "11122233344", credit_limit: 500, credit_balance: 87.4, city: "Goiânia", state: "GO", active: true, company_id: companyId },
    { name: "Maria Souza", phone: "62991110002", document: "55566677788", credit_limit: 300, credit_balance: 0, city: "Goiânia", state: "GO", active: true, company_id: companyId },
    { name: "Padaria do Zé", phone: "62991110003", document: "99988877000155", customer_type: "pj", legal_name: "Padaria do Zé ME", credit_limit: 1000, credit_balance: 240, city: "Aparecida", state: "GO", active: true, company_id: companyId },
  ])
  .select();
if (cliErr) throw cliErr;

// Caixa fechado (ontem) e caixa aberto (hoje)
const { data: caixas, error: caixaErr } = await sb
  .from("cash_registers")
  .insert([
    {
      status: "fechado",
      opening_balance: 150,
      closing_balance: 612.3,
      sales_total: 462.3,
      sales_count: 6,
      withdrawals_total: 100,
      supplies_total: 100,
      opened_at: diasAtras(1).toISOString(),
      closed_at: diasAtras(1).toISOString(),
      opened_by_name: vendedor.nome,
      terminal_id: terminalId,
      terminal_name: "Caixa 1",
      client_id: `cash-${randomUUID()}`,
      company_id: companyId,
    },
    {
      status: "aberto",
      opening_balance: 200,
      sales_total: 0,
      sales_count: 0,
      opened_at: new Date().toISOString(),
      opened_by_name: vendedor.nome,
      terminal_id: terminalId,
      terminal_name: "Caixa 1",
      client_id: `cash-${randomUUID()}`,
      company_id: companyId,
    },
  ])
  .select();
if (caixaErr) throw caixaErr;

const caixaFechado = caixas.find((c) => c.status === "fechado");
const caixaAberto = caixas.find((c) => c.status === "aberto");

// Vendas espalhadas em dias e formas de pagamento diferentes
const formas = ["dinheiro", "pix", "credito", "debito", "crediario"];
const vendas = [];
for (let i = 0; i < 14; i++) {
  const dia = diasAtras(i % 7);
  const produto = produtos[i % produtos.length];
  const qtd = (i % 3) + 1;
  const subtotal = Number((produto.price * qtd).toFixed(2));
  const desconto = i % 5 === 0 ? 2 : 0;
  const total = Number((subtotal - desconto).toFixed(2));
  const forma = formas[i % formas.length];
  const cliente = forma === "crediario" ? clientes[i % clientes.length] : null;
  vendas.push({
    number: 1000 + i,
    items: [
      {
        product_id: produto.id,
        name: produto.name,
        quantity: qtd,
        price: produto.price,
        // Mesmo formato que o PDV grava; sem isso o relatório por produto some.
        total: subtotal,
        cost: produto.cost,
      },
    ],
    subtotal,
    discount: desconto,
    total,
    payment_method: forma,
    amount_received: forma === "dinheiro" ? total + 5 : total,
    change: forma === "dinheiro" ? 5 : 0,
    status: "concluida",
    customer_id: cliente?.id || null,
    customer_name: cliente?.name || null,
    cash_register_id: i % 7 === 0 ? caixaAberto.id : caixaFechado.id,
    client_id: `sale-${randomUUID()}`,
    terminal_id: terminalId,
    terminal_name: "Caixa 1",
    created_by_id: vendedor.id,
    created_by_name: vendedor.nome,
    created_at: dia.toISOString(),
    created_date: dia.toISOString(),
    company_id: companyId,
  });
}
const { error: vendaErr } = await sb.from("sales").insert(vendas);
if (vendaErr) throw vendaErr;

// Movimentos de estoque com custo, inclusive entrada de compra
const movimentos = [];
for (let i = 0; i < produtos.length; i++) {
  const p = produtos[i];
  movimentos.push({
    product_id: p.id,
    product_name: p.name,
    type: "entrada",
    quantity: 20,
    unit_cost: p.cost,
    reason: "compra",
    client_id: `stk-${randomUUID()}`,
    terminal_id: terminalId,
    created_at: diasAtras(5).toISOString(),
    company_id: companyId,
  });
  movimentos.push({
    product_id: p.id,
    product_name: p.name,
    type: "entrada",
    quantity: 10,
    unit_cost: Number((p.cost * 1.08).toFixed(2)),
    reason: "compra",
    client_id: `stk-${randomUUID()}`,
    terminal_id: terminalId,
    created_at: diasAtras(2).toISOString(),
    company_id: companyId,
  });
  movimentos.push({
    product_id: p.id,
    product_name: p.name,
    type: "saida",
    quantity: 3,
    reason: "venda",
    client_id: `stk-${randomUUID()}`,
    terminal_id: terminalId,
    created_at: diasAtras(1).toISOString(),
    company_id: companyId,
  });
}
const { error: movErr } = await sb.from("stock_movements").insert(movimentos);
if (movErr) throw movErr;

// Financeiro: conta paga, conta a vencer, conta vencida e compra por XML
const { error: billErr } = await sb.from("bills").insert([
  {
    description: "Energia elétrica",
    amount: 420.5,
    due_date: diasAtras(-5).toISOString().slice(0, 10),
    status: "pendente",
    type: "pagar",
    category: "Despesas fixas",
    supplier: "Equatorial",
    paid: false,
    company_id: companyId,
  },
  {
    description: "Aluguel",
    amount: 2500,
    due_date: diasAtras(3).toISOString().slice(0, 10),
    status: "pendente",
    type: "pagar",
    category: "Despesas fixas",
    supplier: "Imobiliária Centro",
    paid: false,
    company_id: companyId,
  },
  {
    description: "Internet",
    amount: 149.9,
    due_date: diasAtras(10).toISOString().slice(0, 10),
    status: "pago",
    type: "pagar",
    category: "Despesas fixas",
    supplier: "Fibra Net",
    paid: true,
    paid_date: diasAtras(10).toISOString().slice(0, 10),
    payment_method: "pix",
    company_id: companyId,
  },
  {
    description: "Compra NF 4587 — Distribuidora Central",
    amount: 1875.4,
    due_date: diasAtras(-15).toISOString().slice(0, 10),
    status: "pendente",
    type: "pagar",
    category: "Compras",
    supplier: "Distribuidora Central",
    source: "xml",
    document_number: "4587",
    access_key: `5226${stamp}0000000000000000000000000000000001`.slice(0, 44),
    issue_date: diasAtras(6).toISOString().slice(0, 10),
    paid: false,
    company_id: companyId,
  },
]);
if (billErr) throw billErr;

// Delivery
const { error: delErr } = await sb.from("delivery_orders").insert([
  {
    number: 1,
    status: "entregue",
    customer_id: clientes[0].id,
    customer_name: clientes[0].name,
    customer_phone: clientes[0].phone,
    address: "Rua Dois",
    address_number: "45",
    neighborhood: "Setor Bueno",
    city: "Goiânia",
    state: "GO",
    items: [{ name: "Arroz 5kg", quantity: 1, price: 27.9 }],
    subtotal: 27.9,
    delivery_fee: 7,
    total: 34.9,
    payment_method: "pix",
    delivery_person: "Carlos",
    created_at: diasAtras(2).toISOString(),
    company_id: companyId,
  },
  {
    number: 2,
    status: "pendente",
    customer_name: "Cliente Balcão",
    customer_phone: "62991110009",
    address: "Rua Três",
    address_number: "12",
    city: "Goiânia",
    state: "GO",
    items: [{ name: "Refrigerante 2L", quantity: 2, price: 9.99 }],
    subtotal: 19.98,
    delivery_fee: 7,
    total: 26.98,
    payment_method: "dinheiro",
    company_id: companyId,
  },
]);
if (delErr) throw delErr;

// Log de atividades: abertura, sangria, suprimento e fechamento
const { error: logErr } = await sb.from("activity_logs").insert([
  {
    type: "abertura_caixa",
    description: "Caixa aberto com R$ 150,00",
    severity: "info",
    amount: 150,
    cash_register_id: caixaFechado.id,
    user_name: vendedor.nome,
    user_role: "admin",
    created_at: diasAtras(1).toISOString(),
    company_id: companyId,
  },
  {
    type: "sangria",
    description: "Sangria para o cofre",
    severity: "info",
    amount: 100,
    change_amount: -100,
    cash_register_id: caixaFechado.id,
    user_name: vendedor.nome,
    user_role: "admin",
    created_at: diasAtras(1).toISOString(),
    company_id: companyId,
  },
  {
    type: "suprimento",
    description: "Suprimento para troco",
    severity: "info",
    amount: 100,
    change_amount: 100,
    cash_register_id: caixaFechado.id,
    user_name: vendedor.nome,
    user_role: "admin",
    created_at: diasAtras(1).toISOString(),
    company_id: companyId,
  },
  {
    type: "fechamento_caixa",
    description: "Caixa fechado com diferença de R$ -5,00",
    severity: "warning",
    amount: 612.3,
    discrepancy: -5,
    cash_register_id: caixaFechado.id,
    user_name: vendedor.nome,
    user_role: "admin",
    created_at: diasAtras(1).toISOString(),
    company_id: companyId,
  },
]);
if (logErr) throw logErr;

console.log(
  JSON.stringify(
    {
      ok: true,
      company_id: companyId,
      email,
      password,
      produtos: produtos.length,
      clientes: clientes.length,
      vendas: vendas.length,
      movimentos: movimentos.length,
      limpar: `node scripts/seed-demo-tenant.mjs --cleanup ${companyId} ${email}`,
    },
    null,
    2
  )
);
