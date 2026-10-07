// assign-role — owner/admin altera role de usuário da mesma empresa
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";
import { rateLimited } from "../_shared/rateLimit.ts";

const bodySchema = z.object({
  user_id: z.string().uuid(),
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
    const canAssign =
      me.platform_admin ||
      me.company_role === "owner" ||
      me.role === "admin";
    if (!canAssign) return json({ error: "Sem permissão." }, 403);

    const limited = await rateLimited(admin, {
      key: `assign-role:${user.id}`,
      max: 20,
      windowSeconds: 300,
    });
    if (limited) return limited;

    const rawBody = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return json({ error: "Dados inválidos", details: parsed.error.flatten() }, 400);
    }
    const user_id = parsed.data.user_id;
    const role = parsed.data.role === "admin" ? "admin" : "user";

    const { data: target } = await admin
      .from("profiles")
      .select("id, company_id")
      .eq("id", user_id)
      .maybeSingle();
    if (!target || target.company_id !== me.company_id) {
      return json({ error: "Usuário fora da empresa." }, 403);
    }

    const { data, error } = await admin
      .from("profiles")
      .update({
        role,
        company_role: role === "admin" ? "admin" : "staff",
        updated_at: new Date().toISOString(),
      })
      .eq("id", user_id)
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, user: data });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
