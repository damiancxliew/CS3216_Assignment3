-- Each stage has its own full-scene illustration, separate from map fixtures.
alter table asset drop constraint if exists asset_kind_check;
alter table asset add constraint asset_kind_check
  check (kind in ('portrait', 'landmark', 'prop', 'sprite', 'cover', 'cutscene'));

-- What moves and sounds in each opening painting, read once from the image.
-- The cache keeps it too, so a cached painting is not read again.
alter table asset add column if not exists scene jsonb;
alter table asset_cache add column if not exists scene jsonb;
