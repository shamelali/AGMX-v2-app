-- Member and chair controls for the hybrid meeting room. The two functions
-- resolve the tenant and the actor from Auth on every request.
create table if not exists public.agm_live_rooms (
  agm_id uuid primary key references public.agms(id) on delete cascade,
  join_url text,
  caption text,
  caption_at timestamptz
);
create table if not exists public.agm_speakers (
  id uuid primary key default gen_random_uuid(),
  agm_id uuid not null references public.agms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  state text not null default 'waiting' check (state in ('waiting', 'called', 'finished')),
  requested_at timestamptz not null default now()
);
create unique index if not exists agm_speakers_one_request on public.agm_speakers(agm_id,user_id)
  where state in ('waiting','called');
create unique index if not exists agm_speakers_one_floor on public.agm_speakers(agm_id)
  where state = 'called';
create index if not exists agm_speakers_queue on public.agm_speakers(agm_id,requested_at,id)
  where state = 'waiting';

alter table public.agm_live_rooms enable row level security;
alter table public.agm_speakers enable row level security;
revoke all on public.agm_live_rooms, public.agm_speakers from public, anon, authenticated;

create or replace function public.agm_floor_state(p_agm uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  meeting public.agms;
  profile public.profiles;
  room public.agm_live_rooms;
begin
  select * into profile from public.profiles where id = auth.uid();
  select * into meeting from public.agms where id = p_agm and organization_id = profile.organization_id;
  if not found then raise exception 'Meeting unavailable' using errcode = '42501'; end if;
  select * into room from public.agm_live_rooms where agm_id = p_agm;
  return jsonb_build_object('title',meeting.title, 'status',meeting.status,
    'operator',lower(profile.role) in ('admin','administrator','secretary'),
    'checkedIn',exists(select 1 from public.attendance a join public.organization_members m
        on m.member_id = a.member_id and m.organization_id = meeting.organization_id
        where m.user_id = profile.id and a.agm_id = p_agm),
    'link',room.join_url, 'caption',room.caption, 'captionAt',room.caption_at,
    'speakers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_name,
      'state',s.state,'mine',s.user_id = profile.id) order by s.requested_at,s.id)
      from public.agm_speakers s where s.agm_id = p_agm and s.state in ('waiting','called')), '[]'::jsonb));
end;
$$;

create or replace function public.update_agm_floor(p_agm uuid, p_action text, p_value text default null, p_speaker uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  meeting public.agms;
  profile public.profiles;
  waiting_id uuid;
begin
  select * into profile from public.profiles where id = auth.uid();
  -- One writer at a time per assembly, including concurrent chair devices.
  select * into meeting from public.agms where id = p_agm and organization_id = profile.organization_id for update;
  if not found then raise exception 'Meeting unavailable' using errcode = '42501'; end if;
  if meeting.status <> 'live' and not (p_action = 'link' and meeting.status = 'planned') then
    raise exception 'The meeting is not live';
  end if;
  if p_action = 'join' then
    if not exists (select 1 from public.attendance a join public.organization_members m
      on m.member_id = a.member_id and m.organization_id = meeting.organization_id
      where m.user_id = profile.id and a.agm_id = p_agm) then
      raise exception 'Check in before requesting the floor' using errcode = '42501';
    end if;
    insert into public.agm_speakers(agm_id,user_id,display_name)
      values (p_agm,profile.id,coalesce(nullif(trim(profile.full_name),''),'Ahli')) on conflict do nothing;
  elsif p_action = 'withdraw' then
    update public.agm_speakers set state = 'finished'
      where agm_id = p_agm and id = p_speaker and user_id = profile.id and state = 'waiting';
  else
    if lower(profile.role) not in ('admin','administrator','secretary') or profile.role is null then
      raise exception 'Operator access required' using errcode = '42501';
    end if;
    case p_action
      when 'call' then
        select id into waiting_id from public.agm_speakers where agm_id = p_agm and state = 'waiting'
          order by requested_at,id limit 1;
        if waiting_id is null or waiting_id is distinct from p_speaker or exists (
          select 1 from public.agm_speakers where agm_id = p_agm and state = 'called'
        ) then raise exception 'The floor has changed. Refresh the room'; end if;
        update public.agm_speakers set state = 'called' where id = waiting_id;
      when 'finish' then
        update public.agm_speakers set state = 'finished' where agm_id = p_agm and id = p_speaker and state = 'called';
      when 'caption' then
        if p_value is null or char_length(p_value) > 500 then raise exception 'Caption must be at most 500 characters'; end if;
        insert into public.agm_live_rooms(agm_id,caption,caption_at) values(p_agm, nullif(trim(p_value),''), now())
          on conflict (agm_id) do update set caption = excluded.caption, caption_at = excluded.caption_at;
      when 'link' then
        if p_value is null or length(p_value) > 2048 or (p_value <> '' and p_value !~*
          '^https://(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com)/[^[:space:][:cntrl:]\\]*$' and p_value !~ '^https://www[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}$')
          then raise exception 'Use a Meet, Zoom, Teams or YouTube Live link'; end if;
        insert into public.agm_live_rooms(agm_id,join_url) values (p_agm,nullif(p_value,''))
          on conflict (agm_id) do update set join_url = excluded.join_url;
      else raise exception 'Unknown floor action';
    end case;
  end if;
  return public.agm_floor_state(p_agm);
end;
$$;
revoke all on function public.agm_floor_state(uuid), public.update_agm_floor(uuid,text,text,uuid) from public, anon;
grant execute on function public.agm_floor_state(uuid), public.update_agm_floor(uuid,text,text,uuid) to authenticated;
