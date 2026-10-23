-- Brokie · US30 (Micro Dow, MYM): $0.50 a point, 1-point ticks, OANDA US30_USD.
-- Live since 23 Oct 2026. Rerunnable. Run the two statements separately
-- (a new enum value can't be used in the same transaction that adds it).

alter type market add value if not exists 'us30';

insert into markets (id, point_value, tick_size, instrument)
values ('us30', 0.5, 1, 'US30_USD')
on conflict (id) do update
  set point_value = excluded.point_value, tick_size = excluded.tick_size, instrument = excluded.instrument;

-- Prices start once the ingest function asks OANDA for US30_USD
-- (backend/deploy/smart-action.ts or backend/deploy/ingest-quotes.ts).
