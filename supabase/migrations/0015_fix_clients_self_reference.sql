-- Root cause of the client-creation 403, confirmed via direct SQL
-- testing: clients_select called can_access_client(id), which — for the
-- admin/partner/audit_manager branch — re-queries the clients table
-- itself to confirm the row's firm_id. That's a self-referential
-- subquery against the exact table being inserted into, evaluated
-- within the same INSERT...RETURNING statement. The freshly-inserted
-- row isn't reliably visible to that subquery yet at that point, even
-- though the same check against an already-committed row works fine
-- (verified directly: a bare INSERT with no RETURNING succeeded, and
-- can_access_client() against a committed test row returned true —
-- the failure is specific to checking a row against itself, mid-insert).
--
-- Fix: clients' own SELECT/UPDATE policies no longer call
-- can_access_client() at all. The admin/partner/audit_manager case
-- needs no subquery whatsoever — firm_id = current_firm_id(), already
-- checked directly against the row's own column, *is* the complete
-- rule for those roles. The article_assistant case is inlined directly
-- against client_staff_assignments/staff instead, which was never the
-- problem (no self-reference to clients there).
--
-- can_access_client() itself is untouched — it's still correct and
-- necessary for every OTHER table (documents, filings, tasks, ...)
-- that references a client_id, since those check a different,
-- already-committed clients row, not the row being written in the
-- current statement.

drop policy if exists clients_select on clients;
create policy clients_select on clients for select
  using (
    firm_id = current_firm_id()
    and (
      current_staff_role() in ('admin', 'partner', 'audit_manager')
      or exists (
        select 1 from client_staff_assignments a
        join staff s on s.id = a.staff_id
        where a.client_id = clients.id and s.auth_user_id = auth.uid()
      )
    )
  );

drop policy if exists clients_update on clients;
create policy clients_update on clients for update
  using (
    firm_id = current_firm_id()
    and (
      current_staff_role() in ('admin', 'partner', 'audit_manager')
      or exists (
        select 1 from client_staff_assignments a
        join staff s on s.id = a.staff_id
        where a.client_id = clients.id and s.auth_user_id = auth.uid()
      )
    )
  )
  with check (firm_id = current_firm_id());
