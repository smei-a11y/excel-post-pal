#!/usr/bin/env bash
# ============================================================
# One-Click Deploy für den PPTX Worker auf Google Cloud Run
# ============================================================
# Voraussetzungen:
#   1. Google Cloud Account + Projekt (kostenlos erstellbar)
#   2. gcloud CLI installiert: https://cloud.google.com/sdk/docs/install
#   3. Eingeloggt: `gcloud auth login`
#
# Nutzung:
#   cd worker
#   ./deploy.sh
#
# Das Skript fragt alles interaktiv ab, was es braucht.
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[i]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

command -v gcloud >/dev/null 2>&1 || error "gcloud CLI nicht gefunden. Installiere: https://cloud.google.com/sdk/docs/install"

# ---- 1. Projekt wählen ---------------------------------------------------
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [ -z "${CURRENT_PROJECT}" ]; then
  warn "Kein Google-Cloud-Projekt aktiv."
  read -rp "Projekt-ID eingeben (z.B. mein-pptx-worker): " PROJECT_ID
  gcloud config set project "$PROJECT_ID"
else
  info "Aktuelles Projekt: ${CURRENT_PROJECT}"
  read -rp "Mit diesem Projekt fortfahren? [Y/n] " yn
  if [[ "$yn" =~ ^[Nn]$ ]]; then
    read -rp "Projekt-ID eingeben: " PROJECT_ID
    gcloud config set project "$PROJECT_ID"
  else
    PROJECT_ID="$CURRENT_PROJECT"
  fi
fi

# ---- 2. Region -----------------------------------------------------------
read -rp "Region [europe-west1]: " REGION
REGION=${REGION:-europe-west1}

# ---- 3. Service-Name -----------------------------------------------------
read -rp "Service-Name [pptx-worker]: " SERVICE
SERVICE=${SERVICE:-pptx-worker}

# ---- 4. Secrets sammeln --------------------------------------------------
info "Jetzt brauche ich deine Secrets. Findest du in Lovable: Backend → Edge Functions → Secrets."
echo
read -rp "SUPABASE_URL (z.B. https://xxx.supabase.co): " SUPABASE_URL
read -rsp "SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY; echo
read -rsp "LOVABLE_API_KEY: " LOVABLE_API_KEY; echo

# Shared Secret automatisch generieren wenn leer
read -rp "WORKER_SHARED_SECRET (leer = automatisch generieren): " WORKER_SHARED_SECRET
if [ -z "$WORKER_SHARED_SECRET" ]; then
  WORKER_SHARED_SECRET=$(openssl rand -hex 32)
  info "Generiert: $WORKER_SHARED_SECRET"
  warn "WICHTIG: Speichere diesen Wert! Du brauchst ihn gleich für Lovable Cloud."
fi

# ---- 5. APIs aktivieren --------------------------------------------------
info "Aktiviere benötigte Google-Cloud-APIs (kann 1–2 Min dauern beim ersten Mal)…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

# ---- 6. Deploy -----------------------------------------------------------
info "Deploye '$SERVICE' nach $REGION (das dauert 3–5 Min)…"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 3 \
  --min-instances 0 \
  --concurrency 1 \
  --allow-unauthenticated \
  --set-env-vars "SUPABASE_URL=${SUPABASE_URL},SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY},LOVABLE_API_KEY=${LOVABLE_API_KEY},WORKER_SHARED_SECRET=${WORKER_SHARED_SECRET}" \
  --project "$PROJECT_ID"

# ---- 7. URL ausgeben -----------------------------------------------------
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)' --project "$PROJECT_ID")

echo
echo "============================================================"
echo -e "${GREEN}✅ Deploy erfolgreich!${NC}"
echo "============================================================"
echo
echo "Worker-URL:           $URL"
echo "Health-Check testen:  curl $URL/health"
echo
echo "------------------------------------------------------------"
echo "JETZT IN LOVABLE CLOUD EINTRAGEN:"
echo "------------------------------------------------------------"
echo "Secret WORKER_URL              = $URL"
echo "Secret WORKER_SHARED_SECRET    = $WORKER_SHARED_SECRET"
echo "============================================================"
