'use strict';

/**
 * Substack Miner — the pasted seed list, where a line may name a PERSON
 * (`https://substack.com/@ankairos`) as well as a publication (task 86bch05xg).
 *
 * Dane, 2026-10-12: "Ultimately, I am looking for the people to connect with
 * anyway." A profile link is what Substack shows wherever a person appears — a
 * Note, a comment, a like — so it is what he has to hand. The store keys a
 * writer by PUBLICATION (the part before .substack.com) and refuses a profile
 * link, correctly: a person's @handle often differs from their publication's
 * (@ankairos writes magickalchemyandai.substack.com).
 *
 * So each profile line is looked up on the person's public profile — the same
 * lookup Notes search (6/7) uses, `publicationForAuthor`, so the two can never
 * disagree about who a person is — and replaced by their publication before
 * the ordinary import sees it. A person with no publication, or a profile that
 * cannot be read, is refused on its own line with the reason; the rest of the
 * list still saves. Every other line goes through untouched.
 *
 * A pasted ARTICLE or publication link that does not name its publication
 * (its own domain, a substack.com post, Substack's share link) is looked up
 * the same way, by ./SubstackLinkResolve.js (task 86bcux874) — so Dane can add
 * a writer from whatever address his browser shows.
 *
 * At most MAX_LOOKUPS lines are looked up per send: each is a polite, paused
 * fetch, and a list that ran past the server's time limit would answer with
 * nothing at all. The lines past the cap are refused BY NAME, never dropped.
 *
 * Answers like importCandidates, plus `resolved`: which profile or link line
 * became which publication, so the screen can say so. Refusal and resolved
 * indexes are positions in the list the caller SENT.
 */

const minerStore = require('../substackMinerStore');
const { fetchSubstackJson } = require('./SubstackNotesReadRun');
const { publicationForAuthor, personHandle } = require('./SubstackNotesSearch');
const { linkKind, publicationForLink, fetchSubstackPage } = require('./SubstackLinkResolve');

/** How many lines one send may look up (see the header). */
const MAX_LOOKUPS = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The @handle when `value` is a substack.com/@name profile link, else ''. */
function profileHandle(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^(?:https?:\/\/)?(?:www\.)?substack\.com\/@/i.test(raw)) return '';
  return personHandle(raw);
}

/**
 * What a row needs looked up before the store can take it, or null:
 * { kind: 'profile', person } | { kind: 'share', handle, link } | { kind: 'page', url, link }.
 */
function lookupFor(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const person = profileHandle(row.handle) || profileHandle(row.publicationUrl);
  if (person) return { kind: 'profile', person };
  for (const value of [row.handle, row.publicationUrl]) {
    const link = linkKind(value);
    if (link) return { ...link, link: String(value).trim() };
  }
  return null;
}

async function importSeedList(rows, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  if (!Array.isArray(rows)) return store.importCandidates(rows, scope);

  const lookupAt = rows.map(lookupFor);
  if (!lookupAt.some(Boolean)) return store.importCandidates(rows, scope);

  // Settings first: a missing project or table stops it before any lookup.
  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);
  const fetchJson = deps.fetchJson || fetchSubstackJson;
  const fetchPage = deps.fetchPage || fetchSubstackPage;
  const wait = deps.sleep || sleep;
  let fetches = 0;
  const polite = (fn) => async (url) => {
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    return fn(url);
  };
  const politeFetch = polite(fetchJson);
  const politePage = polite(fetchPage);

  const sent = [];       // rows handed to the store
  const sentFrom = [];   // sent[i] came from rows[sentFrom[i]]
  const refusals = [];
  const resolved = [];
  const looked = new Map(); // one lookup per person or link, however often it is pasted
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lookup = lookupAt[index];
    if (!lookup) {
      sent.push(row);
      sentFrom.push(index);
      continue;
    }
    const label = lookup.kind === 'profile' ? `@${lookup.person}` : lookup.link;
    let pub;
    if (lookup.kind === 'share') {
      pub = { ok: true, handle: lookup.handle, name: '' };
    } else {
      const key = lookup.kind === 'profile' ? label : lookup.url;
      if (!looked.has(key)) {
        if (looked.size >= MAX_LOOKUPS) {
          refusals.push({ index, handle: label, error: `only ${MAX_LOOKUPS} profiles and links are looked up at a time — add this line again in a second batch` });
          continue;
        }
        looked.set(key, lookup.kind === 'profile'
          ? await publicationForAuthor(lookup.person, { fetchJson: politeFetch })
          : await publicationForLink(lookup.url, { fetchPage: politePage }));
      }
      pub = looked.get(key);
    }
    if (!pub.ok) {
      const reason = lookup.kind === 'profile' && /HTTP 404$/.test(pub.reason)
        ? `there is no Substack profile at substack.com/@${lookup.person} — check the link`
        : pub.reason;
      refusals.push({ index, handle: label, error: reason });
      continue;
    }
    const { publicationUrl: _ignored, ...rest } = row;
    sent.push({ ...rest, handle: pub.handle, ...(rest.name ? {} : pub.name ? { name: pub.name } : {}) });
    sentFrom.push(index);
    resolved.push(lookup.kind === 'profile'
      ? { index, profile: label, handle: pub.handle, name: pub.name || '' }
      : { index, link: label, handle: pub.handle, name: pub.name || '' });
  }

  let result = { added: 0, merged: 0, refused: 0, refusals: [] };
  if (sent.length) {
    const res = await store.importCandidates(sent, scope);
    if (!res.ok) return res;
    result = res.data;
  }
  const all = [
    ...refusals,
    ...(result.refusals || []).map((r) => ({ ...r, index: sentFrom[r.index] ?? r.index })),
  ].sort((a, b) => a.index - b.index);
  return {
    ok: true,
    status: 200,
    data: { ...result, refused: all.length, refusals: all, resolved },
  };
}

module.exports = { importSeedList, profileHandle, MAX_LOOKUPS };
