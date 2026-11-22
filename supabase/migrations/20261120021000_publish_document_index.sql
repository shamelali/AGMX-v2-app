-- Publish one complete index for a registered document. Readers retain the old
-- passages if parsing, embedding or any part of the replacement fails.
create or replace function public.publish_document_index(p_document uuid, p_job uuid, p_chunks jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  tenant uuid;
  filename text;
  started timestamptz;
  piece jsonb;
  chunk_id uuid;
  count_chunks integer := 0;
begin
  select d.organization_id, d.filename into tenant, filename from public.documents d where id = p_document for update;
  select j.created_at into started from public.knowledge_jobs j
    where j.id = p_job and j.document_id = p_document and j.organization_id = tenant and j.status = 'processing';
  if not found then raise exception 'Index job is not active'; end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) not between 1 and 200 then
    raise exception 'A document must contain 1 to 200 passages';
  end if;
  if exists (select 1 from public.knowledge_jobs j where j.document_id = p_document
    and j.status = 'completed' and (j.created_at, j.id) > (started, p_job)) then
    raise exception 'A newer index is already published';
  end if;

  delete from public.knowledge_chunks where document_id = p_document and organization_id = tenant;
  for piece in select value from jsonb_array_elements(p_chunks) loop
    insert into public.knowledge_chunks(organization_id,document_id,job_id,chunk_index,title,content,page,token_count,embedding,metadata)
    values (tenant,p_document,p_job,count_chunks,filename,piece->>'text',(piece->>'page')::integer,
      ceil(char_length(piece->>'text') / 4.0)::integer,
      (jsonb_populate_record(null::public.knowledge_chunks,jsonb_build_object('embedding',piece->'embedding'))).embedding,
      jsonb_build_object('model',piece->>'model'))
    returning id into chunk_id;
    insert into public.knowledge_assertions(organization_id,document_id,chunk_id,subject,predicate,object,quote,confidence)
      select tenant,p_document,chunk_id,a.subject,a.predicate,a.object,a.quote,a.confidence
      from jsonb_to_recordset(piece->'assertions') as a(subject text,predicate text,object text,quote text,confidence numeric);
    count_chunks := count_chunks + 1;
  end loop;
  update public.knowledge_jobs set status='completed', total_chunks=count_chunks,
    processed_chunks=count_chunks, completed_at=now(), updated_at=now() where id=p_job;
end;
$$;
revoke all on function public.publish_document_index(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.publish_document_index(uuid,uuid,jsonb) to service_role;

-- A retry after an interrupted Storage upload can register the same immutable
-- file again. Serialise these registrations without rewriting older records.
create or replace function public.register_document(
  p_org uuid, p_agm_id uuid, p_category text, p_filename text, p_mime text,
  p_size_bytes bigint, p_storage_path text, p_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  registered uuid;
begin
  if p_sha256 is not null and p_storage_path like p_org::text || '/vault/%' then
    perform pg_advisory_xact_lock(hashtextextended(p_storage_path, 0));
    select id into registered from public.documents
      where organization_id=p_org and storage_path=p_storage_path and agm_id is not distinct from p_agm_id
        and category=p_category and filename=p_filename and sha256=p_sha256 order by created_at,id limit 1;
    if found then return jsonb_build_object('id', registered); end if;
  end if;
  insert into public.documents(organization_id,agm_id,category,filename,mime,size_bytes,storage_path,sha256)
    values(p_org,p_agm_id,p_category,p_filename,p_mime,p_size_bytes,p_storage_path,p_sha256)
    returning id into registered;
  return jsonb_build_object('id', registered);
end;
$$;
revoke all on function public.register_document(uuid,uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.register_document(uuid,uuid,text,text,text,bigint,text,text) to service_role;
