-- Delivery point photo storage
-- Run once in Supabase SQL Editor before using the photo upload UI.
-- Photos are stored only in delivery_points.photos; memo remains plain operator text.

alter table public.delivery_points
  add column if not exists photos jsonb not null default '[]'::jsonb;

comment on column public.delivery_points.photos is
  'Delivery point photos managed separately from memo. Array of up to 6 compressed image metadata/data URLs.';

-- Migrate photos written by older frontend versions from memo into photos.
-- A malformed legacy payload is retained in memo and reported as a warning instead of being deleted.
do $$
declare
  row_data record;
  marker constant text := '<!--dp-photos:';
  marker_position integer;
  marker_end_position integer;
  after_marker text;
  encoded_photos text;
  decoded_photos jsonb;
  clean_memo text;
begin
  for row_data in
    select id, memo, photos
    from public.delivery_points
    where memo like '%<!--dp-photos:%'
  loop
    begin
      marker_position := strpos(row_data.memo, marker);
      after_marker := substr(row_data.memo, marker_position + length(marker));
      marker_end_position := strpos(after_marker, '-->');

      if marker_end_position = 0 then
        raise warning 'delivery_points % has an unterminated legacy photo marker', row_data.id;
        continue;
      end if;

      encoded_photos := btrim(substr(after_marker, 1, marker_end_position - 1));
      decoded_photos := convert_from(decode(encoded_photos, 'base64'), 'UTF8')::jsonb;

      if jsonb_typeof(decoded_photos) <> 'array' then
        raise warning 'delivery_points % legacy photo payload is not an array', row_data.id;
        continue;
      end if;

      select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
      into decoded_photos
      from jsonb_array_elements(decoded_photos) with ordinality as item(value, ordinality)
      where item.ordinality <= 6;

      clean_memo := btrim(
        substr(row_data.memo, 1, marker_position - 1)
        || substr(after_marker, marker_end_position + 3)
      );

      update public.delivery_points
      set photos = case
            when row_data.photos is null or row_data.photos = '[]'::jsonb then decoded_photos
            else row_data.photos
          end,
          memo = nullif(clean_memo, '')
      where id = row_data.id;
    exception when others then
      raise warning 'delivery_points % legacy photo migration failed: %', row_data.id, sqlerrm;
    end;
  end loop;
end
$$;

update public.delivery_points
set photos = '[]'::jsonb
where photos is null
   or jsonb_typeof(photos) is distinct from 'array';

update public.delivery_points as dp
set photos = (
  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb) as photos
  from jsonb_array_elements(dp.photos) with ordinality as item(value, ordinality)
  where item.ordinality <= 6
)
where jsonb_array_length(dp.photos) > 6;

alter table public.delivery_points
  drop constraint if exists delivery_points_photos_array_check;

alter table public.delivery_points
  add constraint delivery_points_photos_array_check
  check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 6);

-- Ask PostgREST to refresh its schema cache immediately.
notify pgrst, 'reload schema';

-- Verification: both counts should be zero after a successful migration.
select
  count(*) filter (where memo like '%<!--dp-photos:%') as legacy_memo_rows,
  count(*) filter (where jsonb_typeof(photos) <> 'array' or jsonb_array_length(photos) > 6) as invalid_photo_rows
from public.delivery_points;

select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'delivery_points'
  and column_name = 'photos';
