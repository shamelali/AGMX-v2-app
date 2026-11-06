-- Seed the three AGM service plans. money-flow's POST /quote looks up
-- plans.code and fails with "Invalid plan" when missing.

insert into public.plans (code, name, type, price_oneoff, max_members, features)
values
  ('essential_agm', 'AGMX Essential AGM', 'agm_service', 1500, 500,
   '["Up to 500 members","1 AGM session","Basic e-voting","Digital minutes","Audit trail"]'::jsonb),
  ('professional_agm', 'AGMX Professional AGM', 'agm_service', 3500, 2000,
   '["Up to 2,000 members","Hybrid / online AGM","Full e-voting + hash chain","AI secretary (minutes)","Senior mode","Digital meeting pack","AGM facilitator"]'::jsonb),
  ('enterprise_agm', 'AGMX Enterprise AGM', 'agm_service', 7500, 5000,
   '["5,000+ members","All Professional features","Full AI copilot (4 agents)","GP14/GP14B/UUK compliance","Dedicated project manager","SKM audit report"]'::jsonb)
on conflict (code) do update
  set name = excluded.name,
      type = excluded.type,
      price_oneoff = excluded.price_oneoff,
      max_members = excluded.max_members,
      features = excluded.features;
