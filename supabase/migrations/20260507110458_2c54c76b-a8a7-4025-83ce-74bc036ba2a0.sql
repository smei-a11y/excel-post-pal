
ALTER TABLE public.linkedin_oauth_states
  ADD COLUMN IF NOT EXISTS return_url text;
