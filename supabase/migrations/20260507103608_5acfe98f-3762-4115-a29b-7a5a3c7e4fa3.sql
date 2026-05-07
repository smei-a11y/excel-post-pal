ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS linkedin_access_token text,
  ADD COLUMN IF NOT EXISTS linkedin_author_urn text;