import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !WORKER_SHARED_SECRET) {
  console.error("Missing required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WORKER_SHARED_SECRET");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LANG_NAMES = {
  de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch",
  pt: "Portugiesisch", nl: "Niederländisch", pl: "Polnisch", sv: "Schwedisch", no: "Norwegisch",
  da: "Dänisch", fi: "Finnisch", cs: "Tschechisch", sk: "Slowakisch", hu: "Ungarisch",
  ro: "Rumänisch", bg: "Bulgarisch", el: "Griechisch", hr: "Kroatisch", sl: "Slowenisch",
  et: "Estnisch", lv: "Lettisch", lt: "Litauisch", ga: "Irisch", mt: "Maltesisch",
};

console.log(`[worker] starting — HTTP trigger mode`);

const port = parseInt(process.env.PORT || "8080", 10);
const http = await import("http");

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // Process trigger
  if (req.method === "POST" && req.url === "/process") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== WORKER_SHARED_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let payload;
    try { payload = await readJson(req); } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: "invalid json" })); return;
    }
    const batchId = payload?.batchId;
    if (!batchId || typeof batchId !== "string") {
      res.writeHead(400); res.end(JSON.stringify({ error: "batchId required" })); return;
    }

    // Fire-and-forget: respond 202 immediately
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, batchId }));

    // Process in background
    handleBatchById(batchId).catch((e) => console.error("[handle] unexpected", e));
    return;
  }

  res.writeHead(404); res.end("not found");
}).listen(port, () => console.log(`[worker] HTTP server listening on :${port}`));

async function handleBatchById(batchId) {
  console.log(`[worker] received trigger for batch ${batchId}`);
  // Atomically claim: only proceed if status is 'queued', set to 'processing'
  const { data: claimed, error: claimErr } = await supabase
    .from("batches")
    .update({ status: "processing" })
    .eq("id", batchId)
    .eq("status", "queued")
    .select()
    .maybeSingle();
  if (claimErr) { console.error("[claim] error", claimErr); return; }
  if (!claimed) {
    console.log(`[worker] batch ${batchId} not in 'queued' state, skipping`);
    return;
  }
  await processBatch(claimed);
}


async function processBatch(batch) {
  const batchId = batch.id;
  const userId = batch.user_id;
  try {
    const { data: settings } = await supabase
      .from("app_settings").select("caption_language").eq("user_id", userId).maybeSingle();
    const rawLang = settings?.caption_language || "de";
    const targetCode = rawLang === "both" ? "de" : (rawLang === "en" ? "en" : rawLang);
    const targetLangName = LANG_NAMES[targetCode] || "Deutsch";

    console.log(`[batch ${batchId}] downloading ${batch.pdf_path}`);
    const { data: fileBlob, error: dlErr } = await supabase.storage.from("post-pdfs").download(batch.pdf_path);
    if (dlErr || !fileBlob) throw new Error("download failed: " + dlErr?.message);
    const fileBuf = Buffer.from(await fileBlob.arrayBuffer());
    console.log(`[batch ${batchId}] downloaded ${(fileBuf.length / 1024 / 1024).toFixed(1)} MB`);

    const filename = (batch.source_filename || batch.pdf_path || "").toLowerCase();
    const isPptx = filename.endsWith(".pptx") || filename.endsWith(".ppt");
    if (!isPptx) throw new Error("Only PPTX supported by this worker");

    const { posts, mediaPerPage } = await extractFromPptx(fileBuf, targetLangName, targetCode);
    console.log(`[batch ${batchId}] extracted ${posts.length} posts`);

    for (const p of posts) {
      const { data: row, error } = await supabase.from("posts").insert({
        user_id: userId,
        batch_id: batchId,
        position: p.position,
        focus: p.focus,
        format: p.format,
        original_caption: p.caption,
        original_cta: p.cta,
        translated_caption: p.translated_caption,
        translated_cta: p.translated_cta,
        hashtags: p.hashtags,
        link_url: p.link_url,
        publish_at: p.publish_at,
      }).select().single();
      if (error || !row) { console.error("insert error", error); continue; }

      const media = mediaPerPage.get(p.pdf_page) || [];
      for (let i = 0; i < media.length; i++) {
        const m = media[i];
        const path = `${userId}/${batchId}/${row.id}/${i}.${m.ext}`;
        const { error: upErr } = await supabase.storage.from("post-images").upload(path, m.bytes, {
          contentType: m.contentType,
          upsert: true,
        });
        if (upErr) { console.error("upload err", upErr); continue; }
        const { data: pub } = supabase.storage.from("post-images").getPublicUrl(path);
        await supabase.from("post_images").insert({
          user_id: userId,
          post_id: row.id,
          storage_path: path,
          public_url: pub.publicUrl,
          sort_order: i,
        });
      }
    }

    await supabase.from("batches").update({ status: "ready" }).eq("id", batchId);
    console.log(`[batch ${batchId}] ✅ done`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[batch ${batchId}] ❌`, msg);
    await supabase.from("batches").update({ status: "error", error: msg }).eq("id", batchId);
  }
}

async function extractFromPptx(buf, targetLangName, targetCode) {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));

  const slides = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const slidePath = slideFiles[i];
    const xml = await zip.file(slidePath).async("string");
    const text = extractTextFromSlideXml(xml);
    const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
    const media = [];
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      const relsXml = await relsFile.async("string");
      const targets = [...relsXml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
      const seen = new Set();
      for (const t of targets) {
        const resolved = resolvePath("ppt/slides/" + slidePath.split("/").pop(), t);
        if (!resolved.startsWith("ppt/media/")) continue;
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        const f = zip.file(resolved);
        if (!f) continue;
        const ext = (resolved.split(".").pop() || "").toLowerCase();
        const ct = mimeFromExt(ext);
        if (!ct) continue;
        const bytes = Buffer.from(await f.async("uint8array"));
        media.push({ bytes, ext, contentType: ct });
      }
    }
    slides.push({ idx: i + 1, text, media });
  }

  const doc = slides.map((s) => {
    const fmtHint = s.media.some((m) => m.contentType.startsWith("video/"))
      ? "(slide contains a VIDEO)"
      : s.media.length > 1 ? "(slide contains multiple images — likely CAROUSEL)"
      : s.media.length === 1 ? "(slide contains a single image)" : "(no media)";
    return `===== Slide ${s.idx} ${fmtHint} =====\n${s.text}`;
  }).join("\n\n");

  const systemPrompt = `Du extrahierst LinkedIn-Posts aus einem PPTX Content-Plan und übersetzt sie ins ${targetLangName}.
Jede Slide ist üblicherweise ein Post. Übersichts-/Cover-Slides bitte überspringen.
Gib für jeden Post zurück:
- position (P1=1, P2=2, ...)
- pdf_page (slide-Nummer im PPTX wo dieser Post liegt — nutze die Slide-Nummer aus dem Header "===== Slide N =====")
- focus (Thema)
- format (CAROUSEL/SINGLE IMAGE/VIDEO — leite vom Hinweis (video/multiple images/single image) ab)
- caption (Original, vollständig, unverändert)
- cta (Call to Action Original, unverändert)
- hashtags (Array, ohne #)
- link_url
- publish_at (ISO 8601 UTC, kombiniere DATE + TIME. DD.MM.YYYY. Bei Zeitspanne nimm Anfang.)
- translated_caption (professionelle Übersetzung der caption ins ${targetLangName}${targetCode === "en" ? " — falls Original bereits Englisch ist, übernehme es 1:1" : ""})
- translated_cta (Übersetzung des CTA ins ${targetLangName})`;

  const aiRes = await fetch(`${SUPABASE_URL}/functions/v1/ai-extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WORKER_SHARED_SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ doc, targetLangName, targetCode }),
  });
  if (!aiRes.ok) {
    const t = await aiRes.text();
    if (aiRes.status === 429) throw new Error("Rate Limit überschritten");
    if (aiRes.status === 402) throw new Error("Kein Guthaben mehr im Lovable AI Workspace");
    throw new Error(`AI error ${aiRes.status}: ${t}`);
  }
  const args = await aiRes.json();

  const mediaPerPage = new Map();
  for (const p of args.posts) {
    const slide = slides.find((s) => s.idx === p.pdf_page);
    if (slide) mediaPerPage.set(p.pdf_page, slide.media);
  }
  return { posts: args.posts, mediaPerPage };
}

function slideNum(p) { const m = /slide(\d+)\.xml$/.exec(p); return m ? parseInt(m[1], 10) : 0; }
function extractTextFromSlideXml(xml) {
  const parts = []; const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g; let m;
  while ((m = re.exec(xml)) !== null) parts.push(decodeXmlEntities(m[1]));
  return parts.join("\n").trim();
}
function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function resolvePath(from, rel) {
  const fromParts = from.split("/").slice(0, -1);
  const relParts = rel.split("/");
  for (const part of relParts) {
    if (part === "..") fromParts.pop();
    else if (part !== ".") fromParts.push(part);
  }
  return fromParts.join("/");
}
function mimeFromExt(ext) {
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "mp4": return "video/mp4";
    case "mov": return "video/quicktime";
    case "m4v": return "video/x-m4v";
    case "webm": return "video/webm";
    default: return null;
  }
}
function postsTool() {
  return {
    type: "function",
    function: {
      name: "save_posts",
      parameters: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                position: { type: "number" },
                pdf_page: { type: "number" },
                focus: { type: "string" },
                format: { type: "string" },
                caption: { type: "string" },
                cta: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                link_url: { type: "string" },
                publish_at: { type: "string" },
                translated_caption: { type: "string" },
                translated_cta: { type: "string" },
              },
              required: ["position", "pdf_page", "focus", "format", "caption", "hashtags", "publish_at", "translated_caption"],
              additionalProperties: false,
            },
          },
        },
        required: ["posts"],
        additionalProperties: false,
      },
    },
  };
}
