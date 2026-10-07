// registerCompany — cria/atualiza empresa do usuário autenticado + trial
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { rateLimited } from "../_shared/rateLimit.ts";

// Validação de forma/tipo antes de tocar no banco — string vazia normaliza
// pra undefined (campo não veio), então CAMPOS opcionais continuam opcionais.
const bodySchema = z.object({
  trade_name: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  legal_name: z.string().trim().max(200).nullish(),
  document: z.string().trim().max(20).nullish(),
  phone: z.string().trim().max(20).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  cep: z.string().trim().max(10).nullish(),
  address: z.string().trim().max(200).nullish(),
  address_number: z.string().trim().max(20).nullish(),
  complement: z.string().trim().max(100).nullish(),
  neighborhood: z.string().trim().max(100).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(2).nullish(),
  instagram: z.string().trim().max(100).nullish(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(url, service);

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    // Cadastro/edição de empresa não é uma ação de alto volume — 10 por
    // usuário a cada 5 minutos cobre uso normal com folga.
    const limited = await rateLimited(admin, {
      key: `register-company:${user.id}`,
      max: 10,
      windowSeconds: 300,
    });
    if (limited) return limited;

    const rawBody = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Dados inválidos", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const trade_name = String(body.trade_name || body.name || "").trim();
    if (!trade_name) return json({ error: "Informe o nome fantasia (trade_name)." }, 400);

    const fields = {
      trade_name,
      legal_name: body.legal_name || null,
      document: body.document || null,
      phone: body.phone || null,
      email: body.email || user.email || null,
      cep: body.cep || null,
      address: body.address || null,
      address_number: body.address_number || null,
      complement: body.complement || null,
      neighborhood: body.neighborhood || null,
      city: body.city || null,
      state: body.state || null,
      instagram: body.instagram || null,
      updated_at: new Date().toISOString(),
    };

    const { data: profile, error: pErr } = await userClient
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 400);

    let companyId = profile?.company_id || null;
    let company;

    if (companyId) {
      const { data, error } = await userClient
        .from("companies")
        .update(fields)
        .eq("id", companyId)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      company = data;
    } else {
      const { data: boot, error: bErr } = await userClient.rpc("bootstrap_company", {
        p_trade_name: trade_name,
        p_email: fields.email,
      });
      if (bErr) return json({ error: bErr.message }, 400);
      companyId = boot?.id;
      if (!companyId) return json({ error: "Falha ao criar empresa" }, 500);
      const { data, error } = await userClient
        .from("companies")
        .update(fields)
        .eq("id", companyId)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      company = data;
    }

    // Garante trial no profile se ainda none
    if (!profile?.plan_status || profile.plan_status === "none") {
      const trialStart = new Date().toISOString();
      const trialEnd = new Date(Date.now() + 7 * 864e5).toISOString();
      await admin
        .from("profiles")
        .update({
          plan_status: "trial",
          trial_started_at: trialStart,
          plan_expires_at: trialEnd,
          company_id: companyId,
          company_role: profile?.company_role || "owner",
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    }

    return json({
      ok: true,
      message: "Empresa salva!",
      company,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
