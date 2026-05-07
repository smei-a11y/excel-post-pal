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
  const [showSettings, setShowSettings] = useState(false);

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
    try {
      const path = `${userId}/${crypto.randomUUID()}-${file.name}`;

      // Resumable (TUS) upload — works for very large files (up to 1 GB here)
      const { tusUpload } = await import("@/lib/tus-upload");
      await tusUpload({ file, bucket: "post-pdfs", path });

      const { error: bErr } = await supabase.from("batches").insert({
        user_id: userId,
        name: file.name.replace(/\.pptx$/i, ""),
        source_filename: file.name,
        pdf_path: path,
        status: "queued",
      });
      if (bErr) throw bErr;

      toast.success("File uploaded — the worker will pick it up within a few seconds.");
      load();
    } catch (e: any) {
      toast.error("Upload error: " + (e?.message || e));
    } finally {
      setUploading(false);
    }
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
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">LinkedIn Content Planner</h1>
            <p className="text-sm text-muted-foreground">Upload PPTX · Auto-translate · Schedule and publish</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">{userEmail}</span>
            <Button variant="outline" size="sm" onClick={() => setShowSettings((s) => !s)}>
              <SettingsIcon /> Settings
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {showSettings && (
          <Card className="p-6 space-y-5">
            <div className="space-y-3">
              <h2 className="font-semibold">LinkedIn connection</h2>
              {liToken && liAuthor ? (
                <div className="rounded-md border p-4 space-y-2">
                  <div className="text-sm">
                    Connected as <span className="font-medium">{liConnectedName || liAuthor}</span>
                  </div>
                  {liExpiresAt && (
                    <div className="text-xs text-muted-foreground">
                      Token valid until: {new Date(liExpiresAt).toLocaleString("en-US")} (refreshed automatically)
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={connectLinkedIn} disabled={liConnecting}>
                      Reconnect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={disconnectLinkedIn}>Disconnect</Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border p-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Connect your LinkedIn account via OAuth. Tokens are refreshed automatically.
                  </p>
                  <Button onClick={connectLinkedIn} disabled={liConnecting}>
                    {liConnecting ? <Loader2 className="animate-spin" /> : null}
                    Connect with LinkedIn
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <h2 className="font-semibold">Caption language</h2>
              <p className="text-sm text-muted-foreground">Target language for the translated posts (the original English captions are always kept).</p>
              <Select value={lang} onValueChange={(v) => setLang(v)}>
                <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={saveSettings}>Save</Button>
          </Card>
        )}

        <Card className="p-6 bg-accent/30 border-dashed">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">?</span>
            How it works
          </h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
            <li>
              <span className="text-foreground font-medium">
                <LinkedInGuideDialog />:
              </span>{" "}
              Open <em>Settings</em> at the top right and click <em>Connect with LinkedIn</em>. Sign in in the new tab and grant the permissions.
            </li>
            <li><span className="text-foreground font-medium">Choose caption language:</span> In Settings, pick the target language for your published posts.</li>
            <li><span className="text-foreground font-medium">Upload PPTX:</span> Drag &amp; drop or pick your content file (SharePoint → B2B Marketing Tools) below. The AI extracts captions, images, videos, date, time and hashtags and translates automatically. <span className="font-bold text-foreground">This can take a few minutes depending on the size of your PPTX file and the conversion into ready-to-publish posts. Sit back and relax — there's nothing else for you to do!</span></li>
            <li><span className="text-foreground font-medium">Review &amp; edit posts:</span> Check each post below and adjust text, CTA, hashtags or scheduled time if needed.</li>
            <li><span className="text-foreground font-medium">Publish:</span> Posts go live automatically at the scheduled time — or instantly with <em>Send now</em>.</li>
          </ol>
        </Card>

        <UploadZone uploading={uploading} onFile={onUpload} />

        {batches.length > 0 && (
          <section>
            <h2 className="font-semibold mb-3">PPTX uploads</h2>
            <div className="grid gap-2">
              {batches.map((b) => (
                <Card key={b.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={b.status} />
                    <div>
                      <div className="text-sm font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString("en-US")} · {b.status}
                        {b.error && ` · ${b.error}`}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteBatch(b.id)}><Trash2 /></Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Scheduled posts ({posts.length})</h2>
          </div>
          {posts.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              No posts yet. Upload a PPTX to get started.
            </Card>
          ) : (
            <div className="grid gap-4">
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

function UploadZone({ uploading, onFile }: { uploading: boolean; onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <Card
      className={`p-10 border-2 border-dashed transition-colors text-center ${drag ? "border-primary bg-accent/40" : "border-border"}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
        </div>
        <div>
          <h3 className="font-medium">Upload a new content plan (PPTX)</h3>
          <p className="text-sm text-muted-foreground">AI extracts captions, images, videos, date, time and hashtags and translates automatically.</p>
        </div>
        <label>
          <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
          <Button asChild disabled={uploading}><span>{uploading ? "Processing..." : "Choose file"}</span></Button>
        </label>
      </div>
    </Card>
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
