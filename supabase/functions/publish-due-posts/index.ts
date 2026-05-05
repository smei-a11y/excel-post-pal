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

    const { data: settings } = await supabase.from("app_settings").select("webhook_url, caption_language").eq("id", 1).single();
    const webhook = settings?.webhook_url;
    const lang = (settings?.caption_language || "de") as "de" | "en" | "both";

    const results: any[] = [];
    for (const post of posts || []) {
      if (!webhook) {
        results.push({ id: post.id, skipped: "no webhook configured" });
        continue;
      }
      const images = (post.post_images || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((i: any) => i.public_url);
      const tagLine = (post.hashtags || []).map((h: string) => "#" + h.replace(/^#/, "")).join(" ");
      const de = `${post.translated_caption || ""}\n\n${post.translated_cta || ""}`.trim();
      const en = `${post.original_caption || ""}\n\n${post.original_cta || ""}`.trim();
      const body = lang === "en" ? en : lang === "both" ? `${de}\n\n— — —\n\n${en}` : de;
      const text = `${body}\n\n${tagLine}\n\n${post.link_url || ""}`.trim();
      const image_url = images[0] || "";
      const link = post.link_url || "";
      const title = ((post.focus || "LinkedIn Beitrag") as string).slice(0, 200);
      const description = (lang === "en" ? (post.original_caption || "") : (post.translated_caption || "") || body).slice(0, 300);
      const payload = {
        // Zapier LinkedIn-friendly top-level fields. Use `comment`/`text` for the visible LinkedIn post body.
        text,
        comment: text,
        commentary: text,
        message: text,
        post_text: text,
        share_commentary: text,
        title,
        description,
        image_url,
        image,
        link,
        url: link,
        submitted_url: link,
        submitted_image_url: image_url,
        content__title: title,
        content__description: description,
        content__submitted_url: link,
        content__submitted_image_url: image_url,
        content__comment: text,
        content: {
          title,
          description,
          submitted_url: link,
          submitted_image_url: image_url,
          comment: text,
        },
        // Extras
        post_id: post.id,
        focus: post.focus,
        format: post.format,
        language: lang,
        caption_de: post.translated_caption,
        caption_en: post.original_caption,
        cta_de: post.translated_cta,
        cta_en: post.original_cta,
        hashtags: post.hashtags,
        link_url: link,
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
