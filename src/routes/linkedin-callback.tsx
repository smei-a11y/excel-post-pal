import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/linkedin-callback")({
  component: LinkedInCallback,
});

function LinkedInCallback() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("LinkedIn-Verbindung wird abgeschlossen...");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDesc = url.searchParams.get("error_description");
      if (error) {
        setMsg(`LinkedIn-Fehler: ${error} ${errorDesc || ""}`);
        return;
      }
      if (!code || !state) {
        setMsg("Ungültige Rückkehr von LinkedIn (code/state fehlt).");
        return;
      }
      const redirectUri = window.location.origin + "/linkedin-callback";
      const { data, error: fnErr } = await supabase.functions.invoke("linkedin-oauth-callback", {
        body: { code, state, redirectUri },
      });
      if (fnErr) {
        setMsg("Fehler: " + fnErr.message);
        return;
      }
      setMsg("LinkedIn verbunden! Weiterleitung...");
      setTimeout(() => navigate({ to: "/" }), 800);
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="animate-spin" />
        <span>{msg}</span>
      </div>
    </div>
  );
}
