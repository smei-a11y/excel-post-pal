// Worker API: all DB + storage operations for the Cloud Run worker.
// Authenticated via WORKER_SHARED_SECRET. Uses service role internally.
// Actions: fetch-batch, create-post, finish-batch
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function base64ToBlob(base64: string, contentType = "application/octet-stream") {
  const normalized = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;
  if (fromBase64) return new Blob([fromBase64(normalized)], { type: contentType });

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!WORKER_SHARED_SECRET || token !== WORKER_SHARED_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const action = body?.action;

  try {
    if (action === "claim-batch") {
      // Atomically claim queued -> processing
      const { batchId } = body;
      if (!batchId) return json({ error: "batchId required" }, 400);
      const { data: claimed, error } = await admin
        .from("batches")
        .update({ status: "processing" })
        .eq("id", batchId)
        .eq("status", "queued")
        .select()
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!claimed) return json({ claimed: false }, 200);

      // Also fetch caption language + signed download URL
      const { data: settings } = await admin
        .from("app_settings")
        .select("caption_language")
        .eq("user_id", claimed.user_id)
        .maybeSingle();

      const { data: signed, error: sErr } = await admin.storage
        .from("post-pdfs")
        .createSignedUrl(claimed.pdf_path, 600);
      if (sErr) return json({ error: "signed url failed: " + sErr.message }, 500);

      return json({
        claimed: true,
        batch: claimed,
        captionLanguage: settings?.caption_language || "de",
        downloadUrl: signed.signedUrl,
      });
    }

    if (action === "create-post") {
      // body: { post: {...}, media: [{base64, ext, contentType}] }
      const { post, media } = body;
      if (!post?.user_id || !post?.batch_id) return json({ error: "post.user_id and batch_id required" }, 400);

      const { data: row, error } = await admin.from("posts").insert({
        user_id: post.user_id,
        batch_id: post.batch_id,
        position: post.position,
        focus: post.focus,
        format: post.format,
        original_caption: post.original_caption,
        original_cta: post.original_cta,
        translated_caption: post.translated_caption,
        translated_cta: post.translated_cta,
        hashtags: post.hashtags,
        link_url: post.link_url,
        publish_at: post.publish_at,
      }).select().single();
      if (error || !row) return json({ error: error?.message || "insert failed" }, 500);

      const uploaded: string[] = [];
      const mediaArr: Array<{ base64: string; ext: string; contentType: string }> = media || [];
      for (let i = 0; i < mediaArr.length; i++) {
        const m = mediaArr[i];
        const path = `${post.user_id}/${post.batch_id}/${row.id}/${i}.${m.ext}`;
        const uploadBody = await base64ToBlob(m.base64, m.contentType);
        const { error: upErr } = await admin.storage.from("post-images").upload(path, uploadBody, {
          contentType: m.contentType,
          upsert: true,
        });
        if (upErr) { console.error("upload err", upErr); continue; }
        const { data: pub } = admin.storage.from("post-images").getPublicUrl(path);
        await admin.from("post_images").insert({
          user_id: post.user_id,
          post_id: row.id,
          storage_path: path,
          public_url: pub.publicUrl,
          sort_order: i,
        });
        uploaded.push(path);
      }
      return json({ postId: row.id, uploaded });
    }

    if (action === "finish-batch") {
      // body: { batchId, status: 'ready'|'error', error? }
      const { batchId, status, error: errMsg } = body;
      if (!batchId || !status) return json({ error: "batchId and status required" }, 400);
      const update: Record<string, unknown> = { status };
      if (status === "error" && errMsg) update.error = errMsg;
      const { error } = await admin.from("batches").update(update).eq("id", batchId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("worker-api error", msg);
    return json({ error: msg }, 500);
  }
});
