## 2026-11-12 — Let the weekly report write its folder again: macOS has blocked the Mini's Monday job for four weeks (#1010)

The weekly report is written by a job the Mac Mini runs by itself every Monday
morning. It kept its pages in the Documents folder. Mac privacy protection
treats Documents as private: a job that runs on a timer may drop a file in
there, but it may not look inside to see what is already there. Rebuilding the
list of past reports needs exactly that look, so since 28 September every
Monday wrote that week's page and then stopped — before uploading anything to
Google Drive. Five weeks of reports sat on the Mini and never reached Drive.

The report now lives in a plain folder, `Starcaster/Weekly Reports` in the
home directory, which Mac privacy protection does not guard, so nobody has to
click through a permissions screen. The old pages were copied across (nothing
overwritten, nothing deleted), and a test now fails if the folder is ever moved
back under Documents, Desktop or Downloads. It was checked by running the
report as a real scheduled job on the Mini: it finished cleanly.
