-- Run first, as a separate transaction (Postgres enum values must commit before use).
alter type public.market add value if not exists 'btc';
alter type public.market add value if not exists 'eth';
alter type public.market add value if not exists 'sol';
alter type public.market add value if not exists 'prediction';
