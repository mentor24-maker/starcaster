## 2026-11-18 — Forms can't put labels above the boxes or two fields on one row, so imported contact forms (Bayside's) come out a different shape (#1044)

**What was wrong.** Every StarCaster form drew its labels to the left of each
box, one question per row, with no mark on required questions. Most contact
forms on the web look different — label on top, box underneath, First and
Last name side by side, a red asterisk on the required ones. Bayside's
original contact form is exactly that, so when Site Import rebuilt it, it came
out a different shape from the original.

**What changed.**

- A form now has a **Labels** setting: *Beside* (how every existing form
  looks, so nothing already published moves) or *Above*.
- With labels above, each question can be **Full** or **Half** width. Two
  half questions in a row share a line; on a phone (or in a narrow column)
  each takes the whole row again, because two half boxes are too narrow to
  type in there.
- Required questions show an **asterisk** after the label by default; a
  **Required Mark** setting turns it off.
- All three are in the Builder, on the Form module's **Form Appearance**
  column, and are saved on the form itself, so the form looks the same on
  every page it is placed on.
- **Site Import reads them from the original form.** It recognises the
  half-width classes the common form plugins use (WPForms, Gravity Forms,
  Elementor, Divi, Formidable, HubSpot) and the few "labels beside" settings,
  and sets them on the form it builds.
- The import's `--forms-only` pass can now bring a form it **already built**
  up to date, without touching any page. That is how Bayside's form gets the
  new layout once this is live. As before, a form somebody changed by hand in
  Contacts › Forms is left alone and named.

**A trap avoided.** The Contacts › Forms editor is the old (frozen) screen,
and it knows nothing about these new settings: it re-sends every field and
every style it knows on each save. Taken as sent, one save there would have
quietly put every half question back to full and the labels back beside. The
form store now keeps any setting a save does not mention, and a test pins it.

**Checked.** Unit tests for the storage rules, the import reading Bayside's
real form markup (saved as a test fixture), the page rendering, and two
browser checks that measure First and Last really sitting side by side on a
desktop and stacking on a phone.

**After review (same day).** Review sent it back with two real problems,
both fixed:

- On a phone, or in a narrow column, a labels-above form's "Thank you" and
  error banners sat squeezed into the left half of the form beside an empty
  space. They now take the whole row, and a new browser check presses Send at
  phone width and measures the banner against the form.
- The forms-only update could quietly make a brand-new form that no page
  shows (when the import had no record of the form, or the form had been
  deleted) and still report success. It now only updates a form the import
  recorded AND that the page still shows; anything else is skipped and named
  in the run's output, never created.

Also tidied: three half-width questions in a row now pair the first two and
give the third its own row, and two small pieces of duplicated logic now
read from the one shared source.

**Second review (same day).** Two more, both fixed:

- The import decided "labels beside" for a WHOLE form if any one thing in
  it carried a beside class. Ninja Forms puts that class on every lone
  "I agree" checkbox by default, so a normal labels-above Ninja form would
  have been imported as labels beside, and its side-by-side questions would
  have stopped sitting side by side. The import now goes by what most of the
  form's typed-answer questions do, and ignores checkboxes and radio buttons.
- In the Builder's form settings, switching a module to a different form
  within half a second of a change could send the old form's change to the
  new form, or paint the old form's questions over the new one. A waiting
  change now goes straight to the form it was made on, and a late reply for
  a form no longer showing is ignored.
