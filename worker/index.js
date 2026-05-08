import JSZip from "jszip";

const SUPABASE_URL = process.env.SUPABASE_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;

if (!SUPABASE_URL || !WORKER_SHARED_SECRET) {
  console.error("Missing required env: SUPABASE_URL, WORKER_SHARED_SECRET");
  process.exit(1);
}

const API_BASE = `${SUPABASE_URL}/functions/v1`;
const authHeaders = { Authorization: `Bearer ${WORKER_SHARED_SECRET}`, "Content-Type": "application/json" };

const LANG_NAMES = {
  de: "Deutsch", en: "Englisch", fr: "Französisch", es: "Spanisch", it: "Italienisch",
  pt: "Portugiesisch", nl: "Niederländisch", pl: "Polnisch", sv: "Schwedisch", no: "Norwegisch",
  da: "Dänisch", fi: "Finnisch", cs: "Tschechisch", sk: "Slowakisch", hu: "Ungarisch",
  ro: "Rumänisch", bg: "Bulgarisch", el: "Griechisch", hr: "Kroatisch", sl: "Slowenisch",
  et: "Estnisch", lv: "Lettisch", lt: "Litauisch", ga: "Irisch", mt: "Maltesisch",
};

console.log(`[worker] starting — HTTP trigger mode (gateway-only)`);

const port = parseInt(process.env.PORT || "8080", 10);
const http = await import("http");

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function callApi(action, payload) {
  const res = await fetch(`${API_BASE}/worker-api`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`worker-api ${action} ${res.status}: ${t}`);
  }
  return res.json();
}

http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return;
  }
  if (req.method === "POST" && req.url === "/process") {
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token !== WORKER_SHARED_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" })); return;
    }
    let payload;
    try { payload = await readJson(req); } catch {
      res.writeHead(400); res.end(JSON.stringify({ error: "invalid json" })); return;
    }
    const batchId = payload?.batchId;
    if (!batchId || typeof batchId !== "string") {
      res.writeHead(400); res.end(JSON.stringify({ error: "batchId required" })); return;
    }
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true, batchId }));
    handleBatchById(batchId).catch((e) => console.error("[handle] unexpected", e));
    return;
  }
  res.writeHead(404); res.end("not found");
}).listen(port, () => console.log(`[worker] HTTP server listening on :${port}`));

async function handleBatchById(batchId) {
  console.log(`[worker] received trigger for batch ${batchId}`);
  let claim;
  try { claim = await callApi("claim-batch", { batchId }); }
  catch (e) { console.error("[claim] error", e.message); return; }
  if (!claim.claimed) { console.log(`[worker] batch ${batchId} not in 'queued', skipping`); return; }
  await processBatch(claim.batch, claim.captionLanguage, claim.downloadUrl);
}

async function processBatch(batch, captionLanguage, downloadUrl) {
  const batchId = batch.id;
  const userId = batch.user_id;
  try {
    const rawLang = captionLanguage || "de";
    const targetCode = rawLang === "both" ? "de" : (rawLang === "en" ? "en" : rawLang);
    const targetLangName = LANG_NAMES[targetCode] || "Deutsch";

    console.log(`[batch ${batchId}] downloading ${batch.pdf_path}`);
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error(`download failed: ${dlRes.status}`);
    const fileBuf = Buffer.from(await dlRes.arrayBuffer());
    console.log(`[batch ${batchId}] downloaded ${(fileBuf.length / 1024 / 1024).toFixed(1)} MB`);

    const filename = (batch.source_filename || batch.pdf_path || "").toLowerCase();
    const isPptx = filename.endsWith(".pptx") || filename.endsWith(".ppt");
    if (!isPptx) throw new Error("Only PPTX supported by this worker");

    const { posts, mediaPerPage } = await extractFromPptx(fileBuf, targetLangName, targetCode);
    console.log(`[batch ${batchId}] extracted ${posts.length} posts`);

    for (const p of posts) {
      const media = (mediaPerPage.get(p.pdf_page) || []).map((m) => ({
        base64: m.bytes.toString("base64"),
        ext: m.ext,
        contentType: m.contentType,
      }));
      await callApi("create-post", {
        post: {
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
        },
        media,
      });
    }

    await callApi("finish-batch", { batchId, status: "ready" });
    console.log(`[batch ${batchId}] ✅ done`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[batch ${batchId}] ❌`, msg);
    try { await callApi("finish-batch", { batchId, status: "error", error: msg }); } catch {}
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

  const aiRes = await fetch(`${API_BASE}/ai-extract`, {
    method: "POST",
    headers: authHeaders,
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
