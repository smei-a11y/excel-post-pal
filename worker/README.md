# PPTX Worker — HTTP-Trigger Modus

External worker that processes PPTX uploads triggered via HTTP POST.
Designed for Google Cloud Run / Render / any container host.

## Endpoints

- `GET /` or `GET /health` → `200 ok` (health check)
- `POST /process` with `Authorization: Bearer $WORKER_SHARED_SECRET` and JSON body `{ "batchId": "uuid" }`
  → returns `202 Accepted` immediately, processes in background.

## Required Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `LOVABLE_API_KEY` | Lovable AI Gateway key |
| `WORKER_SHARED_SECRET` | Random string shared with the `trigger-worker` Edge Function |
| `PORT` | (optional) HTTP port, defaults to 8080 |

## Deploy to Google Cloud Run

```bash
gcloud run deploy pptx-worker \
  --source . \
  --region europe-west1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,LOVABLE_API_KEY=...,WORKER_SHARED_SECRET=...
```

After deploy, copy the resulting URL (e.g. `https://pptx-worker-xxx.run.app`)
and add it as the `WORKER_URL` secret on the Lovable Cloud backend, plus the
matching `WORKER_SHARED_SECRET`.

## Deploy to Render

- New → Web Service → Docker
- Root directory: `worker`
- Add the env vars above. `PORT` is provided by Render automatically.

## Local test

```bash
WORKER_SHARED_SECRET=dev SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
LOVABLE_API_KEY=... node index.js

curl -X POST http://localhost:8080/process \
  -H "Authorization: Bearer dev" \
  -H "Content-Type: application/json" \
  -d '{"batchId":"<uuid>"}'
```
