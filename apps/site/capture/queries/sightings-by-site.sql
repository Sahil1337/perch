-- Birds counted at each site
select t.name, sum(g.count) as birds
from sightings g
join checklists c on g.checklist_id = c.id
join sites t on c.site_id = t.id
group by t.name
order by birds desc;
