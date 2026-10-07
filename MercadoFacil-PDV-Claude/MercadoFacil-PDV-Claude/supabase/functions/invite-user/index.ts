// invite-user — admin da empresa cria colaborador (Auth + profile)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { rateLimited } from "../_shared/rateLimit.ts";

const bodySchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(6).max(72),
  full_name: z.string().trim().max(200).optional(),
  name: z.string().trim().max(200).optional(),
  role: z.enum(["admin", "user"]).optional(),
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
    } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: me } = await admin
      .from("profiles")
      .select("company_id, company_role, role, platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!me?.company_id) return json({ error: "Empresa não vinculada." }, 400);
    const canInvite =
      me.platform_admin ||
      me.company_role === "owner" ||
      me.role === "admin";
    if (!canInvite) return json({ error: "Sem permissão para convidar." }, 403);

    const limited = await rateLimited(admin, {
      key: `invite-user:${me.company_id}`,
      max: 20,
      windowSeconds: 300,
    });
    if (limited) return limited;

    const rawBody = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Dados inválidos", details: parsed.error.flatten() }, 400);
    }
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    const full_name = String(body.full_name || body.name || "").trim();
    const role = body.role === "admin" ? "admin" : "user";

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (cErr) return json({ error: cErr.message }, 400);

    const { error: pErr } = await admin.from("profiles").upsert({
      id: created.user.id,
      email,
      full_name: full_name || email.split("@")[0],
      role,
      company_id: me.company_id,
      company_role: role === "admin" ? "admin" : "staff",
      plan_status: "active",
      updated_at: new Date().toISOString(),
    });
    if (pErr) return json({ error: pErr.message }, 400);

    return json({
      ok: true,
      user: { id: created.user.id, email, role, full_name },
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
