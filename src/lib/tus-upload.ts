import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

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
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) throw new Error("Not authenticated");

  // Always fetch a fresh token per request — supabase auto-refreshes sessions,
  // and large uploads can outlive the 1h token lifetime.
  const getFreshToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  };

  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      // Long retry window — survives WLAN drops, sleep, brief offline periods.
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000, 60000, 60000, 60000],
      headers: {
        authorization: `Bearer ${sessionData.session!.access_token}`,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
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
      onShouldRetry: () => true,
      onBeforeRequest: async (req) => {
        const t = await getFreshToken();
        if (t) req.setHeader("authorization", `Bearer ${t}`);
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
