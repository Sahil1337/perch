-- Red List species, most recent first
select s.common_name, s.status, t.name as site, g.count, to_char(g.seen_at, 'YYYY-MM-DD') as seen_on
from sightings g
join species s on s.id = g.species_id
join checklists c on c.id = g.checklist_id
join sites t on t.id = c.site_id
where s.status <> 'LC'
order by g.seen_at desc;
