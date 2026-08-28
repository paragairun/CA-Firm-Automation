-- Local dev seed data. Not for production use.
-- Note: auth_user_id on staff is left null here — link it after creating
-- auth users locally (supabase auth admin) and running an update.

insert into firms (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Demo & Associates, Chartered Accountants');

insert into staff (firm_id, name, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'Aditi Rao', 'aditi@democa.in', 'partner'),
  ('11111111-1111-1111-1111-111111111111', 'Vikram Shah', 'vikram@democa.in', 'audit_manager'),
  ('11111111-1111-1111-1111-111111111111', 'Neha Kulkarni', 'neha@democa.in', 'article_assistant');

insert into clients (id, firm_id, entity_type, legal_name, gstins, status) values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111',
   'pvt_ltd', 'ABC Manufacturing Pvt Ltd', array['27AAAAA0000A1Z5'], 'active'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'llp', 'XYZ Consultants LLP', array['27BBBBB0000B1Z5'], 'active');

insert into tally_sync_configs (client_id, firm_id, tally_company_name, sync_frequency, last_sync_status) values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111',
   'ABC Manufacturing (FY 2026-27)', 'daily', 'never_synced'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'XYZ Consultants (FY 2026-27)', 'daily', 'never_synced');

insert into filings (client_id, firm_id, filing_type, period, status, due_date) values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111',
   'gstr3b', '2026-07', 'filed', '2026-08-20'),
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111',
   'tds_26q', '2026-Q1', 'under_review', '2026-08-31'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'gstr3b', '2026-07', 'pending', '2026-08-20');
