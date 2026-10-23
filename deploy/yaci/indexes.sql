-- Indexes the explorer API needs on top of yaci's schema (newest-first lists
-- and per-height lookups). Idempotent; safe to rerun after yaci migrations.
create index if not exists transactions_main_height_idx on api.transactions_main (height desc, id);
