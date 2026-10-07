// activateCompany — platform_admin altera status da loja
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { rateLimited } from "../_shared/rateLimit.ts";

const bodySchema = z.object({
  company_id: z.string().uuid(),
  status: z.enum(["pending", "active", "suspended", "rejected"]),
  plan: z.string().trim().max(50).optional(),
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

    const { data: profile } = await admin
      .from("profiles")
      .select("platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.platform_admin) {
      return json({ error: "Acesso negado (platform_admin)." }, 403);
    }

    const limited = await rateLimited(admin, {
      key: `activate-company:${user.id}`,
      max: 20,
      windowSeconds: 300,
    });
    if (limited) return limited;

    const rawBody = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Dados inválidos", details: parsed.error.flatten() }, 400);
    }
    const { company_id, status, plan: bodyPlan } = parsed.data;

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (status === "active") {
      patch.plan_status = "active";
      patch.plan = bodyPlan || "pro";
    }
    if (status === "suspended" || status === "rejected") {
      patch.plan_status = status === "suspended" ? "suspended" : "none";
    }

    const { data, error } = await admin
      .from("companies")
      .update(patch)
      .eq("id", company_id)
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 400);

    // sincroniza profiles da empresa
    if (status === "active" || status === "suspended" || status === "rejected") {
      await admin
        .from("profiles")
        .update({
          plan_status: patch.plan_status,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company_id);
    }

    return json({ ok: true, company: data });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
