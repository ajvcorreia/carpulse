-- Exterior/interior color, same treatment as spec: optional free text.

alter table public.cars add column exterior_color text;
alter table public.cars add column interior_color text;

-- Recreate the view to include the new columns. CREATE OR REPLACE VIEW only
-- allows appending columns at the end (it matches existing ones by
-- position), so the new columns go after price_recorded_at, not inline
-- next to spec where they'd conceptually belong.
create or replace view public.latest_car_prices with (security_invoker = true) as
select distinct on (c.id)
  c.id as car_id,
  c.url,
  c.make,
  c.model,
  c.year,
  c.km,
  c.spec,
  c.ad_placed_at,
  c.created_at,
  ph.price,
  ph.currency,
  ph.recorded_at as price_recorded_at,
  c.exterior_color,
  c.interior_color
from public.cars c
left join public.price_history ph on ph.car_id = c.id
order by c.id, ph.recorded_at desc, ph.created_at desc;
