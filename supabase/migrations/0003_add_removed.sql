-- Mark a car as removed from Dubizzle (delisted) without deleting its
-- tracked price history. Appended at the end of latest_car_prices'
-- column list — CREATE OR REPLACE VIEW only allows appending, not
-- inserting columns mid-list (see 0002's comment on the same gotcha).

alter table public.cars add column is_removed boolean not null default false;

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
  c.interior_color,
  c.is_removed
from public.cars c
left join public.price_history ph on ph.car_id = c.id
order by c.id, ph.recorded_at desc, ph.created_at desc;
