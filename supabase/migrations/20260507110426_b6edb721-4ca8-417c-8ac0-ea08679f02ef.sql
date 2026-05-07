
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS linkedin_refresh_token text,
  ADD COLUMN IF NOT EXISTS linkedin_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS linkedin_refresh_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS linkedin_connected_name text;

CREATE TABLE IF NOT EXISTS public.linkedin_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.linkedin_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own oauth states"
  ON public.linkedin_oauth_states
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
