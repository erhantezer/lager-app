-- Supabase SQL Editor'da çalıştırın.
create table public.allowed_users (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('admin','member'))
);
create table public.items (
 id uuid primary key default gen_random_uuid(),
 name text not null, sku text unique, category text not null default '',
 location text not null default '', description text not null default '',
 quantity integer not null default 0 check(quantity>=0),
 image_path text, created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.stock_movements (
 id bigint generated always as identity primary key,
 item_id uuid references public.items(id) on delete cascade not null,
 delta integer not null, note text not null default '',
 user_id uuid references auth.users(id), created_at timestamptz not null default now()
);
alter table public.allowed_users enable row level security;
alter table public.items enable row level security;
alter table public.stock_movements enable row level security;
-- Tüm veri erişimi sunucu tarafında kimlik ve izin kontrolüyle yapılır.
-- Service-role anahtarı ASLA tarayıcıya verilmemelidir.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('item-images','item-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create or replace function public.change_stock(p_item_id uuid,p_delta integer,p_note text,p_user_id uuid)
returns integer language plpgsql security invoker as $$
declare new_quantity integer;
begin
 update public.items set quantity=quantity+p_delta
 where id=p_item_id and quantity+p_delta>=0
 returning quantity into new_quantity;
 if not found then raise exception 'Ürün bulunamadı veya stok yetersiz';end if;
 insert into public.stock_movements(item_id,delta,note,user_id) values(p_item_id,p_delta,p_note,p_user_id);
 return new_quantity;
end;$$;
revoke execute on function public.change_stock(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.change_stock(uuid,integer,text,uuid) to service_role;
