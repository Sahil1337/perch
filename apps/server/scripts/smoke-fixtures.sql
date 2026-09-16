-- Tables smoke.sh asserts against. Load into an empty database before running it.
-- Two statuses on purpose: the group-by assertion checks the plural "N rows ·" footer.
create table orders (
  id bigserial primary key,
  customer_id bigint,
  status text,
  total_cents bigint,
  created_at timestamptz default now()
);
insert into orders (customer_id, status, total_cents)
  select g, case when g % 5 = 0 then 'cancelled' else 'paid' end, g * 10
  from generate_series(1, 50) g;
create table customers (id bigserial primary key);
