-- Adventure-level cover key art joins the generatable asset kinds.
alter table asset drop constraint if exists asset_kind_check;
alter table asset add constraint asset_kind_check check (kind in ('portrait', 'landmark', 'prop', 'sprite', 'cover'));
