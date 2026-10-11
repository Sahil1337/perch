select count(*) as checklists, count(distinct observer_id) as observers from checklists;
-- %%
select o.name, count(*) as checklists from checklists c join observers o on o.id = c.observer_id
group by o.name order by checklists desc limit 3;
-- %%
select extract(hour from seen_at) as hour, count(*) as sightings from sightings
group by hour order by sightings desc limit 3;
