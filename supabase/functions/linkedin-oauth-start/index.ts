import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u.user) return new Response("Unauthorized", { status: 401, headers: cors });

    const body = await req.json().catch(() => ({}));
    const returnUrl: string = body?.returnUrl || "";
    const redirectUri: string = body?.redirectUri;
    if (!redirectUri) return new Response("redirectUri required", { status: 400, headers: cors });

    const state = crypto.randomUUID();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("linkedin_oauth_states").insert({ state, user_id: u.user.id, return_url: returnUrl });

    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID")!;
    const scope = "openid profile email w_member_social";
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scope);

    return new Response(JSON.stringify({ authUrl: url.toString() }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
