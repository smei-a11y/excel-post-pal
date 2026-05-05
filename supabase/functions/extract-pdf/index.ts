import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  publish_at: string; // ISO
  translated_caption: string;
  translated_cta: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { batchId } = await req.json();
    if (!batchId) throw new Error("batchId required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const { data: batch, error: bErr } = await supabase.from("batches").select("*").eq("id", batchId).single();
    if (bErr || !batch) throw new Error("batch not found");

    // Download PDF
    const { data: pdfBlob, error: dlErr } = await supabase.storage.from("post-pdfs").download(batch.pdf_path);
    if (dlErr || !pdfBlob) throw new Error("pdf download failed: " + dlErr?.message);
    const pdfBuf = new Uint8Array(await pdfBlob.arrayBuffer());
    const pdfBase64 = btoa(String.fromCharCode(...pdfBuf.subarray(0, 0))) || base64Encode(pdfBuf);

    const systemPrompt = `Du extrahierst LinkedIn-Posts aus einem PDF Content-Plan und übersetzt sie ins Deutsche.
Gib für jeden Post zurück:
- position (P1, P2... als Zahl 1-N)
- focus (Thema/Titel)
- format (CAROUSEL/SINGLE IMAGE/VIDEO)
- caption (Original Englisch, vollständig)
- cta (Call to Action, Original)
- hashtags (Array, ohne #)
- link_url
- publish_at (ISO 8601 UTC, kombiniere DATE + TIME. Bei Zeitspanne wie "10-12 PM" nimm den Anfang. Datumsformat im PDF ist DD.MM.YYYY)
- translated_caption (vollständige professionelle deutsche Übersetzung der caption)
- translated_cta (deutsche Übersetzung des CTA)
Übersetze natürlich und professionell für LinkedIn-Business.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extrahiere alle Posts aus diesem PDF und übersetze sie ins Deutsche." },
              {
                type: "file",
                file: { filename: batch.source_filename || "content.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_posts",
              description: "Speichert die extrahierten und übersetzten Posts.",
              parameters: {
                type: "object",
                properties: {
                  posts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        position: { type: "number" },
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
                      required: ["position", "focus", "format", "caption", "hashtags", "publish_at", "translated_caption"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["posts"],
                additionalProperties: false,
              },
            },
          },
        ],
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
    if (!toolCall) throw new Error("Kein tool_call in AI Antwort");
    const args = JSON.parse(toolCall.function.arguments) as { posts: ExtractedPost[] };

    // Render PDF pages to images for creatives — skip; instead extract embedded images via simple page rasterization is heavy.
    // We'll use rasterized page screenshots as creatives via the AI gateway image rendering is not available.
    // Approach: ask AI to also pick the relevant images. For simplicity we render each page as image client-side later.
    // Here we just save posts; images can be uploaded manually per post in UI.

    const inserted: any[] = [];
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
      if (error) console.error("insert error", error);
      else inserted.push(row);
    }

    await supabase.from("batches").update({ status: "ready" }).eq("id", batchId);

    return new Response(JSON.stringify({ success: true, count: inserted.length, posts: inserted }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const body = await req.clone().json();
      if (body?.batchId) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await supabase.from("batches").update({ status: "error", error: msg }).eq("id", body.batchId);
      }
    } catch {}
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
