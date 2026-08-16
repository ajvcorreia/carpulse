-- Number of cylinders, same treatment as km: optional integer.

alter table public.cars add column cylinders integer check (cylinders is null or cylinders between 1 and 16);
