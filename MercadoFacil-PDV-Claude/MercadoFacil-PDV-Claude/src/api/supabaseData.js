import { supabase } from "@/lib/supabase";
import { getEffectivePlanFields } from "@/lib/companyContext";
import { TRIAL_DAYS } from "@/lib/plans";

/** Mapa Entity Base44 → tabela Supabase */
const TABLE_MAP = {
  Product: "products",
  Customer: "customers",
  Sale: "sales",
  Category: "categories",
  Brand: "brands",
  CashRegister: "cash_registers",
  Bill: "bills",
  StockMovement: "stock_movements",
  DeliveryOrder: "delivery_orders",
  TableOrder: "table_orders",
  TableQrVersion: "table_qr_versions",
  TableRegistry: "table_registry",
  ActivityLog: "activity_logs",
  Company: "companies",
  CompanyPaymentSettings: "company_payment_settings",
  PixCharge: "pix_charges",
  Nfce: "nfces",
  CompanyFiscalSettings: "company_fiscal_settings",
  FiscalDocument: "fiscal_documents",
  FiscalDocumentSeries: "fiscal_document_series",
  FiscalAuditLog: "fiscal_audit_log",
  TaxRuleSet: "tax_rule_sets",
  TaxRule: "tax_rules",
  Service: "services",
  User: "profiles",
  SaleReturn: "sale_returns",
  CompanyStockSettings: "company_stock_settings",
  StockSyncPending: "stock_sync_pending",
  ConnectTefSmartpos: "connecttef_smartpos",
  ConnectTefPayment: "connecttef_payments",
};

function tableFor(entity) {
  const t = TABLE_MAP[entity];
  if (!t) throw new Error(`Entidade não mapeada no Supabase: ${entity}`);
  return t;
}

/** Converte "-created_date" / "name" → { column, ascending } */
function parseOrder(orderBy) {
  if (!orderBy || typeof orderBy !== "string") {
    return { column: "created_at", ascending: false };
  }
  const ascending = !orderBy.startsWith("-");
  let column = ascending ? orderBy : orderBy.slice(1);
  if (column === "created_date") column = "created_at";
  if (column === "updated_date") column = "updated_at";
  return { column, ascending };
}

function normalizeRow(row) {
  if (!row) return row;
  return {
    ...row,
    created_date: row.created_date || row.created_at,
    updated_date: row.updated_date || row.updated_at,
  };
}

// Tabelas cujo RLS exige company_id na linha. O insert do cliente não manda o
// campo, então ele é preenchido aqui a partir do profile.
const TENANT_TABLES = [
  "products",
  "customers",
  "categories",
  "brands",
  "cash_registers",
  "sales",
  "bills",
  "stock_movements",
  "delivery_orders",
  "table_orders",
  "table_qr_versions",
  "table_registry",
  "activity_logs",
  "nfces",
  "services",
  "sale_returns",
  "stock_sync_pending",
];

// Campos de privilégio/billing que nunca podem vir do payload do cliente —
// mesmo que o usuário edite outros campos da própria linha (nome, telefone,
// endereço). Camada de defesa em profundidade: a permissão real já é negada
// pelo Postgres (migration 037, REVOKE por coluna); isto evita mandar a
// tentativa ao banco e devolve um erro claro em vez do erro cru do Postgres.
// Mudança nesses campos passa por RPC/Edge Function autorizada
// (start_trial, assign-role, invite-user, activate-company).
const PRIVILEGED_FIELDS = {
  profiles: ["role", "company_id", "company_role", "platform_admin", "plan", "plan_status", "plan_expires_at", "trial_started_at"],
  companies: ["status", "plan", "plan_status", "plan_expires_at", "trial_started_at", "plan_addons"],
};

function stripPrivilegedFields(table, body) {
  const blocked = PRIVILEGED_FIELDS[table];
  if (!blocked) return body;
  const present = blocked.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
  if (present.length === 0) return body;
  const clean = { ...body };
  for (const f of present) delete clean[f];
  console.warn(
    `[supabaseData] Campo(s) privilegiado(s) removido(s) do payload de "${table}": ${present.join(", ")}. Use o RPC/Edge Function apropriado.`
  );
  return clean;
}

function createEntityApi(entityName) {
  const table = tableFor(entityName);

  return {
    async list(orderBy, limit = 100) {
      const { column, ascending } = parseOrder(orderBy);
      let q = supabase.from(table).select("*");
      q = q.order(column, { ascending, nullsFirst: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(normalizeRow);
    },

    async filter(filters = {}, orderBy, limit = 100) {
      const { column, ascending } = parseOrder(orderBy);
      let q = supabase.from(table).select("*");
      Object.entries(filters || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        q = q.eq(key, value);
      });
      q = q.order(column, { ascending, nullsFirst: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(normalizeRow);
    },

    async count(filters = {}) {
      let q = supabase.from(table).select("id", { count: "exact", head: true });
      Object.entries(filters || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        q = q.eq(key, value);
      });
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    },

    async get(id) {
      const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return normalizeRow(data);
    },

    async create(payload) {
      let body = stripPrivilegedFields(table, { ...payload });
      delete body.id;
      if (body.company_id == null && TENANT_TABLES.includes(table)) {
        const me = await authMe();
        if (!me.company_id) {
          throw new Error("Usuário sem company_id — não é possível criar registro com RLS.");
        }
        body.company_id = me.company_id;
      }
      const { data, error } = await supabase.from(table).insert(body).select().single();
      if (error) throw error;
      return normalizeRow(data);
    },

    async update(id, payload) {
      const body = stripPrivilegedFields(table, { ...payload, updated_at: new Date().toISOString() });
      delete body.id;
      const { data, error } = await supabase.from(table).update(body).eq("id", id).select().single();
      if (error) throw error;
      return normalizeRow(data);
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
      return true;
    },

    async bulkCreate(rows) {
      if (!rows?.length) return [];
      const me = await authMe().catch(() => null);
      const cleaned = rows.map((r) => {
        const x = stripPrivilegedFields(table, { ...r });
        delete x.id;
        if (x.company_id == null && me?.company_id && TENANT_TABLES.includes(table)) {
          x.company_id = me.company_id;
        }
        return x;
      });
      const { data, error } = await supabase.from(table).insert(cleaned).select();
      if (error) throw error;
      return (data || []).map(normalizeRow);
    },

    async bulkUpdate(rows) {
      const out = [];
      for (const row of rows || []) {
        if (!row?.id) continue;
        out.push(await this.update(row.id, row));
      }
      return out;
    },
  };
}

const entityNames = Object.keys(TABLE_MAP);

export const entities = Object.fromEntries(
  entityNames.map((name) => [name, createEntityApi(name)])
);

async function ensureProfileAndCompany(user) {
  const userId = user.id;
  const email = user.email || "";
  const fullName =
    user.user_metadata?.full_name || (email ? email.split("@")[0] : "Usuário");

  let { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw profileErr;

  if (!profile) {
    const { data: created, error } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        email,
        full_name: fullName,
        role: "admin",
        plan_status: "trial",
        trial_started_at: new Date().toISOString(),
        plan_expires_at: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("*")
      .single();
    if (error) throw error;
    profile = created;
  }

  if (!profile.company_id) {
    const { error: companyErr } = await supabase.rpc("bootstrap_company", {
      p_trade_name: fullName || email || "Minha empresa",
      p_email: email || null,
    });
    if (companyErr) throw companyErr;

    const { data: linked, error: linkErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (linkErr) throw linkErr;
    if (!linked?.company_id) {
      throw new Error(
        "Empresa não vinculada ao profile. Aplique supabase/migrations/004_bootstrap_company.sql no SQL Editor."
      );
    }
    profile = linked;
  }

  return profile;
}

/**
 * Falha de rede (internet caiu, servidor inalcançável) — diferente de sessão
 * recusada pelo servidor. Só a segunda justifica deslogar.
 */
export function isOfflineError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String(error?.message || "").toLowerCase();
  return (
    error?.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed")
  );
}

export async function authMe() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const session = sessionData?.session;
  if (!session?.user) {
    const err = /** @type {Error & { status?: number }} */ (new Error("Not authenticated"));
    err.status = 401;
    throw err;
  }

  let profile;
  try {
    profile = await ensureProfileAndCompany(session.user);
  } catch (e) {
    // Sem rede não dá para saber se a sessão vale: descartá-la aqui deixaria o
    // caixa sem app justamente quando a internet caiu.
    if (isOfflineError(e)) throw e;

    // A sessão guardada pode estar revogada (usuário removido, token antigo).
    // Nesse caso o erro vem do banco, não como 401, e o app ficaria preso.
    const { error: userError } = await supabase.auth.getUser();
    if (userError && isOfflineError(userError)) throw e;
    if (userError) {
      await supabase.auth.signOut().catch(() => {});
      const err = /** @type {Error & { status?: number }} */ (new Error("Sessão expirada. Entre novamente."));
      err.status = 401;
      throw err;
    }
    throw e;
  }

  // Plano é atributo do tenant: quem entra numa empresa existente (equipe,
  // dados migrados) herda o plano dela em vez de cair no gate de seleção.
  let company = null;
  if (profile?.company_id) {
    const { data } = await supabase
      .from("companies")
      .select("plan, plan_status, plan_expires_at, trial_started_at, plan_addons")
      .eq("id", profile.company_id)
      .maybeSingle();
    company = data || null;
  }
  const planFields = getEffectivePlanFields(profile, company);

  return {
    id: session.user.id,
    email: session.user.email,
    full_name:
      profile?.full_name ||
      session.user.user_metadata?.full_name ||
      session.user.email?.split("@")[0],
    role: profile?.role || "admin",
    company_id: profile?.company_id || null,
    company_role: profile?.company_role || null,
    platform_admin: !!profile?.platform_admin,
    ...planFields,
  };
}

/**
 * Baixa de estoque + movimentação na mesma transação (idempotente por client_id).
 * @param {{ clientId: string, productId: string, quantity: number, productName?: string, type?: string, reason?: string, notes?: string, terminalId?: string | null, unitCost?: number | null }} params
 */
export async function applyStockMovement({
  clientId,
  productId,
  quantity,
  productName,
  type = "saida",
  reason = "venda",
  notes,
  terminalId,
  unitCost,
}) {
  const { data, error } = await supabase.rpc("apply_stock_movement", {
    p_client_id: clientId,
    p_product_id: productId,
    p_quantity: quantity,
    p_product_name: productName ?? null,
    p_type: type,
    p_reason: reason,
    p_notes: notes ?? null,
    p_terminal_id: terminalId ?? null,
    p_unit_cost: unitCost ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Sangria (retirada) ou suprimento (reforço) de caixa, via apply_cash_movement
 * (063) — nunca lê o total no cliente e soma por cima (perde atualização sob
 * concorrência); client_id idempotente cobre retry/reenvio da fila offline.
 */
export async function applyCashMovement({
  clientId,
  cashRegisterId,
  type,
  amount,
  reason,
  terminalId,
}) {
  const { data, error } = await supabase.rpc("apply_cash_movement", {
    p_client_id: clientId,
    p_cash_register_id: cashRegisterId,
    p_type: type,
    p_amount: amount,
    p_reason: reason ?? null,
    p_terminal_id: terminalId ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * Inicia o teste grátis do tenant (empresa) e espelha no profile.
 *
 * Passa por RPC SECURITY DEFINER (public.start_trial, migration 036) em vez de
 * UPDATE direto em profiles/companies: essas colunas (plan, plan_status,
 * plan_expires_at, status) não são mais graváveis pelo client (ver 036), e o
 * RPC também recusa reativar uma empresa suspensa — o UPDATE direto antigo
 * forçava status="active" incondicionalmente.
 */
export async function startTrial(plan = "mei") {
  const me = await authMe();
  if (!me.company_id) {
    throw new Error("Usuário sem empresa vinculada — cadastre a empresa antes.");
  }
  if (me.plan_status === "active") {
    return { plan: me.plan || plan, plan_status: "active", already: true };
  }

  const { data, error } = await supabase.rpc("start_trial", { p_plan: plan }).single();
  if (error) throw error;
  return { .../** @type {Record<string, any>} */ (data), already: false };
}

export async function loginEmailPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function registerEmailPassword(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { full_name: fullName || "" },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  });
  if (error) throw error;
  return data;
}

export async function loginWithGoogle(returnTo = "/") {
  const redirectTo = `${window.location.origin}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/login`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) throw error;
  // store intended return
  try {
    sessionStorage.setItem("mf_return_to", redirectTo);
  } catch {}
}

export async function logoutAuth(redirectHref) {
  await supabase.auth.signOut();
  if (redirectHref) {
    window.location.href = redirectHref.includes("/login")
      ? redirectHref
      : `${window.location.origin}/login`;
  }
}

export async function resetPasswordRequest(email) {
  // O link tem que cair na tela que troca a senha. Apontando para /login, o
  // usuário voltava para o formulário de entrada com a senha antiga — sem a
  // senha antiga, que era justamente o motivo do pedido.
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
  return true;
}

/**
 * Grava a nova senha. Só funciona com a sessão de recuperação criada pelo link
 * do e-mail (o Supabase a estabelece ao abrir a URL).
 */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return true;
}

const FUNCTION_MAP = {
  generatePixPayment: "generate-pix-payment",
  checkPixPayment: "check-pix-payment",
  registerCompany: "register-company",
  listCompanies: "list-companies",
  activateCompany: "activate-company",
  inviteUser: "invite-user",
  assignRole: "assign-role",
  savePaymentSettings: "save-payment-settings",
  saveFiscalSettings: "save-fiscal-settings",
  fiscalDiagnostics: "fiscal-diagnostics",
  fiscalNfceConfig: "fiscal-nfce-config",
  connectTefPairSmartpos: "connecttef-pair-smartpos",
  connectTefRequestPayment: "connecttef-request-payment",
  fiscalEmit: "fiscal-emit",
  fiscalDocument: "fiscal-document",
};

export async function invokeFunction(name, payload = {}) {
  const fn = FUNCTION_MAP[name];
  if (!fn) {
    throw new Error(
      `Function "${name}" ainda não migrada para Supabase Edge Function. Payload keys: ${Object.keys(payload || {}).join(", ")}`
    );
  }

  const { data, error } = await supabase.functions.invoke(fn, { body: payload || {} });
  if (error) {
    // Em resposta não-2xx o supabase-js entrega só "Edge Function returned a
    // non-2xx status code" e guarda o corpo em error.context. O motivo real
    // (token inválido, sem permissão) está lá, e é o que interessa na tela.
    let detalhe = null;
    let corpo = null;
    try {
      corpo = await error.context?.clone?.().json?.();
      if (typeof corpo?.error === "string") detalhe = corpo.error;
      else if (typeof corpo?.message === "string") detalhe = corpo.message;
    } catch {
      corpo = null;
    }
    const msg =
      detalhe ||
      (typeof data?.error === "string" ? data.error : null) ||
      error.message ||
      `Falha ao chamar ${fn}`;
    const err = /** @type {Error & { body?: unknown }} */ (new Error(msg));
    err.cause = error;
    // Rejeição fiscal traz código do autorizador e lista de pendências. Sem o
    // corpo inteiro a tela só conseguiria repetir a frase genérica, e é
    // justamente o código que o contador usa para resolver.
    err.body = corpo;
    throw err;
  }
  // Compatível com callers que fazem `res.data || res`
  return { data };
}

export function getMercadoPagoWebhookUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") || "";
  return base ? `${base}/functions/v1/mercadopago-webhook` : "";
}

export async function getPublicSettings() {
  return {
    id: "mercadofacil-supabase",
    public_settings: {
      app_name: "MercadoFácil PDV",
    },
  };
}
