/**
 * Smoke test mínimo Supabase (API real, sem mock).
 * Uso: node scripts/supabase-min-smoke.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  return env;
}

const env = loadEnvLocal();
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
/** Só para smoke lab — NUNCA use VITE_ nem exponha no frontend */
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !anon) {
  console.error("FAIL: .env.local sem VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const stamp = Date.now();
// Gmail +alias (domínio real; Supabase rejeita @example.com)
const userA = {
  email: `guarni07+mf.a.${stamp}@gmail.com`,
  password: `TestA-${stamp}aA1!`,
};
const userB = {
  email: `guarni07+mf.b.${stamp}@gmail.com`,
  password: `TestB-${stamp}bB1!`,
};

function client(key = anon) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Obtém sessão utilizável.
 * Com SUPABASE_SERVICE_ROLE_KEY: cria usuário já confirmado (evita e-mail + rate limit).
 * Sem service role: signUp (exige Confirm email OFF).
 */
async function authenticateLabUser({ email, password }, label) {
  const sb = client();

  if (serviceRole) {
    const admin = client(serviceRole);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: email.split("@")[0] },
    });

    if (createErr) {
      const already = /already|registered|exists|duplicate/i.test(createErr.message);
      if (!already) throw new Error(`${label} admin createUser: ${createErr.message}`);
      const { data: listed, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) throw new Error(`${label} listUsers: ${listErr.message}`);
      const found = (listed?.users || []).find(
        (u) => (u.email || "").toLowerCase() === email.toLowerCase()
      );
      if (!found) throw new Error(`${label}: usuário existe mas não encontrado no admin`);
      const { error: updErr } = await admin.auth.admin.updateUserById(found.id, {
        password,
        email_confirm: true,
      });
      if (updErr) throw new Error(`${label} updateUser: ${updErr.message}`);
    } else if (!created?.user) {
      throw new Error(`${label}: admin createUser sem user`);
    }

    const { data: login, error: loginErr } = await sb.auth.signInWithPassword({
      email,
      password,
    });
    if (loginErr) throw new Error(`${label} signIn: ${loginErr.message}`);
    if (!login.session?.user) throw new Error(`${label}: signIn sem sessão`);
    return { sb, user: login.user, via: "service-role-confirm" };
  }

  const { data: sign, error: signErr } = await sb.auth.signUp({ email, password });
  if (signErr) throw new Error(`${label} signup: ${signErr.message}`);
  if (sign.session?.user) {
    return { sb, user: sign.user, via: "signup-session" };
  }

  throw new Error(
    `${label}: sem sessão e sem SUPABASE_SERVICE_ROLE_KEY.\n` +
      `Use o Chrome (já logado no Supabase), NÃO a aba vazia do Cursor:\n` +
      `https://supabase.com/dashboard/project/rrawbkhdinsvzbdsknon/settings/api-keys\n` +
      `Reveal service_role → copie → no .env.local:\n` +
      `SUPABASE_SERVICE_ROLE_KEY=eyJ...\n` +
      `(local only; .gitignore cobre .env.*)`
  );
}

async function ensureTenant(sb, user) {
  let { data: profile, error } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!profile) {
    const { data, error: e } = await sb
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email,
        full_name: user.email.split("@")[0],
        role: "admin",
        plan_status: "trial",
        trial_started_at: new Date().toISOString(),
        plan_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      })
      .select("*")
      .single();
    if (e) throw e;
    profile = data;
  }
  if (!profile.company_id) {
    const { data: company, error: ce } = await sb.rpc("bootstrap_company", {
      p_trade_name: `Empresa ${user.email}`,
      p_email: user.email,
    });
    if (ce) throw ce;
    const { data: linked, error: le } = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (le) throw le;
    if (!linked?.company_id) {
      throw new Error(
        "bootstrap_company não vinculou profile. Rode supabase/migrations/004_bootstrap_company.sql"
      );
    }
    profile = linked;
    if (!company?.id) {
      // rpc pode retornar row object
    }
  }
  return profile;
}

async function main() {
  const report = [];

  const authA = await authenticateLabUser(userA, "user A");
  const sbA = authA.sb;
  report.push(`auth A: OK (via ${authA.via})`);

  const profileA = await ensureTenant(sbA, authA.user);
  if (!profileA?.company_id) throw new Error("profile A sem company_id");
  report.push(`profile A + company/trial: OK (${profileA.company_id})`);

  const { data: session1 } = await sbA.auth.getSession();
  if (!session1.session) throw new Error("sessão A não persistiu no client");
  report.push("sessão A: OK");

  // Product CRUD A
  const { data: created, error: createErr } = await sbA
    .from("products")
    .insert({
      name: `Produto smoke ${stamp}`,
      price: 9.9,
      stock: 3,
      company_id: profileA.company_id,
      active: true,
    })
    .select("*")
    .single();
  if (createErr) throw new Error(`create product: ${createErr.message}`);
  report.push(`create product: OK (${created.id})`);

  const { data: listed, error: listErr } = await sbA.from("products").select("*").order("name");
  if (listErr) throw new Error(`list products: ${listErr.message}`);
  if (!listed?.some((p) => p.id === created.id)) throw new Error("list não retornou produto criado");
  report.push(`list products: OK (n=${listed.length})`);

  const { data: updated, error: updErr } = await sbA
    .from("products")
    .update({ price: 12.5, name: `Produto smoke edit ${stamp}` })
    .eq("id", created.id)
    .select("*")
    .single();
  if (updErr) throw new Error(`update product: ${updErr.message}`);
  if (Number(updated.price) !== 12.5) throw new Error("update não aplicou price");
  report.push("update product: OK");

  // Logout A / login again
  await sbA.auth.signOut();
  const { error: loginAgainErr } = await sbA.auth.signInWithPassword(userA);
  if (loginAgainErr) throw new Error(`re-login A: ${loginAgainErr.message}`);
  const { data: again } = await sbA
    .from("products")
    .select("id,name,price")
    .eq("id", created.id)
    .maybeSingle();
  if (!again) throw new Error("após re-login, produto sumiu");
  report.push("logout + login A mantém produto: OK");

  // User B — não deve ver produto de A
  const authB = await authenticateLabUser(userB, "user B");
  const sbB = authB.sb;
  report.push(`auth B: OK (via ${authB.via})`);
  const profileB = await ensureTenant(sbB, authB.user);
  if (profileB.company_id === profileA.company_id) {
    throw new Error("RLS setup inválido: A e B na mesma company");
  }

  const { data: leak, error: leakErr } = await sbB.from("products").select("*").eq("id", created.id);
  if (leakErr) throw new Error(`B select: ${leakErr.message}`);
  if (leak && leak.length > 0) {
    throw new Error(
      `RLS FAIL: usuário B enxergou produto de A (id=${created.id}). Policies ainda permissivas? Rode 002_tenant_rls.sql`
    );
  }
  report.push("RLS cross-tenant products: OK (B não vê produto de A)");

  // Customers / Categories / Brands — CRUD A + RLS B
  await sbA.auth.signInWithPassword(userA);
  const tenantEntities = [
    {
      table: "customers",
      insert: { name: `Cliente smoke ${stamp}`, company_id: profileA.company_id },
      patch: { name: `Cliente edit ${stamp}` },
    },
    {
      table: "categories",
      insert: { name: `Cat smoke ${stamp}`, company_id: profileA.company_id },
      patch: { name: `Cat edit ${stamp}` },
    },
    {
      table: "brands",
      insert: { name: `Marca smoke ${stamp}`, company_id: profileA.company_id },
      patch: { name: `Marca edit ${stamp}` },
    },
  ];

  for (const ent of tenantEntities) {
    const { data: row, error: cErr } = await sbA
      .from(ent.table)
      .insert(ent.insert)
      .select("*")
      .single();
    if (cErr) throw new Error(`create ${ent.table}: ${cErr.message}`);

    const { data: listedEnt, error: lErr } = await sbA.from(ent.table).select("id").eq("id", row.id);
    if (lErr) throw new Error(`list ${ent.table}: ${lErr.message}`);
    if (!listedEnt?.length) throw new Error(`list ${ent.table} vazio após create`);

    const { error: uErr } = await sbA.from(ent.table).update(ent.patch).eq("id", row.id);
    if (uErr) throw new Error(`update ${ent.table}: ${uErr.message}`);

    const { data: leakEnt, error: leakE } = await sbB
      .from(ent.table)
      .select("*")
      .eq("id", row.id);
    if (leakE) throw new Error(`B select ${ent.table}: ${leakE.message}`);
    if (leakEnt?.length) {
      throw new Error(`RLS FAIL: B viu ${ent.table} de A (${row.id})`);
    }

    await sbA.from(ent.table).delete().eq("id", row.id);
    report.push(`CRUD+RLS ${ent.table}: OK`);
  }

  // Demais entidades tenant (Fase 2)
  const moreEntities = [
    {
      table: "sales",
      insert: {
        total: 19.9,
        status: "concluida",
        items: [{ name: "x", qty: 1, price: 19.9 }],
        company_id: profileA.company_id,
      },
      patch: { total: 29.9 },
    },
    {
      table: "stock_movements",
      insert: {
        type: "entrada",
        quantity: 2,
        product_name: `Mov ${stamp}`,
        company_id: profileA.company_id,
      },
      patch: { quantity: 3 },
    },
    {
      table: "cash_registers",
      insert: {
        status: "aberto",
        opening_balance: 100,
        company_id: profileA.company_id,
      },
      patch: { notes: `caixa ${stamp}` },
    },
    {
      table: "bills",
      insert: {
        description: `Conta ${stamp}`,
        amount: 50,
        type: "pagar",
        status: "open",
        company_id: profileA.company_id,
      },
      patch: { amount: 55 },
    },
    {
      table: "delivery_orders",
      insert: {
        status: "pending",
        customer_name: `Entrega ${stamp}`,
        total: 10,
        company_id: profileA.company_id,
      },
      patch: { status: "done" },
    },
    {
      table: "activity_logs",
      insert: {
        type: "smoke",
        description: `log ${stamp}`,
        company_id: profileA.company_id,
      },
      patch: { description: `log edit ${stamp}` },
    },
    {
      table: "nfces",
      insert: {
        sale_id: `sale-${stamp}`,
        status: "draft",
        company_id: profileA.company_id,
      },
      patch: { status: "issued" },
    },
  ];

  for (const ent of moreEntities) {
    const { data: row, error: cErr } = await sbA
      .from(ent.table)
      .insert(ent.insert)
      .select("*")
      .single();
    if (cErr) throw new Error(`create ${ent.table}: ${cErr.message}`);

    const { error: uErr } = await sbA.from(ent.table).update(ent.patch).eq("id", row.id);
    if (uErr) throw new Error(`update ${ent.table}: ${uErr.message}`);

    const { data: leakEnt, error: leakE } = await sbB.from(ent.table).select("id").eq("id", row.id);
    if (leakE) throw new Error(`B select ${ent.table}: ${leakE.message}`);
    if (leakEnt?.length) throw new Error(`RLS FAIL: B viu ${ent.table} de A (${row.id})`);

    await sbA.from(ent.table).delete().eq("id", row.id);
    report.push(`CRUD+RLS ${ent.table}: OK`);
  }

  // cleanup own product
  await sbA.auth.signInWithPassword(userA);
  await sbA.from("products").delete().eq("id", created.id);

  console.log(
    JSON.stringify(
      {
        ok: true,
        report,
        userA: userA.email,
        userB: userB.email,
        serviceRoleUsed: Boolean(serviceRole),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }, null, 2));
  process.exit(1);
});
