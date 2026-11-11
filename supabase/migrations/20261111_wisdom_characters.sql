-- Migracion: ajustes por personaje de miguelium-wisdom.
-- Ejecutar en el panel SQL de Supabase (misma base que goal-overlay).
-- Solo crea objetos nuevos; no toca tablas ni funciones de goal-overlay.

create table if not exists public.wisdom_characters (
  broadcaster_id text not null,
  "character" text not null check ("character" in ('miguelium', 'ms-rowlet')),
  amount integer not null default 100,
  font text not null default 'Georgia',
  font_size integer not null default 22,
  movement text not null default 'off',
  palette text not null default 'default',
  flip boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (broadcaster_id, "character")
);

-- RPC: lee los ajustes de ambos personajes para un canal.
create or replace function public.wisdom_characters_get(p_broadcaster_id text)
returns table (
  "character" text,
  amount integer,
  font text,
  font_size integer,
  movement text,
  palette text,
  flip boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select "character", amount, font, font_size, movement, palette, flip
  from public.wisdom_characters
  where broadcaster_id = p_broadcaster_id;
$$;

-- RPC: guarda (o actualiza) los ajustes de un personaje de un canal.
create or replace function public.wisdom_characters_save(
  p_broadcaster_id text,
  p_character text,
  p_amount integer,
  p_font text,
  p_font_size integer,
  p_movement text,
  p_palette text,
  p_flip boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.wisdom_characters
    (broadcaster_id, "character", amount, font, font_size, movement, palette, flip, updated_at)
  values
    (p_broadcaster_id, p_character, p_amount, p_font, p_font_size, p_movement, p_palette, p_flip, now())
  on conflict (broadcaster_id, "character") do update set
    amount = excluded.amount,
    font = excluded.font,
    font_size = excluded.font_size,
    movement = excluded.movement,
    palette = excluded.palette,
    flip = excluded.flip,
    updated_at = now();
$$;

grant select, insert, update, delete on public.wisdom_characters to anon, authenticated;
grant execute on function public.wisdom_characters_get(text) to anon, authenticated;
grant execute on function public.wisdom_characters_save(text, text, integer, text, integer, text, text, boolean) to anon, authenticated;
