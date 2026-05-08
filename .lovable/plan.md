## Ziel
Worker-Code aus GitHub im Cloud Shell holen und nach Cloud Run deployen — mit den bereits implementierten Änderungen (Stream-Upload + Polling-Loop).

## Schritte im Cloud Shell

### 1. Repo klonen
```bash
cd ~
git clone https://github.com/<DEIN-GH-USER>/<DEIN-REPO>.git
cd <DEIN-REPO>/worker
```
Den Repo-Pfad findest du in Lovable: Plus (+) Menü → GitHub → der Link zum verbundenen Repo.

### 2. Project & Region setzen
```bash
gcloud config set project project-b149e95e-3855-42c1-b8a
gcloud config set run/region europe-west1
```

### 3. Artifact Registry vorbereiten (einmalig)
Falls das Repository `pptx-worker` noch nicht existiert:
```bash
gcloud artifacts repositories create pptx-worker \
  --repository-format=docker \
  --location=europe-west1 \
  --description="PPTX Worker images"
```
Falls schon existiert → Fehler ignorieren.

### 4. Build (aus dem `worker/` Verzeichnis!)
```bash
gcloud builds submit \
  --tag europe-west1-docker.pkg.dev/project-b149e95e-3855-42c1-b8a/pptx-worker/pptx-worker:latest \
  .
```
Wichtig: der Punkt `.` am Ende und du musst im `worker/` Ordner stehen (sonst „Dockerfile required").

### 5. Deploy mit Polling-Konfiguration
```bash
gcloud run deploy pptx-worker \
  --image europe-west1-docker.pkg.dev/project-b149e95e-3855-42c1-b8a/pptx-worker/pptx-worker:latest \
  --region europe-west1 \
  --memory 4Gi --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --no-cpu-throttling \
  --min-instances 1 --max-instances 3 \
  --allow-unauthenticated
```

### 6. Env Vars prüfen
Falls Env Vars beim Deploy verloren gehen, neu setzen:
```bash
gcloud run services update pptx-worker --region europe-west1 \
  --set-env-vars SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=...,LOVABLE_API_KEY=...,WORKER_SHARED_SECRET=...
```
(Werte aus deinem bisherigen Deployment.)

### 7. Verifikation
```bash
# Health-Check
curl https://pptx-worker-XXX.run.app/health

# Logs ansehen — nach ~30s sollte „pollOnce" auftauchen
gcloud run services logs read pptx-worker --region europe-west1 --limit 50
```
Erwartung: Polling-Loop startet, claimt den stuck Batch `684fc124…` und verarbeitet ihn.

## Häufige Stolpersteine
- **„Dockerfile required"** → du bist nicht in `worker/`. `pwd` checken, dann `cd worker`.
- **„Image not found"** beim Deploy → Build ist fehlgeschlagen. Logs vom Build prüfen: `gcloud builds list --limit 3`.
- **Worker startet, polled aber nicht** → `min-instances` ist 0. Mit Schritt 5 nochmal deployen.
- **„permission denied" auf Artifact Registry** → einmalig `gcloud auth configure-docker europe-west1-docker.pkg.dev` ausführen.
