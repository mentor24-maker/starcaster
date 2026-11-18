## 2026-11-17 — Buttons, pictures and cards can link to a section of a page (#1037)

Yesterday's change (SC-852) let a section have an anchor name ("contact-us")
and let a **menu** link straight to it. Every other link box could still only
send a visitor to the top of a page, so a "Contact us" button couldn't jump
to the Contact section. The feature only half existed.

Now every box that picks a page offers a second list once a page is chosen:
"Top of the page", or one of that page's named sections. That covers Button,
Image, Galaxy, Blog Post Card, Cards, Carousel slides, Breadcrumbs, Headline
Rotator, the event "Back To" link and the sign-in redirects. It also covers
the Link button inside rich text. As with menus, the section is saved by its
permanent id, so renaming its anchor name later never breaks the link.

A few boxes deliberately don't get the choice: a search box's results page,
or a blog list's post page. The module adds the search words or the post's
name onto that address, and a `#section` would break it. Those are listed,
each with its reason, next to the master list of link settings.

A new test opens every module's real settings panel for every link setting
on that master list. It fails if a box should offer sections and doesn't, or
offers them where it mustn't, so the next link box added can't miss it. Two
new browser checks click a Button and read a rich-text link pointed at a
section, and confirm each lands on the section by its current name.
