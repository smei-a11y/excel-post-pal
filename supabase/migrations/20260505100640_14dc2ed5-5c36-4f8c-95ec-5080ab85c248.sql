
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_filename text,
  pdf_path text,
  status text not null default 'processing',
  error text,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.batches(id) on delete cascade,
  position int not null default 0,
  focus text,
  format text,
  original_caption text,
  original_cta text,
  translated_caption text,
  translated_cta text,
  hashtags text[] not null default '{}',
  link_url text,
  publish_at timestamptz,
  status text not null default 'scheduled',
  published_at timestamptz,
  webhook_response text,
  created_at timestamptz not null default now()
);

create index posts_publish_at_idx on public.posts(publish_at) where status = 'scheduled';

create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  storage_path text not null,
  public_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key default 1,
  webhook_url text,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into public.app_settings (id) values (1);

alter table public.batches enable row level security;
alter table public.posts enable row level security;
alter table public.post_images enable row level security;
alter table public.app_settings enable row level security;

create policy "public all" on public.batches for all using (true) with check (true);
create policy "public all" on public.posts for all using (true) with check (true);
create policy "public all" on public.post_images for all using (true) with check (true);
create policy "public all" on public.app_settings for all using (true) with check (true);

insert into storage.buckets (id, name, public) values ('post-pdfs','post-pdfs', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('post-images','post-images', true) on conflict do nothing;

create policy "pdf public all" on storage.objects for all using (bucket_id='post-pdfs') with check (bucket_id='post-pdfs');
create policy "img public all" on storage.objects for all using (bucket_id='post-images') with check (bucket_id='post-images');
