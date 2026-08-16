-- Tracks when a car's listing link was last opened, so the dashboard can
-- highlight "the one you were just looking at" via a server round-trip
-- instead of client-side cross-tab storage (cookies/localStorage turned out
-- not to be reliably shared across tabs in at least one mobile browser).

alter table public.cars add column last_opened_at timestamptz;
