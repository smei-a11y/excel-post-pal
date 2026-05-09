import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function DataSecurityDialog({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={className ?? "underline underline-offset-2 hover:text-primary text-left"}>
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
