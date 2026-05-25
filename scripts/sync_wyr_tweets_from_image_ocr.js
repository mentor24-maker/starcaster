#!/usr/bin/env node
'use strict';

/**
 * OCR linked tweet images and rebuild WYR tweet copy (options + follow-up teaser).
 *
 *   node scripts/sync_wyr_tweets_from_image_ocr.js
 *   node scripts/sync_wyr_tweets_from_image_ocr.js --apply
 *   node scripts/sync_wyr_tweets_from_image_ocr.js --apply --tweet-id=123
 *   node scripts/sync_wyr_tweets_from_image_ocr.js --apply --preserve-follow-up
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { syncAllWyrTweetsFromImages } = require('../lib/wyrTweetImageSync');

function parseArgs(argv) {
  const args = {
    apply: false,
    limit: 0,
    tweetId: 0,
    preserveFollowUp: false,
    allTweets: false,
  };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    else if (raw === '--preserve-follow-up') args.preserveFollowUp = true;
    else if (raw === '--all') args.allTweets = true;
    else if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      args.limit = Number.isFinite(n) && n > 0 ? n : 0;
    } else if (raw.startsWith('--tweet-id=')) {
      const n = Number(raw.split('=').slice(1).join('='));
      args.tweetId = Number.isFinite(n) && n > 0 ? n : 0;
    } else if (raw.startsWith('--project-id=')) {
      args.projectId = raw.split('=').slice(1).join('=').trim();
    }
  }
  if (!args.projectId) {
    args.projectId = String(
      process.env.WYR_IMPORT_PROJECT_ID
      || process.env.MESSAGING_IMPORT_PROJECT_ID
      || ''
    ).trim();
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = args.projectId ? { projectId: args.projectId, userId: '' } : null;

  const result = await syncAllWyrTweetsFromImages(scope, {
    dryRun: !args.apply,
    onlyWyr: !args.allTweets,
    tweetId: args.tweetId,
    limit: args.tweetId ? 0 : args.limit,
    preserveFollowUp: args.preserveFollowUp,
    onProgress: ({ tweetId }) => {
      process.stdout.write(`OCR tweet ${tweetId}…\n`);
    },
  });

  if (!result.ok) {
    console.error(result.error || 'Sync failed');
    if (result.data?.results?.length) {
      console.error(result.data.results.filter((r) => !r.ok).slice(0, 5));
    }
    process.exit(1);
  }

  const { matched, applied, skipped, failed, results } = result.data;
  console.log(`Matched ${matched} tweet(s) with images${args.allTweets ? '' : ' (WYR only)'}.`);
  if (matched === 0) {
    console.log('Nothing to process. Use --all to include non-WYR tweets, or set --project-id=.');
    return;
  }
  if (!args.apply) {
    console.log('Dry run only. Re-run with --apply to update tweets.');
  } else {
    console.log(`Applied ${applied}, skipped ${skipped}, failed ${failed}.`);
  }

  for (const row of results) {
    if (!row.ok) {
      console.log(`Tweet ${row.tweetId}: ERROR ${row.error}`);
      if (row.debug) console.log(`  OCR debug: ${row.debug}`);
      continue;
    }
    if (!row.changed) {
      console.log(`Tweet ${row.tweetId}: unchanged`);
      continue;
    }
    console.log(`\nTweet ${row.tweetId}${row.applied ? ' (updated)' : ' (would update)'}`);
    console.log(`  OCR: ${row.phraseA} OR ${row.phraseB}`);
    console.log(`  Before: ${row.previous}`);
    console.log(`  After:  ${row.nextContent}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
