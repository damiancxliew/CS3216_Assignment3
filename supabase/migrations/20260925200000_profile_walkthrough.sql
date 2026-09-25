alter table profile
  add column walkthrough_mobile_completed boolean not null default false,
  add column walkthrough_desktop_completed boolean not null default false;
