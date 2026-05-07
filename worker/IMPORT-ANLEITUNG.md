# 🚀 Google Cloud Run — Import ohne Terminal

Diese Anleitung deployt den Worker komplett über die **Browser-Oberfläche**. Kein gcloud-CLI nötig.

---

## Schritt 1 — Google-Cloud-Projekt erstellen (3 Min)

1. Gehe zu https://console.cloud.google.com
2. Oben links auf den Projekt-Dropdown → **„Neues Projekt"**
3. Name: z.B. `pptx-worker` → **Erstellen**
4. Warte ~30 Sek bis es bereit ist, dann oben das neue Projekt auswählen

> 💳 **Abrechnungskonto:** Cloud Run verlangt eine hinterlegte Kreditkarte, auch wenn du im Free-Tier bleibst. Folge dem Prompt „Abrechnung aktivieren".

---

## Schritt 2 — Cloud Shell öffnen (kein Install nötig)

Oben rechts in der Console auf das **`>_` Icon** klicken → Cloud Shell startet im Browser.

Im Cloud Shell folgende Befehle ausführen (Code aus diesem Repo holen + Image bauen):

```bash
# Repo aus Lovable klonen — entweder per GitHub-Connect oder ZIP hochladen
# (Im Cloud Shell oben rechts: ⋮ → Datei hochladen → worker.zip)
unzip worker.zip && cd worker

# Image bauen (dauert 3-5 Min beim ersten Mal)
gcloud builds submit --tag gcr.io/$(gcloud config get-value project)/pptx-worker

# Image-URL merken — sie sieht so aus:
# gcr.io/dein-projekt-id/pptx-worker
```

---

## Schritt 3 — `service.yaml` vorbereiten

Öffne `worker/service.yaml` und ersetze die **4 Platzhalter**:

| Platzhalter | Was eintragen |
|---|---|
| `REPLACE_ME_IMAGE_URL` | Die Image-URL aus Schritt 2 (z.B. `gcr.io/pptx-worker-123/pptx-worker`) |
| `REPLACE_ME_SERVICE_ROLE_KEY` | Lovable → **Cloud → Secrets** → `SUPABASE_SERVICE_ROLE_KEY` |
| `REPLACE_ME_LOVABLE_API_KEY` | Lovable → **Cloud → Secrets** → `LOVABLE_API_KEY` |
| `REPLACE_ME_GENERATE_RANDOM_64_CHARS` | Im Cloud Shell: `openssl rand -hex 32` ausführen, Output kopieren |

> ⚠️ **Den letzten Wert (WORKER_SHARED_SECRET) merken!** Du brauchst ihn gleich für Lovable.

---

## Schritt 4 — Service in Cloud Run importieren

1. Gehe zu https://console.cloud.google.com/run
2. Oben **„Dienst erstellen"** klicken
3. Tab **„Container, Volumes, Netzwerk, Sicherheit"** → ganz unten **„YAML bearbeiten"** auswählen
4. Den Inhalt deiner bearbeiteten `service.yaml` reinkopieren
5. **Region:** `europe-west1` (Belgien) empfohlen
6. **Authentifizierung:** „Nicht authentifizierte Aufrufe zulassen" ✅
7. **Erstellen** klicken

Nach ~1 Min siehst du oben die **Service-URL**, z.B.:
```
https://pptx-worker-abc123-ew.a.run.app
```

---

## Schritt 5 — Test

Im Cloud Shell oder Browser öffnen:
```
https://DEINE-URL.run.app/health
```

Erwartete Antwort: `{"status":"ok"}`

---

## Schritt 6 — Lovable Cloud konfigurieren

Sag mir die beiden Werte, dann lege ich die Secrets in Lovable an:

- **`WORKER_URL`** = die Service-URL aus Schritt 4
- **`WORKER_SHARED_SECRET`** = der zufällige Wert aus Schritt 3

---

## Updates später

Wenn ich am Worker-Code etwas ändere:
```bash
cd worker
gcloud builds submit --tag gcr.io/$(gcloud config get-value project)/pptx-worker
gcloud run deploy pptx-worker --image gcr.io/$(gcloud config get-value project)/pptx-worker --region europe-west1
```

---

## Kosten-Check

Free-Tier reicht für ~150 PPTX/Monat (à 5 Min Verarbeitung).
Setze in **Cloud Run → Service → ⋮ → Budget-Alert** auf z.B. 5€/Monat als Sicherheit.
