select f.name as family, count(*) as migrants
from species s
join families f on f.id = s.family_id
where s.migrant
group by f.name
having count(*) > 1
order by migrants desc, family
limit 4;
