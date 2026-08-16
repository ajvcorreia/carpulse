-- Favorite flag, toggled inline from the dashboard and sortable there.

alter table public.cars add column is_favorite boolean not null default false;
