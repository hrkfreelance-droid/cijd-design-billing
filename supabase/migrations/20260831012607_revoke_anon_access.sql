-- Anonymous clients are never part of the billing application.
-- RLS already blocks their rows; remove the underlying Data API privileges too.
revoke usage on schema public from anon;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
