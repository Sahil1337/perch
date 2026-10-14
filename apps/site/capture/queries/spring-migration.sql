-- First arrivals of spring
select s.common_name, to_char(min(g.seen_at), 'YYYY-MM-DD') as first_seen, sum(g.count) as birds
from sightings g
join species s on s.id = g.species_id
where s.migrant
group by s.common_name
order by first_seen;
