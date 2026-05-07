import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LI_VERSION = "202405";

type Lang = "de" | "en" | "both";

async function liFetch(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.linkedin.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": LI_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  return r;
}

async function uploadImage(token: string, author: string, imageUrl: string): Promise<string> {
  // 1. Initialize upload
  const initRes = await liFetch(`/rest/images?action=initializeUpload`, token, {
    method: "POST",
    body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
  });
  if (!initRes.ok) throw new Error(`initializeUpload (image) failed: ${initRes.status} ${await initRes.text()}`);
  const init = await initRes.json();
  const uploadUrl: string = init.value.uploadUrl;
  const imageUrn: string = init.value.image;

  // 2. Download source image
  const src = await fetch(imageUrl);
  if (!src.ok) throw new Error(`Source image fetch failed: ${src.status}`);
  const bytes = new Uint8Array(await src.arrayBuffer());

  // 3. PUT binary
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: bytes,
  });
  if (!up.ok) throw new Error(`Image upload failed: ${up.status} ${await up.text()}`);

  return imageUrn;
}

async function uploadVideo(token: string, author: string, videoUrl: string): Promise<string> {
  // Download first to know size
  const src = await fetch(videoUrl);
  if (!src.ok) throw new Error(`Source video fetch failed: ${src.status}`);
  const bytes = new Uint8Array(await src.arrayBuffer());
  const fileSize = bytes.byteLength;

  const initRes = await liFetch(`/rest/videos?action=initializeUpload`, token, {
    method: "POST",
    body: JSON.stringify({
      initializeUploadRequest: { owner: author, fileSizeBytes: fileSize, uploadCaptions: false, uploadThumbnail: false },
    }),
  });
  if (!initRes.ok) throw new Error(`initializeUpload (video) failed: ${initRes.status} ${await initRes.text()}`);
  const init = await initRes.json();
  const videoUrn: string = init.value.video;
  const instructions: { uploadUrl: string; firstByte: number; lastByte: number }[] = init.value.uploadInstructions || [];
  const uploadToken: string = init.value.uploadToken || "";

  const etags: string[] = [];
  for (const ins of instructions) {
    const chunk = bytes.slice(ins.firstByte, ins.lastByte + 1);
    const up = await fetch(ins.uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: chunk,
    });
    if (!up.ok) throw new Error(`Video chunk upload failed: ${up.status} ${await up.text()}`);
    const etag = up.headers.get("etag") || up.headers.get("ETag") || "";
    etags.push(etag);
  }

  // Finalize
  const fin = await liFetch(`/rest/videos?action=finalizeUpload`, token, {
    method: "POST",
    body: JSON.stringify({
      finalizeUploadRequest: { video: videoUrn, uploadToken, uploadedPartIds: etags },
    }),
  });
  if (!fin.ok) throw new Error(`finalizeUpload (video) failed: ${fin.status} ${await fin.text()}`);

  return videoUrn;
}

async function createPost(token: string, author: string, commentary: string, content: any | null) {
  const body: any = {
    author,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) body.content = content;

  const r = await liFetch(`/rest/posts`, token, { method: "POST", body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`createPost failed: ${r.status} ${text}`);
  const postUrn = r.headers.get("x-restli-id") || r.headers.get("X-RestLi-Id") || "";
  return { postUrn, status: r.status };
}

// LinkedIn requires escaping certain chars in commentary
function escapeCommentary(s: string): string {
  return s.replace(/[\\(){}\[\]<>@|~_*#`]/g, (m) => `\\${m}`);
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

    const { data: settings } = await supabase
      .from("app_settings")
      .select("caption_language, linkedin_access_token, linkedin_author_urn")
      .eq("id", 1)
      .single();

    const lang = (settings?.caption_language || "de") as Lang;
    const token = settings?.linkedin_access_token;
    const author = settings?.linkedin_author_urn;

    if (!token || !author) {
      return new Response(
        JSON.stringify({ error: "LinkedIn nicht konfiguriert: Access Token und Author URN in Einstellungen hinterlegen." }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const results: any[] = [];
    for (const post of posts || []) {
      try {
        const images: string[] = (post.post_images || [])
          .sort((a: any, b: any) => a.sort_order - b.sort_order)
          .map((i: any) => i.public_url)
          .filter(Boolean);

        const tagLine = (post.hashtags || []).map((h: string) => "#" + h.replace(/^#/, "")).join(" ");
        const de = `${post.translated_caption || ""}\n\n${post.translated_cta || ""}`.trim();
        const en = `${post.original_caption || ""}\n\n${post.original_cta || ""}`.trim();
        const body = lang === "en" ? en : lang === "both" ? `${de}\n\n— — —\n\n${en}` : de;
        const commentary = escapeCommentary(`${body}\n\n${tagLine}\n\n${post.link_url || ""}`.trim());

        // Detect video by extension
        const isVideo = (url: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
        const hasVideo = images.some(isVideo);

        let content: any = null;
        if (hasVideo) {
          const videoUrl = images.find(isVideo)!;
          const videoUrn = await uploadVideo(token, author, videoUrl);
          content = { media: { id: videoUrn } };
        } else if (images.length === 1) {
          const imageUrn = await uploadImage(token, author, images[0]);
          content = { media: { id: imageUrn } };
        } else if (images.length > 1) {
          const urns: string[] = [];
          for (const url of images) {
            urns.push(await uploadImage(token, author, url));
          }
          content = { multiImage: { images: urns.map((id) => ({ id })) } };
        }

        const { postUrn, status } = await createPost(token, author, commentary, content);

        await supabase.from("posts").update({
          status: "published",
          published_at: new Date().toISOString(),
          webhook_response: `LinkedIn ${status}: ${postUrn}`,
        }).eq("id", post.id);

        results.push({ id: post.id, ok: true, postUrn });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase.from("posts").update({
          status: "failed",
          webhook_response: msg.slice(0, 1000),
        }).eq("id", post.id);
        results.push({ id: post.id, ok: false, error: msg });
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
