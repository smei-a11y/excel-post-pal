// Streaming PPTX worker — handles huge files (>1GB) without OOM.
// Strategy:
//   1. Download PPTX to /tmp via stream (no full buffer in RAM)
//   2. Open ZIP with yauzl (only reads central directory ~KB)
//   3. First pass: extract slide text + media entry references (no bytes loaded)
//   4. Call AI with text only
//   5. Second pass: stream each media entry one at a time, base64, POST, release
import { createWriteStream, createReadStream, promises as fsp } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { tmpdir } from "os";
import path from "path";
import http from "http";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { open as openZip } from "yauzl-promise";

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm"]);

// Compress a video file with ffmpeg. Returns the output file path (always mp4).
async function compressVideo(inputPath) {
  const outPath = path.join(tmpdir(), `vid-${randomUUID()}.mp4`);
  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => { err += d.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`));
    });
  });
  return outPath;
}

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

console.log(`[worker] starting — streaming mode (yauzl)`);

const port = parseInt(process.env.PORT || "8080", 10);

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

// Mutex: at most 1 batch in flight per instance (matches Cloud Run concurrency=1)
let busy = false;

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
}).listen(port, "0.0.0.0", () => console.log(`[worker] HTTP server listening on 0.0.0.0:${port}`));

async function handleBatchById(batchId) {
  console.log(`[worker] received trigger for batch ${batchId}`);
  if (busy) { console.log(`[worker] busy, skipping trigger for ${batchId}`); return; }
  busy = true;
  try {
    const claim = await callApi("claim-batch", { batchId });
    if (!claim.claimed) { console.log(`[worker] batch ${batchId} not in 'queued', skipping`); return; }
    await processBatch(claim.batch, claim.captionLanguage, claim.downloadUrl);
  } catch (e) {
    console.error("[handle] error", e.message);
  } finally {
    busy = false;
  }
}

// Polling loop: every 30s, claim the next queued batch (race-safe via SQL lock).
// Catches batches missed by the HTTP trigger (cold start, redeploy, instance scaled to 0).
const POLL_INTERVAL_MS = 30_000;
async function pollOnce() {
  if (busy) return;
  busy = true;
  try {
    const claim = await callApi("claim-next", {});
    if (!claim.claimed) return;
    console.log(`[poll] picked up batch ${claim.batch.id}`);
    await processBatch(claim.batch, claim.captionLanguage, claim.downloadUrl);
  } catch (e) {
    console.error("[poll] error", e.message);
  } finally {
    busy = false;
  }
}
setInterval(() => { pollOnce().catch((e) => console.error("[poll] unexpected", e)); }, POLL_INTERVAL_MS);
// Kick off first poll shortly after boot
setTimeout(() => { pollOnce().catch(() => {}); }, 3000);

async function streamToFile(url, filePath) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const nodeStream = Readable.fromWeb(res.body);
  await pipeline(nodeStream, createWriteStream(filePath));
}

async function readEntryToBuffer(entry) {
  const stream = await entry.openReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function readEntryToString(entry) {
  return (await readEntryToBuffer(entry)).toString("utf8");
}

async function processBatch(batch, captionLanguage, downloadUrl) {
  const batchId = batch.id;
  const userId = batch.user_id;
  const tmpFile = path.join(tmpdir(), `pptx-${batchId}.pptx`);
  let zip = null;
  try {
    const rawLang = captionLanguage || "de";
    const targetCode = rawLang === "both" ? "de" : (rawLang === "en" ? "en" : rawLang);
    const targetLangName = LANG_NAMES[targetCode] || "Deutsch";

    console.log(`[batch ${batchId}] streaming download → ${tmpFile}`);
    await streamToFile(downloadUrl, tmpFile);
    const stat = await fsp.stat(tmpFile);
    console.log(`[batch ${batchId}] downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

    const filename = (batch.source_filename || batch.pdf_path || "").toLowerCase();
    if (!(filename.endsWith(".pptx") || filename.endsWith(".ppt"))) {
      throw new Error("Only PPTX supported by this worker");
    }

    // Pass 1: index ZIP entries
    zip = await openZip(tmpFile);
    /** @type {Map<string, import("yauzl-promise").Entry>} */
    const entries = new Map();
    for await (const entry of zip) {
      if (entry.filename.endsWith("/")) continue;
      entries.set(entry.filename, entry);
    }

    // Collect slide XMLs (text only)
    const slideNames = [...entries.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => slideNum(a) - slideNum(b));

    /** @type {Array<{idx:number,text:string,mediaPaths:string[]}>} */
    const slides = [];
    for (let i = 0; i < slideNames.length; i++) {
      const slidePath = slideNames[i];
      const xml = await readEntryToString(entries.get(slidePath));
      const text = extractTextFromSlideXml(xml);

      const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
      const mediaPaths = [];
      const relsEntry = entries.get(relsPath);
      if (relsEntry) {
        const relsXml = await readEntryToString(relsEntry);
        const targets = [...relsXml.matchAll(/Target="([^"]+)"/g)].map((m) => m[1]);
        const seen = new Set();
        for (const t of targets) {
          const resolved = resolvePath("ppt/slides/" + slidePath.split("/").pop(), t);
          if (!resolved.startsWith("ppt/media/")) continue;
          if (seen.has(resolved)) continue;
          seen.add(resolved);
          if (entries.has(resolved)) mediaPaths.push(resolved);
        }
      }
      slides.push({ idx: i + 1, text, mediaPaths });
    }
    console.log(`[batch ${batchId}] indexed ${slides.length} slides`);

    // Build doc text for AI (no bytes loaded yet)
    const doc = slides.map((s) => {
      const exts = s.mediaPaths.map((p) => (p.split(".").pop() || "").toLowerCase());
      const hasVideo = exts.some((e) => ["mp4", "mov", "m4v", "webm"].includes(e));
      const fmtHint = hasVideo
        ? "(slide contains a VIDEO)"
        : s.mediaPaths.length > 1 ? "(slide contains multiple images — likely CAROUSEL)"
        : s.mediaPaths.length === 1 ? "(slide contains a single image)" : "(no media)";
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
    console.log(`[batch ${batchId}] AI returned ${args.posts.length} posts`);

    // Pass 2: per post, stream-upload media one at a time (no base64, no buffer)
    for (const p of args.posts) {
      const slide = slides.find((s) => s.idx === p.pdf_page);

      // 1. Create post (without media)
      const createRes = await callApi("create-post", {
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
        media: [],
      });
      const postId = createRes.postId;

      // 2. For each media: presign → stream PUT to storage → register
      if (slide) {
        let i = 0;
        for (const mPath of slide.mediaPaths) {
          const ext = (mPath.split(".").pop() || "").toLowerCase();
          const ct = mimeFromExt(ext);
          if (!ct) continue;
          const entry = entries.get(mPath);
          if (!entry) continue;

          const presign = await callApi("presign-upload", {
            userId, batchId, postId, index: i, ext,
          });

          const stream = await entry.openReadStream();
          const size = entry.uncompressedSize;
          console.log(`[batch ${batchId}] uploading ${mPath} (${(size / 1024 / 1024).toFixed(1)} MB) → ${presign.path}`);

          const upRes = await fetch(presign.uploadUrl, {
            method: "PUT",
            headers: {
              "content-type": ct,
              "content-length": String(size),
              "x-upsert": "true",
            },
            body: Readable.toWeb(stream),
            duplex: "half",
          });
          if (!upRes.ok) {
            const t = await upRes.text().catch(() => "");
            throw new Error(`storage upload failed ${upRes.status}: ${t}`);
          }

          await callApi("register-media", {
            userId, postId,
            path: presign.path,
            publicUrl: presign.publicUrl,
            sortOrder: i,
          });
          i++;
        }
      }
    }

    await callApi("finish-batch", { batchId, status: "ready" });
    console.log(`[batch ${batchId}] ✅ done`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[batch ${batchId}] ❌`, msg);
    try { await callApi("finish-batch", { batchId, status: "error", error: msg }); } catch {}
  } finally {
    if (zip) { try { await zip.close(); } catch {} }
    try { await fsp.unlink(tmpFile); } catch {}
  }
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
