
CREATE INDEX IF NOT EXISTS idx_batches_status_created ON public.batches (status, created_at);

CREATE OR REPLACE FUNCTION public.claim_next_batch()
RETURNS SETOF public.batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.batches
  SET status = 'processing'
  WHERE id = (
    SELECT id FROM public.batches
    WHERE status = 'queued'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_batch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_batch() TO service_role;
