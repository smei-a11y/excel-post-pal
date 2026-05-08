# Upload-Stabilität für große Dateien (bis 1 GB)

## Ursachen für Abbruch bei 650 MB
1. **Token läuft ab** — `tus-upload.ts` setzt den Bearer-Token einmal vor dem Start. Bei langsamer Leitung (>1 h) → 401 mitten im Upload.
2. **Kein Resume nach Reload** — Pfad enthält `crypto.randomUUID()`, TUS-Fingerprint ändert sich jedes Mal.
3. **Kurze Retry-Fenster** — WLAN-Drop >20 s = Abbruch.
4. **Kein Pause/Resume in der UI**, kein echter Fortschritt, keine Warnung beim Verlassen der Seite.

## Änderungen

### 1. `src/lib/tus-upload.ts` — robust machen
- `onBeforeRequest`: vor jedem Chunk frischen `access_token` aus `supabase.auth.getSession()` holen → übersteht Token-Ablauf nach 1 h.
- Längere `retryDelays` (bis 60 s, mehrere Versuche) + `onShouldRetry: () => true`.
- Stabiler `fingerprint` aus `bucket+path+size+lastModified` und `storeFingerprintForResuming: true` → Resume nach Tab-Reload möglich.
- `findPreviousUploads()` + `resumeFromPreviousUpload()` beim Start.
- Neuer Callback `onHandle({ pause, resume, abort })` und erweiterter `onProgress(pct, bytesUploaded, bytesTotal)`.

### 2. `src/routes/index.tsx` — UI/UX
- **Stabiler Pfad pro Datei**: deterministisch aus `userId + name + size + lastModified` (kein UUID mehr) → Resume nach Reload klappt für dieselbe Datei.
- **State**: `uploadPct`, `uploadBytes`, `uploadTotal`, `uploadHandle`, `uploadPaused`.
- **Fortschrittsbalken** (Progress-Komponente) mit MB / MB + Prozent.
- **Buttons** Pause / Fortsetzen / Abbrechen sichtbar während Upload.
- **`beforeunload`-Warnung** während aktivem Upload.
- **Fehler-Toast** mit „Erneut versuchen" (ruft `onUpload(file)` nochmal auf, TUS resumed automatisch).
- Kurzer Hinweistext: „Tab offen lassen, Energiesparmodus aus, LAN bevorzugt."

### 3. Keine Backend-Änderungen
- Bucket erlaubt schon 1 GB, Upload geht direkt Browser → Storage (kein Edge-Function-Timeout-Problem).
- Keine DB-Migration nötig.

## Ergebnis
- Übersteht 1 h-Token-Ablauf, längere Netzwerk-Drops, Tab-Reload.
- Sichtbarer Fortschritt, manuelles Pausieren/Fortsetzen.
- Bei Fehler einfach Datei nochmal wählen → wird ab letztem Chunk fortgesetzt.
