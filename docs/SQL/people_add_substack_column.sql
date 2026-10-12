-- people_add_substack_column.sql
-- Substack Miner 1/7 (Loop Queue task 86bcfprx5): a proper Substack address on
-- every contact, and a contact source for writers the Substack Miner finds.
--
-- Until now a contact's Substack lived only in custom_fields->>'substack',
-- because there was no column for it. This adds one beside youtube, x and
-- bluesky, and copies the custom field into it where the column is blank.
--
-- The custom field is LEFT IN PLACE: nothing here deletes it, and the server
-- reads the column first and the custom field second (lib/ContactsStore.js
-- rowToContact, routes/contacts.js segmentFieldValue), so a contact this has
-- not reached still shows its Substack.
--
-- contacts gets the column too, for the same reason it carries every other
-- social column: the store writes to contacts directly where the people table
-- is absent (lib/ContactsStore.js), and a write naming a column the table does
-- not have is refused outright.
--
-- The copy touches every contact row that has the custom field, and only fills
-- a blank column; it never overwrites a value already there.
--
-- Idempotent: running it twice changes nothing.

-- Every step is guarded, because databases differ: PRODUCTION HAS NO `people`
-- TABLE (found 2026-10-12, when the unguarded version failed there with
-- "relation public.people does not exist" and rolled back whole). Contacts
-- live in `contacts` alone, which lib/ContactsStore.js already handles. A step
-- whose table or column is absent is skipped, not failed.

do $$
begin
  if to_regclass('public.people') is not null then
    alter table public.people
      add column if not exists substack text not null default '';
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'people'
                 and column_name = 'custom_fields') then
      update public.people
      set substack = trim(custom_fields->>'substack'),
          updated_at = now()
      where coalesce(substack, '') = ''
        and coalesce(trim(custom_fields->>'substack'), '') <> '';
    end if;
  end if;

  if to_regclass('public.contacts') is not null then
    alter table public.contacts
      add column if not exists substack text null default '';
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'contacts'
                 and column_name = 'custom_fields') then
      update public.contacts
      set substack = trim(custom_fields->>'substack')
      where coalesce(substack, '') = ''
        and coalesce(trim(custom_fields->>'substack'), '') <> '';
    end if;
  end if;
end $$;

-- The source a contact carries when Dane approves a writer the Miner found
-- (slice 4/7). Also seeded in docs/SQL/contacts_options_management_setup.sql
-- for a database set up from scratch.
do $$
begin
  if to_regclass('public.contact_sources') is not null then
    insert into public.contact_sources (key, label, sort_order) values
      ('substack_miner', 'Substack Miner', 4)
    on conflict (key) do nothing;
  end if;
end $$;
