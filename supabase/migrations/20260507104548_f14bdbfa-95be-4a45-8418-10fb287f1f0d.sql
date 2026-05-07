
-- 1. user_id columns
ALTER TABLE public.batches      ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.posts        ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.post_images  ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Reshape app_settings: drop integer PK, switch to user_id PK
DELETE FROM public.app_settings;
ALTER TABLE public.app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE public.app_settings DROP COLUMN IF EXISTS id;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.app_settings ADD PRIMARY KEY (user_id);

-- 3. Drop old permissive policies
DROP POLICY IF EXISTS "public all" ON public.batches;
DROP POLICY IF EXISTS "public all" ON public.posts;
DROP POLICY IF EXISTS "public all" ON public.post_images;
DROP POLICY IF EXISTS "public all" ON public.app_settings;

-- 4. Owner-only policies
CREATE POLICY "own batches" ON public.batches
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own posts" ON public.posts
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own post_images" ON public.post_images
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own app_settings" ON public.app_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Auto-create settings on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_settings (user_id, caption_language)
  VALUES (NEW.id, 'de') ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Storage policies
DROP POLICY IF EXISTS "own pdfs select" ON storage.objects;
DROP POLICY IF EXISTS "own pdfs insert" ON storage.objects;
DROP POLICY IF EXISTS "own pdfs update" ON storage.objects;
DROP POLICY IF EXISTS "own pdfs delete" ON storage.objects;
CREATE POLICY "own pdfs select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'post-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own pdfs insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own pdfs update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'post-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own pdfs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'post-pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "images public read" ON storage.objects;
DROP POLICY IF EXISTS "own images insert" ON storage.objects;
DROP POLICY IF EXISTS "own images update" ON storage.objects;
DROP POLICY IF EXISTS "own images delete" ON storage.objects;
CREATE POLICY "images public read" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'post-images');
CREATE POLICY "own images insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'post-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own images update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'post-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "own images delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'post-images' AND auth.uid()::text = (storage.foldername(name))[1]);
