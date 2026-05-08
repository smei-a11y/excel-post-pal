import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function getStorageEndpoint() {
  const url = new URL(SUPABASE_URL);
  if (url.hostname.endsWith(".supabase.co")) {
    url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

function isCompactJwt(token?: string | null) {
  return !!token && token.split(".").length === 3;
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
  // Always validate/refresh before each request. getSession() can return a
  // locally cached token; Storage rejects malformed cached tokens as
  // "Invalid Compact JWS", so we verify the JWT shape and refresh if needed.
  const getFreshToken = async () => {
    let { data, error } = await supabase.auth.getSession();
    let token = data.session?.access_token;
    const expiresSoon = data.session?.expires_at
      ? data.session.expires_at * 1000 - Date.now() < 2 * 60 * 1000
      : false;

    if (error || !isCompactJwt(token) || expiresSoon) {
      const refreshed = await supabase.auth.refreshSession();
      data = refreshed.data;
      error = refreshed.error;
      token = data.session?.access_token;
    }

    if (error || !isCompactJwt(token)) {
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
