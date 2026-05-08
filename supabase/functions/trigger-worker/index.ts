// Triggers the external worker (e.g. Cloud Run) via HTTP POST.
// Called from the frontend right after a batch is created.
// Requires secrets: WORKER_URL, WORKER_SHARED_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const WORKER_URL_RAW = Deno.env.get("WORKER_URL");
    const WORKER_SHARED_SECRET = Deno.env.get("WORKER_SHARED_SECRET");
    if (!WORKER_URL_RAW || !WORKER_SHARED_SECRET) {
      return new Response(JSON.stringify({ error: "Worker not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Extract a clean https URL even if pasted with surrounding text/backticks
    const urlMatch = WORKER_URL_RAW.match(/https?:\/\/[^\s`'"<>]+/);
    const WORKER_URL = (urlMatch ? urlMatch[0] : WORKER_URL_RAW).trim().replace(/[`'"]+$/g, "");

    const auth = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { batchId } = await req.json();
    if (!batchId) {
      return new Response(JSON.stringify({ error: "batchId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the batch belongs to the caller (RLS enforces this on select)
    const { data: batch, error } = await supabase
      .from("batches").select("id").eq("id", batchId).maybeSingle();
    if (error || !batch) {
      return new Response(JSON.stringify({ error: "Batch not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget HTTP POST to the worker
    const url = WORKER_URL.replace(/\/$/, "") + "/process";
    const workerRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SHARED_SECRET}`,
      },
      body: JSON.stringify({ batchId }),
    });

    if (!workerRes.ok && workerRes.status !== 202) {
      const t = await workerRes.text();
      console.error("Worker rejected trigger:", workerRes.status, t);
      return new Response(JSON.stringify({ error: `Worker error ${workerRes.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ triggered: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trigger-worker error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
