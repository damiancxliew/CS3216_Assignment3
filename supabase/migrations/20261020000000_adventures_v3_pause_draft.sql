-- Guided generation (#226): only validated teacher changesets are stored.
alter table adventures_v3 add column pause_draft jsonb;
comment on column adventures_v3.pause_draft is 'Guided mode: { pass, edits } saved at a pause while status is needs_review; cleared on continue.';
