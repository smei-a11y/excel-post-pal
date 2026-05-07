# PPTX Worker (Render)

External background worker that processes large PPTX uploads.
Polls the `batches` table for `status='queued'` rows, downloads the file from
Supabase Storage, extracts text + media, calls Lovable AI, and writes posts.

## Deploy on Render (5 minutes)

1. Push this repo to GitHub (the `worker/` folder must be included).
2. Go to <https://render.com> → **New** → **Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - **Root Directory**: `worker`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Standard (2 GB RAM) or Pro (4 GB RAM) for files up to 1 GB
5. **Environment Variables** (add under "Environment"):
   - `SUPABASE_URL` → your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` → service role key (server-side only!)
   - `LOVABLE_API_KEY` → from Lovable Cloud
   - `POLL_INTERVAL_MS` → `5000` (optional, default 5s)
6. Click **Create Web Service**. Render will build, start, and keep it running.

## Logs

Watch live logs in the Render dashboard. You should see:
```
[worker] starting — polling every 5000ms
[worker] health server on :10000
```

When a user uploads a PPTX, you'll see:
```
[worker] picked batch <uuid> (filename.pptx)
[batch <uuid>] downloaded 650.0 MB
[batch <uuid>] extracted 12 posts
[batch <uuid>] ✅ done
```

## Local test

```
cd worker
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LOVABLE_API_KEY=... npm install && npm start
```
