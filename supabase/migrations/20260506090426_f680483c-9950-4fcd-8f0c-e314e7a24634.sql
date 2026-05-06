-- Enable scheduling extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if present (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('publish-due-posts-every-minute');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule edge function call every minute
SELECT cron.schedule(
  'publish-due-posts-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kbcqvqfnavkagdngapff.supabase.co/functions/v1/publish-due-posts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);