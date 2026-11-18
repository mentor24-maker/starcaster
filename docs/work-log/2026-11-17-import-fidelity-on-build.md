## 2026-11-17 — The import difference report only runs if someone remembers: Building an import should produce it and the Imports screen should show it (#1035)

When we copy a client's existing website into StarCaster, a "difference report" puts each part of the original beside our copy and lists what was lost. Dane's rule is that every difference becomes a ticket for a missing feature. But the report only ran if an agent session remembered to run it, and Bayside went live without one, so five differences went unfiled until Dane asked about it.

Now pressing **Build Draft Pages** makes the report every time, as the final step. The Imports screen shows a link to it and how many things each category lost, for example "Text styling 4". Any page it could not check is named as CANNOT TELL, so a gap is never shown as a clean result. If the report could not be made at all, the screen says why. It does not file tickets by itself. The report is the list to file from.

To take its pictures on the Mac Mini without starting the full app (which would run background jobs against the live database), the report starts a small server that only hands out page files.
