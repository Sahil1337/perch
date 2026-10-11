-- Which sites turned up the most species?
select t.name, t.habitat, count(distinct g.species_id) as species, sum(g.count) as birds
from sites t
join checklists c on c.site_id = t.id
join sightings g on g.checklist_id = c.id
group by t.id
order by species desc;
