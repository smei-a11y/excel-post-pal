import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast, Toaster } from "sonner";
import { Calendar, Upload, Send, Settings as SettingsIcon, Loader2, Trash2, CheckCircle2, AlertCircle, Clock, ImageIcon } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/")({ component: App });

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
type Lang = "de" | "en" | "both";

function App() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [webhook, setWebhook] = useState("");
  const [lang, setLang] = useState<Lang>("de");
  const [liToken, setLiToken] = useState("");
  const [liAuthor, setLiAuthor] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const [b, p, s] = await Promise.all([
      supabase.from("batches").select("*").order("created_at", { ascending: false }),
      supabase.from("posts").select("*, post_images(id, public_url, sort_order)").order("publish_at", { ascending: true }),
      supabase.from("app_settings").select("webhook_url, caption_language, linkedin_access_token, linkedin_author_urn").eq("id", 1).single(),
    ]);
    if (b.data) setBatches(b.data as any);
    if (p.data) setPosts(p.data as any);
    if (s.data?.webhook_url) setWebhook(s.data.webhook_url);
    if ((s.data as any)?.caption_language) setLang((s.data as any).caption_language as Lang);
    if ((s.data as any)?.linkedin_access_token) setLiToken((s.data as any).linkedin_access_token);
    if ((s.data as any)?.linkedin_author_urn) setLiAuthor((s.data as any).linkedin_author_urn);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "batches" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const onUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Bitte eine PDF-Datei hochladen");
      return;
    }
    setUploading(true);
    try {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("post-pdfs").upload(path, file);
      if (upErr) throw upErr;
      const { data: batch, error: bErr } = await supabase.from("batches").insert({
        name: file.name.replace(/\.pdf$/i, ""),
        source_filename: file.name,
        pdf_path: path,
      }).select().single();
      if (bErr) throw bErr;
      toast.success("PDF hochgeladen — KI extrahiert jetzt die Posts...");
      const { error: fnErr } = await supabase.functions.invoke("extract-pdf", { body: { batchId: batch.id } });
      if (fnErr) throw fnErr;
      toast.success("Posts extrahiert und übersetzt!");
      load();
    } catch (e: any) {
      toast.error("Fehler: " + (e?.message || e));
    } finally {
      setUploading(false);
    }
  };

  const saveSettings = async () => {
    const { error } = await supabase.from("app_settings").update({ webhook_url: webhook, caption_language: lang, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) toast.error(error.message);
    else toast.success("Einstellungen gespeichert");
  };

  const publishNow = async (postId: string) => {
    const t = toast.loading("Wird veröffentlicht...");
    const { data, error } = await supabase.functions.invoke("publish-due-posts", { body: { postId } });
    toast.dismiss(t);
    if (error) toast.error(error.message);
    else toast.success("Gesendet: " + JSON.stringify(data?.results?.[0] || {}));
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

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-right" />
      <header className="border-b bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">LinkedIn Content Planer</h1>
            <p className="text-sm text-muted-foreground">PDF hochladen · Automatisch übersetzen · Geplant veröffentlichen</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSettings((s) => !s)}>
            <SettingsIcon /> Einstellungen
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {showSettings && (
          <Card className="p-6 space-y-5">
            <div className="space-y-3">
              <h2 className="font-semibold">Webhook-URL (Make / Zapier / n8n)</h2>
              <p className="text-sm text-muted-foreground">
                Geplante Posts werden zur eingestellten Zeit per POST an diese URL gesendet (mit Text, Hashtags, Bildern, Link).
              </p>
              <Input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.zapier.com/..." />
            </div>
            <div className="space-y-3">
              <h2 className="font-semibold">Caption-Sprache</h2>
              <p className="text-sm text-muted-foreground">Welche Sprache soll im veröffentlichten Post-Text enthalten sein?</p>
              <RadioGroup value={lang} onValueChange={(v) => setLang(v as Lang)} className="flex gap-4">
                <div className="flex items-center gap-2"><RadioGroupItem value="de" id="l-de" /><Label htmlFor="l-de">Deutsch</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="en" id="l-en" /><Label htmlFor="l-en">Englisch</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="both" id="l-both" /><Label htmlFor="l-both">Beide</Label></div>
              </RadioGroup>
            </div>
            <Button onClick={saveSettings}>Speichern</Button>
          </Card>
        )}

        <UploadZone uploading={uploading} onFile={onUpload} />

        {batches.length > 0 && (
          <section>
            <h2 className="font-semibold mb-3">PDF-Uploads</h2>
            <div className="grid gap-2">
              {batches.map((b) => (
                <Card key={b.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={b.status} />
                    <div>
                      <div className="text-sm font-medium">{b.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString("de-DE")} · {b.status}
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
            <h2 className="font-semibold">Geplante Posts ({posts.length})</h2>
          </div>
          {posts.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              Noch keine Posts. Lade eine PDF hoch um zu starten.
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
    </div>
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
          <h3 className="font-medium">Neue Content-PDF hochladen</h3>
          <p className="text-sm text-muted-foreground">KI extrahiert Captions, Datum, Uhrzeit, Hashtags und übersetzt automatisch ins Deutsche.</p>
        </div>
        <label>
          <input type="file" accept="application/pdf" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }} />
          <Button asChild disabled={uploading}><span>{uploading ? "Wird verarbeitet..." : "PDF auswählen"}</span></Button>
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
  const showDe = lang === "de" || lang === "both";
  const showEn = lang === "en" || lang === "both";

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
        <div className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Keine Bilder</div>
      )}

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Caption (DE)</label>
            <Textarea rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">CTA (DE)</label>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Hashtags</label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="BoConcept InteriorDesign" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Veröffentlichen am</label>
            <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Speichern</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Abbrechen</Button>
          </div>
        </div>
      ) : (
        <>
          {showDe && (
            <div className="space-y-1">
              {lang === "both" && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Deutsch</div>}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.translated_caption}</p>
              {post.translated_cta && <p className="text-sm font-medium text-primary">{post.translated_cta}</p>}
            </div>
          )}
          {showEn && (
            <div className="space-y-1">
              {lang === "both" && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">English</div>}
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
          {post.publish_at ? new Date(post.publish_at).toLocaleString("de-DE") : "Kein Datum"}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>Bearbeiten</Button>
          <Button size="sm" variant="outline" onClick={onPublish}><Send /> Jetzt senden</Button>
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
    scheduled: { label: "Geplant", cls: "bg-accent text-accent-foreground" },
    published: { label: "Veröffentlicht", cls: "bg-success text-success-foreground" },
    failed: { label: "Fehler", cls: "bg-destructive text-destructive-foreground" },
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
