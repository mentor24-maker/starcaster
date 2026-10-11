/**
 * Per-host redirects for addresses that existed on a tenant's PREVIOUS site.
 *
 * Why this file exists: public Builder sites render in the browser, so an
 * address with no matching page returns HTTP 200 and a BLANK page, never a
 * 404. Every old inbound link, search result and printed flyer therefore
 * looks like a broken website rather than a moved one.
 *
 * Why it is not in vercel.json: that file uses `routes`, and Vercel rejects
 * a config carrying both `routes` and `redirects` — the deployment fails.
 * middleware.mjs already runs per request and already reads the Host header,
 * so the table is consulted there.
 *
 * Keys are lowercased, with no trailing slash. Values are paths on the new
 * site. Hosts are normalized the same way middleware.mjs normalizes them:
 * lowercased, port stripped, leading `www.` removed.
 *
 * Generated against delraytennis.com's archived address list on 2026-10-03
 * and checked against the project's published pages and posts. Task 86bccb6w5.
 *
 * daneofearth.org was written by hand on 2026-10-10 (task 86bcgdac6): its
 * pages and posts already match the old WordPress addresses slug for slug, so
 * only the WordPress-only shapes — category and author archives, the feed, the
 * admin screen — need an entry. `/feed` is only safe because that task also
 * unpublished the imported `/feed` page; a key that is a published slug would
 * hide the page behind a redirect.
 */

export const SITE_REDIRECTS = {
  'delraytennis.com': {
    "/3rd-annual-pickleball-tournament-set-to-attract-over-500-players-to-delray-beach": "/blog",
    "/4th-annual-new-years-day-mixer-at-the-delray-beach-tennis-center": "/blog",
    "/alejandro-gerlach-and-simba-tomlin-tennis-champions": "/blog-post?post=alejandro-gerlach-and-simba-tomlin-tennis-champions",
    "/all-peoples-day-diversity-festival-food-and-free-admission-march-24": "/blog",
    "/all-tennis-programs-and-lessons-at-the-swim-and-tennis-club-due-to-delray-beach-open": "/blog",
    "/another-fun-sunday-round-robin-mixer-at-the-delray-beach-tennis-center": "/blog",
    "/another-great-crowd-at-the-delray-beach-tennis-center-annual-christmas-day-mixer": "/blog",
    "/another-packed-house-for-the-saturday-morning-tennis-workout-clinic-at-the-delray-beach-tennis-center": "/blog-post?post=another-packed-house-for-the-saturday-morning-tennis-workout-clinic-at-the-delray-beach-tennis-center",
    "/attention-hard-courts-and-pickleball-courts-closed-for-resurfacing-and-delray-beach-open": "/blog",
    "/back-to-basics-tennis-clinic-get-back-in-the-game": "/blog",
    "/boys-18-and-16-national-clay-court-championships-and-tennis-clinic-hosted-by-delray-beach-tennis-center": "/blog",
    "/bryan-brothers-tennis-clinic-at-delray-open-2018": "/blog",
    "/chris-evert-pro-celebrity-tennis-classic": "/blog",
    "/christmas-day-mixer-delray-beach-tennis-center": "/blog",
    "/claymates-princess-ll-red-division-winners-with-coach-jeff-delray-beach-tennis": "/blog-post?post=claymates-princess-ll-red-division-winners-with-coach-jeff-delray-beach-tennis",
    "/coco-gauff-at-the-delray-beach-tennis-center": "/blog",
    "/congratulations-jonathan-and-brett-on-bringing-home-the-gold-medal": "/blog",
    "/congratulations-luis-baraldi-on-your-performance-at-the-seniors-65-world-cup-championships-in-umag-croatia": "/blog",
    "/contact-us/directions": "/directions-hours",
    "/country-club-vibe-for-everyone-delray-beach-tennis-center": "/blog",
    "/course/blog": "/blog",
    "/course/fees": "/course-fees",
    "/course/instruct-staff": "/managers-staff",
    "/course/lessons": "/course-lessons",
    "/course/photo-gallery": "/course-photo-gallery",
    "/davis-cup-at-delray-beach-tennis-center": "/blog-post?post=davis-cup-at-delray-beach-tennis-center",
    "/delray-beach-junior-tennis-program": "/blog-post?post=delray-beach-junior-tennis-program",
    "/delray-beach-junior-tennis-summer-camp": "/blog",
    "/delray-beach-junior-tennis-summer-workout": "/blog",
    "/delray-beach-open-tennis-tips-sports-psychology-tennis-videos": "/blog",
    "/delray-beach-open-tennis-tournament-visit-historic-delray-beach-events": "/blog",
    "/delray-beach-spring-break-tennis-camp": "/blog",
    "/delray-beach-tennis-center-after-school-program": "/blog-post?post=delray-beach-tennis-center-after-school-program",
    "/delray-beach-tennis-center-complimentary-labor-day-mixer-for-members-only": "/blog",
    "/delray-beach-tennis-center-fall-and-winter-2018-tennis-events-program-schedule": "/blog",
    "/delray-beach-tennis-center-hosting-the-national-clay-championships-from-july-14th-july-22nd": "/blog-post?post=delray-beach-tennis-center-hosting-the-national-clay-championships-from-july-14th-july-22nd",
    "/delray-beach-tennis-center-pickleball-clinics": "/blog",
    "/delray-beach-tennis-center-receives-2021-usta-outstanding-facility-award": "/blog",
    "/delray-beach-tennis-center-saturday-clinic-full-house": "/blog",
    "/delray-beach-tennis-center-saturday-morning-clinic": "/blog",
    "/delray-beach-tennis-center-welcomes-jeff-bingo-new-general-manager-of-racquet-sports": "/blog-post?post=delray-beach-tennis-center-welcomes-jeff-bingo-new-general-manager-of-racquet-sports",
    "/delray-beach-tennis-center-will-be-closed-the-weekend-of-november-23-24": "/blog",
    "/delray-beach-tennis-cheering-for-coco-gauff": "/blog",
    "/delray-beach-tennis-january-20th-2018-biggest-wanna-workout-this-year-with-over-35-participants": "/blog",
    "/delray-beach-tennis-junior-program-holiday-camp": "/blog",
    "/delray-beach-tennis-round-robin-mixers": "/blog",
    "/delray-beach-youth-tennis-foundation-3rd-annual-tennis-tournament": "/blog-post?post=delray-beach-youth-tennis-foundation-3rd-annual-tennis-tournament",
    "/delray-beach-youth-tennis-foundation-inspires-children-in-the-community": "/blog-post?post=delray-beach-youth-tennis-foundation-inspires-children-in-the-community",
    "/delray-beach-youth-tennis-foundation-team-challenge-with-usta-florida-at-delray-beach-tennis-center": "/blog",
    "/delray-champions-usta-l9-tennis-tournament": "/blog-post?post=delray-champions-usta-l9-tennis-tournament",
    "/delray-swim-and-tennis-club-presents-womens-fun-round-robin": "/blog",
    "/delray-tennis-academy-spring-training-2019": "/blog",
    "/delray-tennis-new-pro-staff-new-tennis-courts-and-lights-and-new-programs-and-events": "/blog",
    "/electrifying-night-at-the-delray-beach-open-with-local-star-coco-gauff": "/blog",
    "/elite-tennis": "/programs",
    "/email-club": "/mailing-list",
    "/engage-camp-delray-beach-pickleball": "/blog",
    "/events-list": "/events-calendar",
    "/events-list/73809": "/events-calendar",
    "/events-list/all-doubles-6-730pm": "/events-calendar",
    "/events-list/back-to-basics": "/events-calendar",
    "/events-list/doubles-clinic-630-8pm": "/events-calendar",
    "/events-list/friday-night-mixer": "/events-calendar",
    "/events-list/fun-round-robin-10-12pm": "/events-calendar",
    "/events-list/high-perform-jr-9am-330pm": "/events-calendar",
    "/events-list/intro-to-wanna-workout-2": "/events-calendar",
    "/events-list/intro-to-wwo-pm": "/events-calendar",
    "/events-list/intro-to-wwo-pm-2": "/events-calendar",
    "/events-list/july-4th-mixer": "/events-calendar",
    "/events-list/junior-camp-9-3pm": "/events-calendar",
    "/events-list/junior-camp-9-3pm-2": "/events-calendar",
    "/events-list/junior-camp-9-3pm-3": "/events-calendar",
    "/events-list/junior-programs-red-ball-stars-ages-4-7": "/events-calendar",
    "/events-list/stroke-of-the-week": "/events-calendar",
    "/events-list/stroke-of-the-week-2": "/events-calendar",
    "/events-list/sunday-morning-mixer": "/events-calendar",
    "/events-list/the-basics-7-830pm": "/events-calendar",
    "/events-list/wanna-work-out-ii-2": "/events-calendar",
    "/events-list/wwo-ii": "/events-calendar",
    "/events-list/wwo-ii-2": "/events-calendar",
    "/events-list/yoga": "/events-calendar",
    "/events-list/yoga-8-9am": "/events-calendar",
    "/free-friday-tennis-and-pickleball-every-friday-bring-a-friend": "/blog",
    "/from-us-open-to-delray-tennis-play-delray-after-school-program": "/blog-post?post=from-us-open-to-delray-tennis-play-delray-after-school-program",
    "/great-fun-at-delray-holiday-tennis-camp": "/blog",
    "/happy-birthday-to-general-manager-jeff-bingo-delray-tennis": "/blog",
    "/high-performance-tennis-event-at-dbtc": "/blog",
    "/highest-level-usta-national-event-1-million-in-college-scholarships-to-participants": "/blog",
    "/holiday-fun-tennis-mixer-delray-beach-swim-and-tennis": "/blog",
    "/holiday-tennis-mixers": "/tennis-mixers",
    "/introduction-to-pickleball-101": "/pickleball-guide",
    "/jeff-bingo-with-jamie-corsillo-ballboy-at-delray-beach-open-and-recipient-of-tennis-scholorship": "/blog-post?post=jeff-bingo-with-jamie-corsillo-ballboy-at-delray-beach-open-and-recipient-of-tennis-scholorship",
    "/jeff-bingos-doubles-strategy-camp-all-are-welcome-to-attend": "/blog",
    "/july-4th-round-robin-tennis-mixer-delray-beach-tennis-center": "/blog-post?post=july-4th-round-robin-tennis-mixer-delray-beach-tennis-center",
    "/july-4th-tennis-mixer-progressive-mixed-doubles-round-robin-delray-beach-tennis": "/blog",
    "/junior-tennis-champs-1": "/junior-programs",
    "/junior-tennis-champs-2": "/junior-programs",
    "/junior-tennis-players-tournament-champs-delray-tennis-pics": "/blog",
    "/junior-tennis-program-delray-beach-tennis-center": "/blog",
    "/junior-tennis-program-holiday-camp-delray-beach-tennis-center": "/blog",
    "/kevin-anderson-at-jeff-bingos-doubles-strategy-camp-at-delray-beach-tennis-center": "/blog",
    "/kevin-andersons-professional-tennis-exhibition-cause-for-the-paws": "/blog",
    "/ladies-from-chevy-chase-back-for-tennis-round-2-with-coach-jeff": "/blog",
    "/let-there-be-shade-new-canopy-for-pickleball-courts-delray-beach-tennis-center": "/blog",
    "/meet-adrian-chermaci-delray-beach-tennis-professional": "/blog",
    "/meet-brent-wellman-junior-tennis-director-of-delray-champions-junior-tennis-high-performance-in-delray": "/blog-post?post=meet-brent-wellman-junior-tennis-director-of-delray-champions-junior-tennis-high-performance-in-delray",
    "/meet-tennis-coach-brent-wellman-delray-beach-junior-tennis-director": "/blog-post?post=meet-tennis-coach-brent-wellman-delray-beach-junior-tennis-director",
    "/monday-night-tennis-wanna-work-out-16-advanced-players-drilling-and-playing-at-a-high-level": "/blog",
    "/new-years-day-mixer-delray-beach-tennis-center": "/blog",
    "/new-years-day-tennis-mixer-at-delray-beach-tennis-center": "/blog",
    "/pickelball-schedule-and-lessons": "/pickleball-rates",
    "/pickleball-benefit-round-robin-at-the-delray-beach-tennis-center": "/blog",
    "/pickleball-in-delray-beach": "/pickleball",
    "/pickleball-schedule": "/weekly-schedule",
    "/pickleball-social-mixer-at-delray-beach-tennis-center-picklers-unite-on-july-4th": "/blog",
    "/pickleball-strategies-and-techniques-for-the-intermediate-player": "/blog",
    "/pickleball-with-a-purpose-delray-beach-pickleball-club-partners-with-the-valencia-palms-gift-of-life-club-to-help-save-lives": "/blog",
    "/princess-ll-blue-claymates-tennis-team-a-successful-season": "/blog-post?post=princess-ll-blue-claymates-tennis-team-a-successful-season",
    "/programs/adult-clinics": "/tennis-drills-clinics",
    "/programs/junior": "/programs-junior",
    "/programs/league": "/programs-league",
    "/programs/pickleball": "/programs-pickleball",
    "/programs/special-events": "/programs-special-events",
    "/remembering-jeanne-evert-dubin": "/blog",
    "/round-robin-pickleball-tournament-to-benefit-gift-of-life-on-march-21-2018": "/blog",
    "/saturday-morning-tennis-mixer-at-the-swim-tennis-starting-january-12th": "/blog",
    "/spring-and-summer-junior-tennis-programs": "/blog-post?post=spring-and-summer-junior-tennis-programs",
    "/stretch-and-strengthen-your-game-with-yoga-for-pickleball-and-tennis": "/blog",
    "/stroke-of-the-week": "/blog",
    "/summer-tennis-camp-fun-for-junior-players-delray-beach-tennis": "/blog-post?post=summer-tennis-camp-fun-for-junior-players-delray-beach-tennis",
    "/survivor-series-tennis-tournament-watch-top-juniors-college-players-and-atp-ranked-pro-players": "/blog",
    "/tennis-center-news": "/blog",
    "/tennis-ladders": "/programs-league",
    "/tennis-membership-information-summer-membership-application-2018": "/blog",
    "/tennis-mixers-at-the-delray-beach-tennis-center": "/blog",
    "/tennis-program": "/programs",
    "/tennis-schedule-delray-beach-tennis-center": "/blog",
    "/tennis-social-mixer-at-delray-tennis-center-always-a-big-hit": "/blog",
    "/tennis-videos-tennis-fitness-delray-beach-tennis-center": "/blog",
    "/the-delray-tennis-center-is-looking-for-players-for-our-womens-team-tennis-in-all-divisions-from-1-7": "/blog",
    "/tuesday-ladies-round-robin-delray-beach-tennis-center": "/blog",
    "/us-open-update": "/blog",
    "/usta-boys-18-16-national-clay-court-championships-delray-beach-tennis-center": "/blog-post?post=usta-boys-18-16-national-clay-court-championships-delray-beach-tennis-center",
    "/usta-tournament-announcement-usta-delray-champions-l6-12-14s-and-green-ball-10s-tournament-january-4-6th-delray-swim-and-tennis": "/blog",
    "/visit-the-sundy-house-restaurant-inn-and-botanical-garden-in-delray-beach": "/blog",
    "/we-will-be-closing-at-200pm-on-thanksgiving-day-november-28-2019": "/blog",
    "/welcome-marius-copos-delray-beach-head-tennis-professional": "/blog",
    "/womens-doubles-round-robin-tennis-april-27th-and-april-30th": "/blog-post?post=womens-doubles-round-robin-tennis-april-27th-and-april-30th",
  },
  'daneofearth.org': {
    "/author/dane": "/author-dane",
    "/author/daneofearth_tr7hl9": "/author-dane",
    "/category/autobiography": "/category-autobiography",
    // An empty category on the old site; there is no page to send it to.
    "/category/commentary": "/blog",
    "/category/strands": "/category-strands",
    "/category/uncategorized": "/category-uncategorized",
    "/feed": "/blog",
    // /wp-login.php is deliberately absent: middleware.mjs never sees an
    // address with a file extension, so an entry for it could not fire. It
    // answers a real 404, which is the right answer for login bots anyway.
    "/wp-admin": "/",
  },
};

/**
 * Resolve one request to a redirect target, or null when there is none.
 * Exported separately from the table so it can be tested without a browser.
 */
export function resolveSiteRedirect(host, pathname) {
  // Normalizing here rather than at each call site on purpose: the edge
  // middleware and the local dev server both look this up, and two
  // definitions of "the same host" disagree quietly.
  const key = String(host || '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase()
    .replace(/^www\./, '');
  const table = SITE_REDIRECTS[key];
  if (!table) return null;
  const path = String(pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
  const target = table[path];
  return target || null;
}
