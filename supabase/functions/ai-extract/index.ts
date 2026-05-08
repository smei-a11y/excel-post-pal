// Edge function: receives PPTX doc text + target language, calls Lovable AI
// internally with LOVABLE_API_KEY, returns extracted posts.
// Auth: Bearer WORKER_SHARED_SECRET (shared with the Cloud Run worker).

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!WORKER_SHARED_SECRET || token !== WORKER_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { doc?: string; targetLangName?: string; targetCode?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { doc, targetLangName, targetCode } = body;
  if (!doc || !targetLangName || !targetCode) {
    return new Response(JSON.stringify({ error: "doc, targetLangName, targetCode required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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
    return new Response(JSON.stringify({ error: `AI ${aiRes.status}: ${t}` }), {
      status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const aiData = await aiRes.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    return new Response(JSON.stringify({ error: "no tool_call" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const args = JSON.parse(toolCall.function.arguments);
  return new Response(JSON.stringify(args), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
