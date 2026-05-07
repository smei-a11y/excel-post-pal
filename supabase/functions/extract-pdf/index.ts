import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as mupdf from "npm:mupdf@1.3.0";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  let batchId: string | undefined;
  try {
    const body = await req.json();
    batchId = body?.batchId;
    if (!batchId) throw new Error("batchId required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve calling user from JWT for ownership stamping
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userRes } = await supabase.auth.getUser(jwt);
    const userId = userRes?.user?.id;
    if (!userId) throw new Error("Nicht authentifiziert");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const { data: batch, error: bErr } = await supabase.from("batches").select("*").eq("id", batchId).eq("user_id", userId).single();
    if (bErr || !batch) throw new Error("batch not found");

    const { data: pdfBlob, error: dlErr } = await supabase.storage.from("post-pdfs").download(batch.pdf_path);
    if (dlErr || !pdfBlob) throw new Error("pdf download failed: " + dlErr?.message);
    const pdfBuf = new Uint8Array(await pdfBlob.arrayBuffer());
    const pdfBase64 = base64Encode(pdfBuf);

    const systemPrompt = `Du extrahierst LinkedIn-Posts aus einem PDF Content-Plan und übersetzt sie ins Deutsche.
Gib für jeden Post zurück:
- position (P1=1, P2=2, ...)
- pdf_page (1-basierte Seitennummer im PDF wo dieser Post beschrieben ist; meist Übersichtsseite=1, P1 auf Seite 2, P2 auf Seite 3, etc.)
- focus (Thema)
- format (CAROUSEL/SINGLE IMAGE/VIDEO)
- caption (Original Englisch, vollständig)
- cta (Call to Action Original)
- hashtags (Array, ohne #)
- link_url
- publish_at (ISO 8601 UTC, kombiniere DATE + TIME. DD.MM.YYYY. Bei Zeitspanne nimm Anfang.)
- translated_caption (professionelle deutsche Übersetzung der caption)
- translated_cta (deutsche Übersetzung des CTA)`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrahiere alle Posts aus diesem PDF und übersetze ins Deutsche." },
              { type: "file", file: { filename: batch.source_filename || "content.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` } },
            ],
          },
        ],
        tools: [{
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
        }],
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

    // Render each referenced PDF page to PNG and extract embedded images
    const doc = mupdf.Document.openDocument(pdfBuf.buffer, "application/pdf");
    const totalPages = doc.countPages();

    for (const p of args.posts) {
      const { data: row, error } = await supabase.from("posts").insert({
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

      const pageIdx = Math.max(0, Math.min(totalPages - 1, (p.pdf_page || p.position + 1) - 1));
      try {
        const images = await extractPageImages(doc, pageIdx);
        for (let i = 0; i < images.length; i++) {
          const path = `${batchId}/${row.id}/${i}.png`;
          const { error: upErr } = await supabase.storage.from("post-images").upload(path, images[i], {
            contentType: "image/png",
            upsert: true,
          });
          if (upErr) { console.error("upload err", upErr); continue; }
          const { data: pub } = supabase.storage.from("post-images").getPublicUrl(path);
          await supabase.from("post_images").insert({
            post_id: row.id,
            storage_path: path,
            public_url: pub.publicUrl,
            sort_order: i,
          });
        }
      } catch (e) {
        console.error(`image extract failed for post ${row.id}:`, e);
      }
    }

    await supabase.from("batches").update({ status: "ready" }).eq("id", batchId);

    return new Response(JSON.stringify({ success: true, count: args.posts.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (batchId) {
      try {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await supabase.from("batches").update({ status: "error", error: msg }).eq("id", batchId);
      } catch {}
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

// Extract embedded images from a PDF page (no full-page fallback).
async function extractPageImages(doc: any, pageIdx: number): Promise<Uint8Array[]> {
  const page = doc.loadPage(pageIdx);
  const out: Uint8Array[] = [];
  const seen = new Set<string>();

  const pushPixmap = (pixmap: any) => {
    try {
      const w = pixmap.getWidth?.() ?? pixmap.width;
      const h = pixmap.getHeight?.() ?? pixmap.height;
      if (w && h && (w < 80 || h < 80)) return; // skip icons/decorations
      const png = new Uint8Array(pixmap.asPNG());
      const key = `${png.length}:${png[16]}-${png[32]}-${png[64] ?? 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(png);
    } catch (e) {
      console.log("pixmap convert failed:", e);
    }
  };

  try {
    const stext = page.toStructuredText("preserve-images");
    if (typeof stext.walk === "function") {
      stext.walk({
        onImageBlock(_bbox: unknown, _transform: unknown, image: any) {
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
  } catch (e) {
    console.log("structured text extraction failed:", e);
  }

  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
