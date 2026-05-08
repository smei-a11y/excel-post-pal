import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
) as string;

function getStorageEndpoint() {
  const url = new URL(SUPABASE_URL);
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

function decodeJwtPayload(token: string): { aud?: unknown; exp?: unknown; role?: unknown; sub?: unknown } | null {
  try {
    const payload = token.split(".")[1];
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function normalizeSupabaseJwt(token?: string | null) {
  let normalized = token?.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/^Bearer\s+/i, "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized)) return null;

  const payload = decodeJwtPayload(normalized);
  const expiresAt = typeof payload?.exp === "number" ? payload.exp * 1000 : 0;
  const isSupabaseUserToken = payload?.aud === "authenticated" && payload?.role === "authenticated" && typeof payload?.sub === "string";

  if (!isSupabaseUserToken || expiresAt - Date.now() < 2 * 60 * 1000) return null;
  return normalized;
}

export type TusHandle = {
  pause: () => void;
  resume: () => void;
  abort: (shouldTerminate?: boolean) => Promise<void>;
};

export async function tusUpload({
  file,
  bucket,
  path,
  onProgress,
  onHandle,
}: {
  file: File;
  bucket: string;
  path: string;
  onProgress?: (pct: number, bytesUploaded: number, bytesTotal: number) => void;
  onHandle?: (h: TusHandle) => void;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Upload-Konfiguration fehlt. Bitte Seite neu laden und erneut versuchen.");
  }

  // Always validate/refresh before each request. getSession() can return a
  // locally cached token; Storage rejects malformed cached tokens as
  // "Invalid Compact JWS", so we normalize the token and verify it is an
  // authenticated Supabase user JWT before sending it to Storage.
  const getFreshToken = async () => {
    let { data, error } = await supabase.auth.getSession();
    let token = normalizeSupabaseJwt(data.session?.access_token);

    if (error || !token) {
      const refreshed = await supabase.auth.refreshSession();
      data = refreshed.data;
      error = refreshed.error;
      token = normalizeSupabaseJwt(data.session?.access_token);
    }

    if (error || !token) {
      await supabase.auth.signOut({ scope: "local" });
      throw new Error("Deine Sitzung ist abgelaufen. Bitte einmal neu einloggen und denselben Upload erneut starten.");
    }

    return token;
  };

  const initialToken = await getFreshToken();

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: getStorageEndpoint(),
      // Long retry window — survives WLAN drops, sleep, brief offline periods.
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000, 60000, 60000, 60000],
      headers: {
        Authorization: `Bearer ${initialToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-upsert": "true",
      },
      // Do not send the first 6 MB together with the upload-creation request.
      // If that POST response is lost, tus-js-client has no upload URL yet and
      // retries by sending the same first chunk again. Creating the TUS upload
      // first, then PATCHing chunks, lets retries/HEAD resume from the real offset.
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      // Stable fingerprint per (bucket, path, file) — enables resume after reload.
      fingerprint: async () =>
        `tus-${bucket}-${path}-${file.size}-${file.lastModified}`,
      chunkSize: 6 * 1024 * 1024,
      onShouldRetry: (err, retryAttempt) => {
        const status = err?.originalResponse?.getStatus?.();
        if (status && status >= 400 && status < 500 && ![409, 423, 429].includes(status)) {
          return false;
        }
        return retryAttempt < 9;
      },
      onBeforeRequest: async (req) => {
        const t = await getFreshToken();
        req.setHeader("Authorization", `Bearer ${t}`);
        req.setHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
      },
      onError: (err) => reject(err),
      onProgress: (bytesUploaded, bytesTotal) => {
        if (onProgress)
          onProgress((bytesUploaded / bytesTotal) * 100, bytesUploaded, bytesTotal);
      },
      onSuccess: () => resolve(),
    });

    onHandle?.({
      pause: () => { upload.abort(false); },
      resume: () => { upload.start(); },
      abort: (shouldTerminate = true) => upload.abort(shouldTerminate),
    });

    // Resume previous upload for the same (file, path) if any.
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}
