import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(url: string, payload: unknown) {
  let lastErr = "";
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      lastStatus = r.status;
      lastBody = await r.text();
      if (r.ok) return { ok: true, status: r.status, body: lastBody };
      lastErr = `HTTP ${r.status}: ${lastBody.slice(0, 300)}`;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e instanceof Error ? e.message : String(e);
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
  }
  return { ok: false, status: lastStatus, body: lastBody, error: lastErr };
}

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
      const images: string[] = (post.post_images || [])
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((i: any) => i.public_url)
        .filter(Boolean);

      const tagLine = (post.hashtags || []).map((h: string) => "#" + h.replace(/^#/, "")).join(" ");
      const de = `${post.translated_caption || ""}\n\n${post.translated_cta || ""}`.trim();
      const en = `${post.original_caption || ""}\n\n${post.original_cta || ""}`.trim();
      const body = lang === "en" ? en : lang === "both" ? `${de}\n\n— — —\n\n${en}` : de;
      const caption = `${body}\n\n${tagLine}\n\n${post.link_url || ""}`.trim();

      // Helpers to derive file_name + mime_type from URL
      const getFileName = (url: string) => {
        try {
          const u = new URL(url);
          const last = u.pathname.split("/").pop() || "file";
          return decodeURIComponent(last);
        } catch {
          return "file";
        }
      };
      const getMimeType = (fileName: string) => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const map: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
          mp4: "video/mp4",
          mov: "video/quicktime",
          webm: "video/webm",
        };
        return map[ext] || "application/octet-stream";
      };

      // Determine post_type
      let post_type: "TEXT" | "SINGLE IMAGE" | "VIDEO" | "CAROUSEL" = "TEXT";
      const media = images.map((url) => {
        const file_name = getFileName(url);
        const mime_type = getMimeType(file_name);
        const type = mime_type.startsWith("video/") ? "video" : "image";
        return { type, url, file_name, mime_type };
      });
      const hasVideo = media.some((m) => m.type === "video");
      if (hasVideo) post_type = "VIDEO";
      else if (images.length > 1) post_type = "CAROUSEL";
      else if (images.length === 1) post_type = "SINGLE IMAGE";

      const payload = {
        post_type,
        caption,
        media,
        author: {
          name: "",
          email: "",
        },
        meta: {
          created_at: new Date().toISOString(),
          source: "lovable-app",
          post_id: post.id,
          focus: post.focus,
          format: post.format,
          language: lang,
          caption_de: post.translated_caption,
          caption_en: post.original_caption,
          cta_de: post.translated_cta,
          cta_en: post.original_cta,
          hashtags: post.hashtags,
          link: post.link_url || "",
          publish_at: post.publish_at,
        },
      };

      const result = await postWithRetry(webhook, payload);
      await supabase.from("posts").update({
        status: result.ok ? "published" : "failed",
        published_at: result.ok ? new Date().toISOString() : null,
        webhook_response: result.ok
          ? `${result.status}: ${(result.body || "").slice(0, 500)}`
          : `${result.error || "failed"}`,
      }).eq("id", post.id);
      results.push({ id: post.id, ok: result.ok, status: result.status });
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
