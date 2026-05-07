import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const { code, state, redirectUri } = body || {};
    if (!code || !state || !redirectUri) {
      return new Response("Missing code/state/redirectUri", { status: 400, headers: cors });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: st } = await admin.from("linkedin_oauth_states").select("*").eq("state", state).maybeSingle();
    if (!st) return new Response("Invalid state", { status: 400, headers: cors });

    const userId: string = st.user_id;
    await admin.from("linkedin_oauth_states").delete().eq("state", state);

    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID")!;
    const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET")!;

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const tokRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const tokTxt = await tokRes.text();
    if (!tokRes.ok) return new Response(`Token exchange failed: ${tokTxt}`, { status: 400, headers: cors });
    const tok = JSON.parse(tokTxt);

    const accessToken: string = tok.access_token;
    const expiresIn: number = tok.expires_in || 0;
    const refreshToken: string | undefined = tok.refresh_token;
    const refreshExpiresIn: number | undefined = tok.refresh_token_expires_in;

    // userinfo (OpenID) -> sub = member id
    const uiRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const ui = uiRes.ok ? await uiRes.json() : {};
    const memberId: string | undefined = ui.sub;
    const name: string | undefined = ui.name;

    const update: Record<string, any> = {
      user_id: userId,
      linkedin_access_token: accessToken,
      linkedin_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (refreshToken) update.linkedin_refresh_token = refreshToken;
    if (refreshExpiresIn) update.linkedin_refresh_expires_at = new Date(Date.now() + refreshExpiresIn * 1000).toISOString();
    if (memberId) update.linkedin_author_urn = `urn:li:person:${memberId}`;
    if (name) update.linkedin_connected_name = name;

    await admin.from("app_settings").upsert(update, { onConflict: "user_id" });

    return new Response(JSON.stringify({ ok: true, returnUrl: st.return_url, name }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
