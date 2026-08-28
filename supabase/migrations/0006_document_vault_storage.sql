-- Document Vault storage. Private bucket — every object requires a signed
-- URL to read, and RLS on storage.objects gates both upload and signed-URL
-- issuance the same way the `documents` table itself is gated: by whether
-- the caller can_access_client() the client_id encoded in the object path.
--
-- Path convention: <client_id>/<category>/<timestamp>-<filename>
-- e.g. 22222222-.../financials/1735000000-Audited_BS_FY26.pdf

insert into storage.buckets (id, name, public)
values ('client-documents', 'client-documents', false)
on conflict (id) do nothing;

-- storage.objects.name is the full object path; split_part(..., '/', 1)
-- pulls out the leading client_id segment to check against can_access_client().

-- Postgres doesn't guarantee policy conditions short-circuit in the order
-- written, so an inline ::uuid cast on every row in the bucket (not just
-- ones matching our path convention) could throw on a malformed path.
-- This helper absorbs that instead of letting a bad object break RLS
-- evaluation for every other row.
create or replace function storage_path_client_id(object_name text)
returns uuid as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$ language plpgsql immutable;

create policy "client_documents_select" on storage.objects
  for select
  using (
    bucket_id = 'client-documents'
    and can_access_client(storage_path_client_id(name))
  );

create policy "client_documents_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'client-documents'
    and can_access_client(storage_path_client_id(name))
  );

-- Deletion is intentionally restricted to Admin/Partner/Audit Manager,
-- narrower than the general can_access_client() read/write check — an
-- Article Assistant who can upload documents shouldn't also be able to
-- remove them from the vault.
create policy "client_documents_delete" on storage.objects
  for delete
  using (
    bucket_id = 'client-documents'
    and can_access_client(storage_path_client_id(name))
    and current_staff_role() in ('admin', 'partner', 'audit_manager')
  );
