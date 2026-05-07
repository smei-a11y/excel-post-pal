import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as mupdf from "npm:mupdf@1.3.0";
import JSZip from "https://esm.sh/jszip@3.10.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedPost {
  position: number;
  focus: string;
  format: string;
  caption: string;
  cta: string;
  hashtags: string[];
  link_url: string;
  publish_at: string;
  translated_caption: string;
  translated_cta: string;
  pdf_page: number;
}

const LANG_NAMES: Record<string, string> = {
  de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch",
  pt: "Portugiesisch", nl: "Niederländisch", pl: "Polnisch", sv: "Schwedisch", no: "Norwegisch",
  da: "Dänisch", fi: "Finnisch", cs: "Tschechisch", sk: "Slowakisch", hu: "Ungarisch",
  ro: "Rumänisch", bg: "Bulgarisch", el: "Griechisch", hr: "Kroatisch", sl: "Slowenisch",
  et: "Estnisch", lv: "Lettisch", lt: "Litauisch", ga: "Irisch", mt: "Maltesisch",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const batchId: string | undefined = body?.batchId;
    if (!batchId) throw new Error("batchId required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userRes } = await supabase.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) throw new Error("Nicht authentifiziert");

    // Mark batch as processing immediately so the UI can react
    await supabase.from("batches").update({ status: "processing", error: null }).eq("id", batchId).eq("user_id", userId);

    // Run heavy work in the background — return 202 immediately
    // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
    EdgeRuntime.waitUntil(processBatch(batchId, userId).catch(async (e) => {
      console.error("background processing failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await supabase.from("batches").update({ status: "error", error: msg }).eq("id", batchId);
      } catch {}
    }));

    return new Response(JSON.stringify({ accepted: true, batchId }), {
      status: 202,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

async function processBatch(batchId: string, userId: string) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

  const { data: batch, error: bErr } = await supabase.from("batches").select("*").eq("id", batchId).eq("user_id", userId).single();
  if (bErr || !batch) throw new Error("batch not found");

  const { data: settings } = await supabase
    .from("app_settings").select("caption_language").eq("user_id", userId).maybeSingle();
  const rawLang = (settings?.caption_language || "de") as string;
  const targetCode = rawLang === "both" ? "de" : (rawLang === "en" ? "en" : rawLang);
  const targetLangName = LANG_NAMES[targetCode] || "Deutsch";

  const { data: fileBlob, error: dlErr } = await supabase.storage.from("post-pdfs").download(batch.pdf_path);
  if (dlErr || !fileBlob) throw new Error("file download failed: " + dlErr?.message);
  const fileBuf = new Uint8Array(await fileBlob.arrayBuffer());

  const filename = (batch.source_filename || batch.pdf_path || "").toLowerCase();
  const isPptx = filename.endsWith(".pptx") || filename.endsWith(".ppt");

  let posts: ExtractedPost[];
  let mediaPerPage: Map<number, Array<{ bytes: Uint8Array; ext: string; contentType: string }>>;

  if (isPptx) {
    const r = await extractFromPptx(fileBuf, targetLangName, targetCode, LOVABLE_API_KEY);
    posts = r.posts;
    mediaPerPage = r.mediaPerPage;
  } else {
    const r = await extractFromPdf(fileBuf, batch.source_filename || "content.pdf", targetLangName, targetCode, LOVABLE_API_KEY);
    posts = r.posts;
    mediaPerPage = r.mediaPerPage;
  }

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
}

// ---------- PDF branch (unchanged behaviour) ----------
async function extractFromPdf(pdfBuf: Uint8Array, filename: string, targetLangName: string, targetCode: string, apiKey: string) {
  const pdfBase64 = base64Encode(pdfBuf);
  const systemPrompt = pdfSystemPrompt(targetLangName, targetCode);

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [
          { type: "text", text: `Extrahiere alle Posts aus diesem PDF und übersetze ins ${targetLangName}.` },
          { type: "file", file: { filename, file_data: `data:application/pdf;base64,${pdfBase64}` } },
        ] },
      ],
      tools: [postsTool()],
      tool_choice: { type: "function", function: { name: "save_posts" } },
    }),
  });
  if (!aiRes.ok) {
    const t = await aiRes.text();
    if (aiRes.status === 429) throw new Error("Rate Limit überschritten");
    if (aiRes.status === 402) throw new Error("Kein Guthaben mehr im Lovable AI Workspace");
    throw new Error(`AI error ${aiRes.status}: ${t}`);
  }
  const aiData = await aiRes.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Kein tool_call");
  const args = JSON.parse(toolCall.function.arguments) as { posts: ExtractedPost[] };

  const doc = mupdf.Document.openDocument(pdfBuf.buffer, "application/pdf");
  const totalPages = doc.countPages();
  const mediaPerPage = new Map<number, Array<{ bytes: Uint8Array; ext: string; contentType: string }>>();
  for (const p of args.posts) {
    const pageIdx = Math.max(0, Math.min(totalPages - 1, (p.pdf_page || p.position + 1) - 1));
    try {
      const images = await extractPdfPageImages(doc, pageIdx);
      mediaPerPage.set(p.pdf_page, images.map((bytes) => ({ bytes, ext: "png", contentType: "image/png" })));
    } catch (e) { console.error(`pdf image extract failed page ${pageIdx}:`, e); }
  }
  return { posts: args.posts, mediaPerPage };
}

// ---------- PPTX branch ----------
async function extractFromPptx(buf: Uint8Array, targetLangName: string, targetCode: string, apiKey: string) {
  const zip = await JSZip.loadAsync(buf);

  // Determine slide order from presentation.xml.rels + presentation.xml
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b));

  // Build per-slide text and media
  type SlideInfo = { idx: number; text: string; media: Array<{ bytes: Uint8Array; ext: string; contentType: string }> };
  const slides: SlideInfo[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slidePath = slideFiles[i];
    const xml = await zip.file(slidePath)!.async("string");
    const text = extractTextFromSlideXml(xml);

    // load rels
    const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
    const media: SlideInfo["media"] = [];
    const relsFile = zip.file(relsPath);
    if (relsFile) {
      const relsXml = await relsFile.async("string");
      const targets = [...relsXml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
      const seen = new Set<string>();
      for (const t of targets) {
        // resolve relative path
        const resolved = resolvePath("ppt/slides/" + slidePath.split("/").pop(), t);
        if (!resolved.startsWith("ppt/media/")) continue;
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        const f = zip.file(resolved);
        if (!f) continue;
        const ext = (resolved.split(".").pop() || "").toLowerCase();
        const ct = mimeFromExt(ext);
        if (!ct) continue;
        const bytes = new Uint8Array(await f.async("uint8array"));
        media.push({ bytes, ext, contentType: ct });
      }
    }
    slides.push({ idx: i + 1, text, media });
  }

  // Build a textual document for the AI
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

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extrahiere alle Posts aus diesem PPTX-Inhalt und übersetze ins ${targetLangName}.\n\n${doc}` },
      ],
      tools: [postsTool()],
      tool_choice: { type: "function", function: { name: "save_posts" } },
    }),
  });
  if (!aiRes.ok) {
    const t = await aiRes.text();
    if (aiRes.status === 429) throw new Error("Rate Limit überschritten");
    if (aiRes.status === 402) throw new Error("Kein Guthaben mehr im Lovable AI Workspace");
    throw new Error(`AI error ${aiRes.status}: ${t}`);
  }
  const aiData = await aiRes.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Kein tool_call");
  const args = JSON.parse(toolCall.function.arguments) as { posts: ExtractedPost[] };

  const mediaPerPage = new Map<number, Array<{ bytes: Uint8Array; ext: string; contentType: string }>>();
  for (const p of args.posts) {
    const slide = slides.find((s) => s.idx === p.pdf_page);
    if (slide) mediaPerPage.set(p.pdf_page, slide.media);
  }
  return { posts: args.posts, mediaPerPage };
}

function slideNum(p: string): number {
  const m = /slide(\d+)\.xml$/.exec(p);
  return m ? parseInt(m[1], 10) : 0;
}

function extractTextFromSlideXml(xml: string): string {
  const parts: string[] = [];
  // <a:t>text</a:t>
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    parts.push(decodeXmlEntities(m[1]));
  }
  return parts.join("\n").trim();
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function resolvePath(from: string, rel: string): string {
  // from = "ppt/slides/slide1.xml", rel = "../media/image1.png" -> "ppt/media/image1.png"
  const fromParts = from.split("/").slice(0, -1);
  const relParts = rel.split("/");
  for (const part of relParts) {
    if (part === "..") fromParts.pop();
    else if (part !== ".") fromParts.push(part);
  }
  return fromParts.join("/");
}

function mimeFromExt(ext: string): string | null {
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

function pdfSystemPrompt(targetLangName: string, targetCode: string) {
  return `Du extrahierst LinkedIn-Posts aus einem PDF Content-Plan und übersetzt sie ins ${targetLangName}.
Gib für jeden Post zurück:
- position (P1=1, P2=2, ...)
- pdf_page (1-basierte Seitennummer im PDF wo dieser Post beschrieben ist; meist Übersichtsseite=1, P1 auf Seite 2, P2 auf Seite 3, etc.)
- focus (Thema)
- format (CAROUSEL/SINGLE IMAGE/VIDEO)
- caption (Original, vollständig, unverändert)
- cta (Call to Action Original, unverändert)
- hashtags (Array, ohne #)
- link_url
- publish_at (ISO 8601 UTC, kombiniere DATE + TIME. DD.MM.YYYY. Bei Zeitspanne nimm Anfang.)
- translated_caption (professionelle Übersetzung der caption ins ${targetLangName}${targetCode === "en" ? " — falls Original bereits Englisch ist, übernehme es 1:1" : ""})
- translated_cta (Übersetzung des CTA ins ${targetLangName})`;
}

function postsTool() {
  return {
    type: "function" as const,
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

async function extractPdfPageImages(doc: any, pageIdx: number): Promise<Uint8Array[]> {
  const page = doc.loadPage(pageIdx);
  const out: Uint8Array[] = [];
  const seen = new Set<string>();
  const pushPixmap = (pixmap: any) => {
    try {
      const w = pixmap.getWidth?.() ?? pixmap.width;
      const h = pixmap.getHeight?.() ?? pixmap.height;
      if (w && h && (w < 80 || h < 80)) return;
      const png = new Uint8Array(pixmap.asPNG());
      const key = `${png.length}:${png[16]}-${png[32]}-${png[64] ?? 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(png);
    } catch (e) { console.log("pixmap convert failed:", e); }
  };
  try {
    const stext = page.toStructuredText("preserve-images");
    if (typeof stext.walk === "function") {
      stext.walk({
        onImageBlock(_b: unknown, _t: unknown, image: any) {
          try { pushPixmap(image.toPixmap()); } catch (e) { console.log("image.toPixmap failed:", e); }
        },
      });
    }
    if (out.length === 0) {
      try {
        const json = JSON.parse(stext.asJSON());
        for (const block of json.blocks || []) {
          if (block.type === "image" && typeof block.image === "string") {
            const m = /^data:image\/[^;]+;base64,(.+)$/.exec(block.image);
            if (m) out.push(base64Decode(m[1]));
          }
        }
      } catch {}
    }
  } catch (e) { console.log("structured text extraction failed:", e); }
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
