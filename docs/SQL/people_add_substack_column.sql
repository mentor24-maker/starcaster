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

alter table public.people
  add column if not exists substack text not null default '';

alter table public.contacts
  add column if not exists substack text null default '';

update public.people
set substack = trim(custom_fields->>'substack'),
    updated_at = now()
where coalesce(substack, '') = ''
  and coalesce(trim(custom_fields->>'substack'), '') <> '';

update public.contacts
set substack = trim(custom_fields->>'substack')
where coalesce(substack, '') = ''
  and coalesce(trim(custom_fields->>'substack'), '') <> '';

-- The source a contact carries when Dane approves a writer the Miner found
-- (slice 4/7). Also seeded in docs/SQL/contacts_options_management_setup.sql
-- for a database set up from scratch.
insert into public.contact_sources (key, label, sort_order) values
  ('substack_miner', 'Substack Miner', 4)
on conflict (key) do nothing;
