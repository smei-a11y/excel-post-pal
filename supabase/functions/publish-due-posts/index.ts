import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let postId: string | undefined;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        postId = body?.postId;
      } catch {}
    }

    const q = supabase.from("posts").select("*, post_images(public_url, sort_order)").eq("status", "scheduled");
    const { data: posts, error } = postId
      ? await q.eq("id", postId)
      : await q.lte("publish_at", new Date().toISOString());
    if (error) throw error;

    const { data: settings } = await supabase.from("app_settings").select("webhook_url").eq("id", 1).single();
    const webhook = settings?.webhook_url;

    const results: any[] = [];
    for (const post of posts || []) {
      if (!webhook) {
        results.push({ id: post.id, skipped: "no webhook configured" });
        continue;
      }
      const images = (post.post_images || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((i: any) => i.public_url);
      const text = `${post.translated_caption}\n\n${post.translated_cta || ""}\n\n${(post.hashtags || []).map((h: string) => "#" + h.replace(/^#/, "")).join(" ")}\n\n${post.link_url || ""}`.trim();
      const payload = {
        post_id: post.id,
        focus: post.focus,
        format: post.format,
        text,
        caption: post.translated_caption,
        cta: post.translated_cta,
        hashtags: post.hashtags,
        link_url: post.link_url,
        images,
        publish_at: post.publish_at,
      };
      try {
        const r = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const txt = await r.text();
        await supabase.from("posts").update({
          status: r.ok ? "published" : "failed",
          published_at: r.ok ? new Date().toISOString() : null,
          webhook_response: `${r.status}: ${txt.slice(0, 500)}`,
        }).eq("id", post.id);
        results.push({ id: post.id, status: r.status });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("posts").update({ status: "failed", webhook_response: msg }).eq("id", post.id);
        results.push({ id: post.id, error: msg });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
