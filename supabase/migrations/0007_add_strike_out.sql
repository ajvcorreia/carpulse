-- A separate "excluded" flag from is_removed: is_removed means the ad was
-- taken down on Dubizzle; is_struck_out is for any other reason to set a
-- car aside (wrong spec entered, duplicate, etc.), with a free-text note.

alter table public.cars add column is_struck_out boolean not null default false;
alter table public.cars add column strike_out_reason text;
