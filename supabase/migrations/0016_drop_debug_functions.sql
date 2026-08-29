-- Removes the temporary diagnostic functions added while tracking down
-- the client-creation 403 (root cause fixed in 0015). Not meant to be
-- permanent app surface — dropping them now that they've served their
-- purpose.

drop function if exists debug_client_insert_context();
drop function if exists test_create_client(entity_type, text);
