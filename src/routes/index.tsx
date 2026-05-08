import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { Calendar, Upload, Send, Settings as SettingsIcon, Loader2, Trash2, CheckCircle2, AlertCircle, Clock, ImageIcon, LogOut, Copy } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { TusHandle } from "@/lib/tus-upload";

export const Route = createFileRoute("/")({ component: App });

function LinkedInGuideDialog() {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const redirectUri = origin ? `${origin}/linkedin-callback` : "";
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="underline underline-offset-2 hover:text-primary text-left">
          Connect LinkedIn
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect LinkedIn via OAuth</DialogTitle>
          <DialogDescription>
            Step-by-step guide — only needs to be set up once per LinkedIn account.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm">
          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">1. Create a LinkedIn Developer App</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Open the <a className="underline" href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer">LinkedIn Developer Portal</a> and click <em>Create app</em>.</li>
              <li>Fill in the app name, LinkedIn Page (your company page) and logo, and accept the terms.</li>
              <li>Under the <em>Products</em> tab, request <strong>Sign In with LinkedIn using OpenID Connect</strong> and <strong>Share on LinkedIn</strong> (both are granted instantly).</li>
            </ol>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">2. Add redirect URLs</h3>
            <p className="text-muted-foreground">In the <em>Auth</em> tab, under <em>Authorized redirect URLs for your app</em>, add the following URLs (each as a separate entry):</p>
            {[
              "https://www.linkedincontentgenerator.com/linkedin-callback",
              "https://linkedincontentgenerator.com/linkedin-callback",
            ].map((url) => (
              <div key={url} className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
                <span className="flex-1">{url}</span>
                <Button size="icon" variant="ghost" onClick={() => copy(url)}><Copy /></Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Add both entries — the live domain with and without <code>www</code>.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">3. OAuth scopes</h3>
            <p className="text-muted-foreground">The following scopes must be enabled (they are activated automatically through the products from step 1):</p>
            <ul className="list-disc list-inside text-muted-foreground font-mono text-xs">
              <li>openid</li>
              <li>profile</li>
              <li>email</li>
              <li>w_member_social</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">4. Client ID &amp; Client Secret</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>You will find the <strong>Client ID</strong> and <strong>Primary Client Secret</strong> in the <em>Auth</em> tab.</li>
              <li>Both are stored in this app as <code>LINKEDIN_CLIENT_ID</code> and <code>LINKEDIN_CLIENT_SECRET</code>. Update them in the backend settings if they change.</li>
            </ol>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">5. Connect</h3>
            <p className="text-muted-foreground">
              Open <em>Settings</em> at the top right and click <em>Connect with LinkedIn</em>. Sign in to LinkedIn in the new tab and confirm the permissions — your account is then linked.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-foreground">6. Data Security &amp; Privacy</h3>
            <p className="text-muted-foreground">Our app follows industry-standard security practices:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong>Encryption in transit</strong>: All traffic uses HTTPS/TLS.</li>
              <li><strong>Encryption at rest</strong>: Database and file storage are encrypted by our infrastructure providers.</li>
              <li><strong>Strict data isolation</strong>: Row-Level Security policies ensure each user can only access their own data — enforced at the database level, not just in application code.</li>
              <li><strong>Authentication</strong>: Managed via secure session tokens. Passwords are never stored in plain text.</li>
              <li><strong>Secrets management</strong>: API keys and OAuth tokens (e.g. LinkedIn) are stored as encrypted backend secrets, never exposed to the browser.</li>
              <li><strong>EU hosting</strong>: All data is processed and stored in the EU (Frankfurt / Belgium regions), GDPR-compliant.</li>
              <li><strong>Minimal data collection</strong>: We store only what is required to operate the service — your LinkedIn connection, your uploaded presentations, and the generated posts.</li>
              <li><strong>Third-party access</strong>: Files are processed by our own backend worker; no third-party AI provider receives your raw files outside of the LLM call needed to generate captions.</li>
              <li><strong>User control</strong>: You can disconnect your LinkedIn account and delete your data at any time.</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              If you have specific compliance questions (DPA, SOC 2, etc.), please contact us.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DataSecurityDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="underline underline-offset-2 hover:text-primary text-left">
          Data Security &amp; Privacy
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Data Security &amp; Privacy</DialogTitle>
          <DialogDescription>How we protect your data — overview of our security practices.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Our app follows industry-standard security practices, with extra hardening for sensitive credentials:</p>
          <ul className="list-disc list-inside space-y-1">
            <li><strong className="text-foreground">End-to-end encryption in transit</strong>: All traffic uses HTTPS/TLS.</li>
            <li><strong className="text-foreground">Encryption at rest</strong>: Database and file storage are encrypted by our infrastructure providers.</li>
            <li><strong className="text-foreground">Application-level token encryption</strong>: LinkedIn access &amp; refresh tokens are additionally encrypted with AES-GCM using a key that lives only as a backend secret — they are stored as ciphertext in the database, so even someone with direct database access cannot read them.</li>
            <li><strong className="text-foreground">Strict data isolation</strong>: Row-Level Security policies ensure each user can only access their own data — enforced at the database level, not just in application code.</li>
            <li><strong className="text-foreground">Authentication</strong>: Managed via secure session tokens. Passwords are never stored in plain text.</li>
            <li><strong className="text-foreground">Secrets management</strong>: API keys and OAuth secrets are stored as encrypted backend secrets, never exposed to the browser.</li>
            <li><strong className="text-foreground">Tokens never leave the backend</strong>: The frontend only sees your connection name and token expiry — never the actual access or refresh tokens.</li>
            <li><strong className="text-foreground">Worker authentication</strong>: Our processing worker only accepts requests authenticated with a shared secret (Bearer token).</li>
            <li><strong className="text-foreground">EU hosting</strong>: All data is processed and stored in the EU (Frankfurt / Belgium regions), GDPR-compliant.</li>
            <li><strong className="text-foreground">Minimal data collection</strong>: We store only what is required to operate the service — your LinkedIn connection, your uploaded presentations, and the generated posts.</li>
            <li><strong className="text-foreground">Third-party access</strong>: Files are processed by our own backend worker; no third-party AI provider receives your raw files outside of the LLM call needed to generate captions.</li>
            <li><strong className="text-foreground">User control</strong>: You can disconnect your LinkedIn account and delete your data at any time.</li>
          </ul>
          <p className="text-xs">If you have specific compliance questions (DPA, SOC 2, etc.), please contact us.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PostImage = { id: string; public_url: string | null; sort_order: number };
type Post = {
  id: string;
  batch_id: string;
  position: number;
  focus: string | null;
  format: string | null;
  original_caption: string | null;
  original_cta: string | null;
  translated_caption: string | null;
  translated_cta: string | null;
  hashtags: string[];
  link_url: string | null;
  publish_at: string | null;
  status: string;
  published_at: string | null;
  webhook_response: string | null;
  post_images?: PostImage[];
};

type Batch = { id: string; name: string; status: string; error: string | null; created_at: string };
type Lang = string; // ISO code of target language; "en" = original (no translation), "both" = EN + DE

const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English (original)" },
  { code: "de", label: "German" },
  { code: "both", label: "English + German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "bg", label: "Bulgarian" },
  { code: "el", label: "Greek" },
  { code: "hr", label: "Croatian" },
  { code: "sl", label: "Slovenian" },
  { code: "et", label: "Estonian" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "ga", label: "Irish" },
  { code: "mt", label: "Maltese" },
];

function App() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [authReady, setAuthReady] = useState(false);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [lang, setLang] = useState<Lang>("en");
  const [liToken, setLiToken] = useState("");
  const [liAuthor, setLiAuthor] = useState("");
  const [liConnectedName, setLiConnectedName] = useState<string>("");
  const [liExpiresAt, setLiExpiresAt] = useState<string | null>(null);
  const [liConnecting, setLiConnecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadBytes, setUploadBytes] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadPaused, setUploadPaused] = useState(false);
  const [uploadHandle, setUploadHandle] = useState<TusHandle | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Warn before leaving page during an active upload
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  // Auth gate
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        setUserId(null);
        navigate({ to: "/login" });
      } else {
        setUserId(session.user.id);
        setUserEmail(session.user.email || "");
      }
      setAuthReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate({ to: "/login" });
      else {
        setUserId(data.session.user.id);
        setUserEmail(data.session.user.email || "");
      }
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const load = useCallback(async () => {
    if (!userId) return;
    const [b, p, s] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("posts").select("*, post_images(id, public_url, sort_order)").order("publish_at", { ascending: true }),
      supabase.from("app_settings").select("caption_language, linkedin_access_token, linkedin_author_urn, linkedin_connected_name, linkedin_token_expires_at").eq("user_id", userId).maybeSingle(),
    ]);
    if (b.data) setBatches(b.data as any);
    if (p.data) setPosts(p.data as any);
    if (s.data?.caption_language) setLang(s.data.caption_language as Lang);
    if (s.data?.linkedin_access_token) setLiToken(s.data.linkedin_access_token);
    if (s.data?.linkedin_author_urn) setLiAuthor(s.data.linkedin_author_urn);
    setLiConnectedName((s.data as any)?.linkedin_connected_name || "");
    setLiExpiresAt((s.data as any)?.linkedin_token_expires_at || null);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    const ch = supabase
      .channel("rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "batches", filter: `user_id=eq.${userId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, userId]);

  const onUpload = async (file: File) => {
    if (!userId) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pptx")) {
      toast.error("Please upload a PPTX file");
      return;
    }
    const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
    if (file.size > MAX_BYTES) {
      toast.error("File too large — maximum is 1 GB");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    setUploadBytes(0);
    setUploadTotal(file.size);
    setUploadPaused(false);
    try {
      // Stable, deterministic path per file → enables resume after tab reload.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${userId}/${file.size}-${file.lastModified}-${safeName}`;

      // Resumable (TUS) upload — survives token expiry, network drops, reload.
      const { tusUpload } = await import("@/lib/tus-upload");
      await tusUpload({
        file,
        bucket: "post-pdfs",
        path,
        onProgress: (pct, bytes, total) => {
          setUploadPct(pct);
          setUploadBytes(bytes);
          setUploadTotal(total);
        },
        onHandle: (h) => setUploadHandle(h),
      });

      const { data: inserted, error: bErr } = await supabase.from("batches").insert({
        user_id: userId,
        name: file.name.replace(/\.pptx$/i, ""),
        source_filename: file.name,
        pdf_path: path,
        status: "queued",
      }).select().single();
      if (bErr) throw bErr;

      // Trigger the external worker (Cloud Run / Render / etc.) — fire-and-forget
      supabase.functions.invoke("trigger-worker", { body: { batchId: inserted.id } })
        .catch((e) => console.error("trigger-worker error", e));

      toast.success("File uploaded — processing has started.");
      load();

    } catch (e: any) {
      const message = e?.message || String(e);
      toast.error("Upload error: " + message, {
        description: message.includes("Sitzung")
          ? "Logge dich neu ein und wähle danach dieselbe Datei erneut aus."
          : "Pick the same file again to resume from where it stopped.",
        duration: 10000,
      });
    } finally {
      setUploading(false);
      setUploadHandle(null);
      setUploadPaused(false);
    }
  };

  const pauseUpload = () => {
    uploadHandle?.pause();
    setUploadPaused(true);
  };
  const resumeUpload = () => {
    uploadHandle?.resume();
    setUploadPaused(false);
  };
  const cancelUpload = async () => {
    await uploadHandle?.abort(true);
    setUploading(false);
    setUploadHandle(null);
    setUploadPaused(false);
    toast("Upload cancelled");
  };

  const saveSettings = async () => {
    if (!userId) return;
    const { error } = await supabase.from("app_settings").upsert({
      user_id: userId,
      caption_language: lang,
      linkedin_access_token: liToken || null,
      linkedin_author_urn: liAuthor || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) toast.error(error.message);
    else toast.success("Settings saved");
  };

  const publishNow = async (postId: string) => {
    const t = toast.loading("Publishing...");
    const { data, error } = await supabase.functions.invoke("publish-due-posts", { body: { postId } });
    toast.dismiss(t);
    if (error) toast.error(error.message);
    else toast.success("Sent: " + JSON.stringify(data?.results?.[0] || {}));
    load();
  };

  const deletePost = async (id: string) => {
    await supabase.from("posts").delete().eq("id", id);
    load();
  };

  const deleteBatch = async (id: string) => {
    await supabase.from("batches").delete().eq("id", id);
    load();
  };

  const updatePost = async (id: string, patch: Partial<Post>) => {
    const { post_images: _omit, ...rest } = patch as any;
    const { error } = await supabase.from("posts").update(rest).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const connectLinkedIn = async () => {
    setLiConnecting(true);
    try {
      const redirectUri = window.location.origin + "/linkedin-callback";
      const { data, error } = await supabase.functions.invoke("linkedin-oauth-start", {
        body: { redirectUri, returnUrl: window.location.href },
      });
      if (error) throw error;
      if (data?.authUrl) {
        // If the app runs inside an iframe (Lovable preview), open a new tab,
        // otherwise navigate at top level. LinkedIn blocks iframe embedding.
        const inIframe = window.self !== window.top;
        if (inIframe) {
          window.open(data.authUrl, "_blank", "noopener,noreferrer");
          toast.message("LinkedIn opened in a new tab. Come back here after signing in.");
          setLiConnecting(false);
        } else {
          window.location.href = data.authUrl;
        }
      }
    } catch (e: any) {
      toast.error("LinkedIn connection failed: " + (e?.message || e));
      setLiConnecting(false);
    }
  };

  const disconnectLinkedIn = async () => {
    if (!userId) return;
    await supabase.from("app_settings").update({
      linkedin_access_token: null,
      linkedin_refresh_token: null,
      linkedin_token_expires_at: null,
      linkedin_refresh_expires_at: null,
      linkedin_author_urn: null,
      linkedin_connected_name: null,
    }).eq("user_id", userId);
    setLiToken(""); setLiAuthor(""); setLiConnectedName(""); setLiExpiresAt(null);
    toast.success("LinkedIn disconnected");
  };

  if (!authReady || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-right" />
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 sm:px-12 py-6 flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">
              Linkedin · Content Studio
            </div>
            <h1 className="font-serif text-2xl font-normal tracking-tight text-foreground">
              Content Planner
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground hidden sm:inline">
              {userEmail}
            </span>
            <Button variant="outline" size="sm" onClick={() => setShowSettings((s) => !s)}>
              Settings
            </Button>
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 sm:px-12 py-16 sm:py-24 space-y-24">
        {showSettings && (
          <Card className="p-10 space-y-10">
            <div className="space-y-4">
              <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">01 — Connection</div>
              <h2 className="font-serif text-xl">LinkedIn account</h2>
              {liToken && liAuthor ? (
                <div className="border border-border p-6 space-y-3">
                  <div className="text-sm">
                    Connected as <span className="font-medium">{liConnectedName || liAuthor}</span>
                  </div>
                  {liExpiresAt && (
                    <div className="text-xs text-muted-foreground">
                      Token valid until: {new Date(liExpiresAt).toLocaleString("en-US")} (refreshed automatically)
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <Button size="sm" variant="outline" onClick={connectLinkedIn} disabled={liConnecting}>
                      Reconnect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={disconnectLinkedIn}>Disconnect</Button>
                  </div>
                </div>
              ) : (
                <div className="border border-border p-6 space-y-4">
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                    Connect your LinkedIn account via OAuth. Tokens are refreshed automatically.
                  </p>
                  <Button onClick={connectLinkedIn} disabled={liConnecting}>
                    {liConnecting ? <Loader2 className="animate-spin" /> : null}
                    Connect with LinkedIn
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">02 — Language</div>
              <h2 className="font-serif text-xl">Caption language</h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                Target language for the translated posts. Original English captions are always kept.
              </p>
              <Select value={lang} onValueChange={(v) => setLang(v)}>
                <SelectTrigger className="w-full sm:w-72 rounded-none h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Button onClick={saveSettings}>Save settings</Button>
            </div>
          </Card>
        )}

        {/* Hero upload section — centered, generous whitespace */}
        <section className="text-center space-y-10">
          <div className="space-y-6 max-w-2xl mx-auto">
            <h2 className="font-serif text-4xl sm:text-5xl leading-[1.1] tracking-tight text-foreground">
              Upload. Translate. Publish.
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-lg mx-auto">
              A quiet workspace for transforming PPTX content plans into scheduled,
              ready-to-publish LinkedIn posts.
            </p>
          </div>

          <UploadZone
            uploading={uploading}
            onFile={onUpload}
            pct={uploadPct}
            bytes={uploadBytes}
            total={uploadTotal}
            paused={uploadPaused}
            onPause={pauseUpload}
            onResume={resumeUpload}
            onCancel={cancelUpload}
          />
        </section>

        {/* How it works — minimalist numbered list */}
        <section className="space-y-10">
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">The Process</div>
            <h2 className="font-serif text-3xl tracking-tight">How it works</h2>
          </div>
          <ol className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {[
              {
                t: "Connect LinkedIn",
                c: (
                  <>
                    <LinkedInGuideDialog />. Open <em>Settings</em>, click <em>Connect with LinkedIn</em>,
                    sign in and grant permissions.
                  </>
                ),
              },
              { t: "Choose language", c: "In Settings, pick the target language for your published posts." },
              {
                t: "Upload PPTX",
                c: "Drag & drop or pick your content file. The AI extracts captions, images, videos, date, time and hashtags — and translates automatically. This can take a few minutes.",
              },
              { t: "Review & edit", c: "Check each post and adjust text, CTA, hashtags or scheduled time as needed." },
              { t: "Publish", c: "Posts go live automatically at the scheduled time — or instantly with Send now." },
              { t: "Privacy", c: <DataSecurityDialog /> },
            ].map((step, i) => (
              <li key={i} className="space-y-3 border-t border-border pt-6">
                <div className="font-serif text-3xl text-foreground/80">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="text-[11px] uppercase tracking-widest text-foreground">{step.t}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{step.c}</div>
              </li>
            ))}
          </ol>
        </section>

        {batches.length > 0 && (
          <section className="space-y-6">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">Library</div>
              <h2 className="font-serif text-3xl tracking-tight">PPTX uploads</h2>
            </div>
            <div className="grid gap-px bg-border border border-border">
              {batches.map((b) => (
                <div key={b.id} className="px-6 py-5 bg-background flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <StatusIcon status={b.status} />
                    <div>
                      <div className="text-sm font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(b.created_at).toLocaleString("en-US")} · {b.status}
                        {b.error && ` · ${b.error}`}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteBatch(b.id)}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-6">
          <div className="flex items-end justify-between">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">Calendar</div>
              <h2 className="font-serif text-3xl tracking-tight">Scheduled posts</h2>
            </div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </div>
          </div>
          {posts.length === 0 ? (
            <Card className="p-20 text-center text-muted-foreground text-sm">
              No posts yet. Upload a PPTX to get started.
            </Card>
          ) : (
            <div className="grid gap-6">
              {posts.map((p) => (
                <PostCard key={p.id} post={p} lang={lang} onPublish={() => publishNow(p.id)} onDelete={() => deletePost(p.id)} onUpdate={(patch) => updatePost(p.id, patch)} />
              ))}
            </div>
          )}
        </section>
      </main>
      <FeedbackFooter />
    </div>
  );
}

function FeedbackFooter() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!message.trim()) {
      toast.error("Please enter a message");
      return;
    }
    if (message.length > 2000) {
      toast.error("Message too long (max 2000 chars)");
      return;
    }
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Please sign in"); setSending(false); return; }
      const res = await fetch("/lovable/email/transactional/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          templateName: "feedback",
          recipientEmail: "smei@boconcept.de",
          templateData: {
            fromEmail: session.user.email || "anonymous",
            message: message.trim(),
            source: window.location.hostname,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      toast.success("Thanks! Your feedback was sent.");
      setMessage("");
    } catch (e: any) {
      toast.error(e?.message || "Failed to send feedback");
    } finally {
      setSending(false);
    }
  };

  return (
    <footer className="border-t bg-card/40 mt-12">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="space-y-3">
          <h3 className="font-semibold">Send feedback or suggestions</h3>
          <Textarea
            placeholder="Your suggestion or comment..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={2000}
          />
          <Button onClick={submit} disabled={sending}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            {sending ? "Sending..." : "Send feedback"}
          </Button>
        </div>
      </div>
      <div className="border-t py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} LinkedIn Content Planner
      </div>
    </footer>
  );
}

function UploadZone({
  uploading, onFile, pct, bytes, total, paused, onPause, onResume, onCancel,
}: {
  uploading: boolean;
  onFile: (f: File) => void;
  pct: number;
  bytes: number;
  total: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return (
    <div
      className={`relative mx-auto max-w-3xl border border-dashed transition-colors p-16 sm:p-24 text-center bg-background ${
        drag ? "border-foreground bg-foreground/[0.02]" : "border-foreground/30"
      }`}
      onDragOver={(e) => { if (!uploading) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (uploading) return;
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="flex flex-col items-center gap-8">
        <div className="h-px w-12 bg-foreground/40" />
        {uploading ? (
          <Loader2 className="animate-spin h-6 w-6 stroke-1" />
        ) : (
          <Upload className="h-7 w-7 stroke-1" />
        )}

        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-luxury text-muted-foreground">PPTX file</div>
          <h3 className="font-serif text-2xl sm:text-3xl tracking-tight text-foreground">
            Drop your content plan here
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Or select a file manually — captions, images, videos, schedule and hashtags
            are extracted and translated automatically.
          </p>
        </div>

        {uploading ? (
          <div className="w-full max-w-md space-y-4">
            <Progress value={pct} className="h-px rounded-none bg-foreground/10" />
            <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
              <span>{mb(bytes)} / {mb(total)} MB</span>
              <span>{pct.toFixed(1)}%{paused ? " · paused" : ""}</span>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              {paused ? (
                <Button size="sm" variant="outline" onClick={onResume}>Resume</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={onPause}>Pause</Button>
              )}
              <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-2">
              Keep this tab open. Disable sleep / energy-saving mode. LAN is faster than WLAN.
              The upload resumes automatically after short network drops.
            </p>
          </div>
        ) : (
          <label className="pt-2">
            <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
            <Button asChild size="lg"><span>Choose file</span></Button>
          </label>
        )}
      </div>
    </div>
  );
}

function PostCard({ post, lang, onPublish, onDelete, onUpdate }: {
  post: Post; lang: Lang; onPublish: () => void; onDelete: () => void; onUpdate: (patch: Partial<Post>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.translated_caption || "");
  const [cta, setCta] = useState(post.translated_cta || "");
  const [tags, setTags] = useState((post.hashtags || []).join(" "));
  const [publishAt, setPublishAt] = useState(post.publish_at ? toLocalInput(post.publish_at) : "");

  const save = () => {
    onUpdate({
      translated_caption: caption,
      translated_cta: cta,
      hashtags: tags.split(/\s+/).map((t) => t.replace(/^#/, "")).filter(Boolean),
      publish_at: publishAt ? new Date(publishAt).toISOString() : null,
    });
    setEditing(false);
  };

  const images = (post.post_images || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const showTranslated = lang !== "en";
  const showOriginal = lang === "en" || lang === "both";

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">P{post.position}</Badge>
          {post.format && <Badge variant="outline">{post.format}</Badge>}
          <span className="text-sm font-medium">{post.focus}</span>
        </div>
        <StatusBadge status={post.status} />
      </div>

      {images.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((img) => (
            img.public_url ? (
              <img key={img.id} src={img.public_url} alt="" className="h-40 w-auto rounded-md border object-cover" loading="lazy" />
            ) : null
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> No images</div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Translated caption</label>
            <Textarea rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Translated CTA</label>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Hashtags</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="BoConcept InteriorDesign" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Publish at</label>
            <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          {showTranslated && (
            <div className="space-y-1">
              {lang === "both" && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Translated</div>}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.translated_caption}</p>
              {post.translated_cta && <p className="text-sm font-medium text-primary">{post.translated_cta}</p>}
            </div>
          )}
          {showOriginal && (
            <div className="space-y-1">
              {lang === "both" && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Original (English)</div>}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.original_caption}</p>
              {post.original_cta && <p className="text-sm font-medium text-primary">{post.original_cta}</p>}
            </div>
          )}
          {post.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {post.hashtags.map((h) => (
                <span key={h} className="text-xs text-primary">#{h.replace(/^#/, "")}</span>
              ))}
            </div>
          )}
          {post.link_url && <a href={post.link_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline truncate block">{post.link_url}</a>}
        </>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {post.publish_at ? new Date(post.publish_at).toLocaleString("en-US") : "No date"}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>Edit</Button>
          <Button size="sm" variant="outline" onClick={onPublish}><Send /> Send now</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 /></Button>
        </div>
      </div>
      {post.webhook_response && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{post.webhook_response}</div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    scheduled: { label: "Scheduled", cls: "bg-accent text-accent-foreground" },
    published: { label: "Published", cls: "bg-success text-success-foreground" },
    failed: { label: "Failed", cls: "bg-destructive text-destructive-foreground" },
  };
  const m = map[status] || { label: status, cls: "bg-muted" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "ready") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === "error") return <AlertCircle className="h-5 w-5 text-destructive" />;
  if (status === "processing") return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  return <Clock className="h-5 w-5 text-muted-foreground" />;
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}
