## Problem

1. **Race-Condition** — Worker reagiert nur auf POST `/process`. Trifft der Trigger den Worker während Cold-Start/Redeploy, bleibt der Batch auf `queued` hängen.
2. **Worker crasht bei großen Medien** — `buf.toString("base64")` + JSON-Body sprengt das V8-Stringlimit (~512 MB). Genau das hat Batch `684fc124…` auf `error` gesetzt.

## Lösung

### Teil A — Direct-Upload für große Medien (Option 1)

Statt jedes Medium als base64 in einem JSON-Body zur `worker-api` zu schicken, lädt der Worker das Medium direkt in den Storage hoch. Worker bekommt dafür eine **signed upload URL** und streamt den Zip-Eintrag direkt rein — nie als String im RAM.

**`worker-api` neue Actions:**
- `presign-upload` → input `{ userId, batchId, postId, index, ext }` → erzeugt mit `createSignedUploadUrl` einen Upload-Link für `post-images` Bucket, gibt `{ uploadUrl, token, path, publicUrl }` zurück
- `register-media` → input `{ userId, postId, path, publicUrl, sortOrder }` → fügt Eintrag in `post_images` ein (gleiche Felder wie heute)

**`worker/index.js` Änderungen:**
- `create-post` wird ohne `media`-Array aufgerufen → bekommt nur die `postId`
- Pro Medium: `presign-upload` → `entry.openReadStream()` per `fetch PUT uploadUrl` direkt hochladen → `register-media`
- Existierender `readEntryToBuffer` + `toString("base64")` Code wird entfernt

**Effekt:** Auch 1-GB-Videos laufen ohne RAM-Spitze durch. Storage-Pfade und `post_images`-Einträge bleiben identisch zu heute, Frontend sieht keinen Unterschied.

### Teil B — Polling-Loop im Worker

**`worker-api` neue Action `claim-next`:**
- Ruft die existierende `claim_next_batch()` SQL-Funktion auf (race-safe via `FOR UPDATE SKIP LOCKED`)
- Antwort identisch zu `claim-batch`: `{ claimed, batch, captionLanguage, downloadUrl }`

**`worker/index.js` Änderungen:**
- Beim Boot Polling-Loop starten: alle 30 s `claim-next` aufrufen
- Wenn ein Batch zurückkommt → `processBatch` damit starten
- Mutex-Flag damit nicht zwei parallele Loops/HTTP-Trigger denselben Worker doppelt belasten (max. 1 Batch gleichzeitig pro Instanz, passt zu Cloud Run `concurrency=1`)
- HTTP-`/process`-Endpoint bleibt unverändert (schneller Pfad)

### Teil C — Hängenden Batch reparieren

Batch `684fc124-4ace-4574-b379-709cd3b1b6fd` per Migration von `error` zurück auf `queued` setzen und `error`-Feld leeren — der Polling-Loop greift ihn nach dem Worker-Update automatisch ab (jetzt mit Direct-Upload für das große Video).

## Was du als User danach machen musst

Worker neu bauen + deployen (gleicher Befehl wie letztes Mal, einziger Unterschied: `--min-instances 1` statt `0`, sonst skaliert Cloud Run nach Inaktivität auf null und niemand pollt):

```bash
cd worker
gcloud builds submit --tag europe-west1-docker.pkg.dev/PROJECT_ID/pptx-worker/pptx-worker:latest .
gcloud run deploy pptx-worker \
  --image europe-west1-docker.pkg.dev/PROJECT_ID/pptx-worker/pptx-worker:latest \
  --region europe-west1 --memory 4Gi --cpu 2 --timeout 3600 \
  --concurrency 1 --no-cpu-throttling \
  --min-instances 1 --max-instances 3 \
  --allow-unauthenticated
```

Innerhalb von 30 s greift sich der Worker den hängenden Batch automatisch.

## Geänderte Dateien

- `worker/index.js` — Polling-Loop + Stream-Upload statt base64
- `supabase/functions/worker-api/index.ts` — neue Actions `claim-next`, `presign-upload`, `register-media`
- Migration: Reset von Batch `684fc124…` auf `queued`

**NICHT geändert:** Frontend, DB-Schema, `trigger-worker` Edge Function, Storage-Bucket-Struktur.

## Risiken

- `createSignedUploadUrl` ist seit `@supabase/supabase-js` v2.16 verfügbar → ok
- `min-instances=1` kostet ein paar Cent/Monat fixe Idle-CPU — notwendig fürs Polling
