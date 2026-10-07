// listCompanies — somente platform_admin
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { rateLimited } from "../_shared/rateLimit.ts";

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
      key: `list-companies:${user.id}`,
      max: 30,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const { data: companies, error } = await admin
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 400);

    return json({ companies: companies || [] });
  } catch (e) {
    console.error(e);
    return json({ error: "Erro interno" }, 500);
  }
});
