import React, { useState } from 'react';

/**
 * Assets › Footage › a recording's File cell: which other recording it was
 * made together with, and whose sound the edit will use (Reel Spinner 3b,
 * SC-832).
 *
 * Every pair the Mac Mini looked at is shown, the refused ones too, each with
 * its reason in words — a pair that drifted or did not match says so rather
 * than not showing (CLAUDE.md landmine 17). A lined-up pair has a switch to
 * use the other recording's sound, which is Dane's choice and is never
 * overwritten by a later line-up (lib/videoAudioPairsStore.js).
 *
 * Server half: lib/studioFootage.js pairsViewFor, routes/studioPairs.js.
 */

/** lib/studioFootage.js pairsViewFor. */
export type PairView = {
  pairId: string;
  partnerId: string;
  partnerName: string;
  status: 'done' | 'failed';
  reason: string;
  offsetS: number | null;
  soundFromId: string | null;
  soundFromName: string;
  soundIsThisFile: boolean;
  chosenBy: 'measured' | 'dane';
};

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const app = (window as unknown as { App?: { api?: Api } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function quoted(name: string, fallback: string): string {
  return name ? name : fallback;
}

/** The sentence one pair reads as. Exported for the tests. */
export function pairSentence(pair: PairView, thisName: string): string {
  const partner = quoted(pair.partnerName, 'another recording');
  if (pair.status === 'failed') {
    return `Recorded at the same time as ${partner}, but the two could not be lined up: ${pair.reason || 'no reason was recorded'}.`;
  }
  const lead = `Recorded together with ${partner}`;
  if (!pair.soundFromId) {
    return `${lead}. Neither sound was clearly cleaner, so no sound is chosen yet.`;
  }
  const from = pair.soundIsThisFile ? quoted(thisName, 'this file') : partner;
  const why = pair.chosenBy === 'dane' ? 'your choice' : 'cleaner';
  return `${lead}, sound from ${from} (${why}).`;
}

function PairLine({ pair, sourceId, thisName, onChanged }: {
  pair: PairView;
  sourceId: string;
  thisName: string;
  onChanged: () => void;
}): React.ReactElement {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const choose = async (audioSourceId: string) => {
    const api = getApi();
    if (!api) {
      setError('The admin app is still loading — try again in a moment.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = await api(`/api/studio/pairs/${encodeURIComponent(pair.pairId)}/sound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioSourceId }),
      });
      if (!body?.ok) setError(body?.error?.message || 'The choice of sound was not saved.');
      else onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The choice of sound was not saved.');
    } finally {
      setSaving(false);
    }
  };

  // The switch offers whichever sound is NOT in use; with none chosen, both.
  const options: { id: string; label: string }[] = [];
  if (pair.status === 'done') {
    // Short labels: the sentence beside them already names both files, and
    // repeating an hour-long take's name on a button doubled the row's height.
    if (!pair.soundFromId || !pair.soundIsThisFile) options.push({ id: sourceId, label: "Use this file's sound" });
    if (!pair.soundFromId || pair.soundIsThisFile) options.push({ id: pair.partnerId, label: "Use the other recording's sound" });
  }

  return (
    <li className="studio-footage-pair" data-testid="studio-pair" data-pair-status={pair.status}>
      <span className="studio-footage-pair-text">{pairSentence(pair, thisName)}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="btn btn-ghost studio-footage-pair-switch"
          data-testid="studio-pair-switch"
          disabled={saving}
          onClick={() => void choose(o.id)}
        >
          {saving ? 'Saving…' : o.label}
        </button>
      ))}
      {error ? <span className="studio-footage-error" role="alert">{` Not saved: ${error}`}</span> : null}
    </li>
  );
}

export default function PairLines({ pairs, sourceId, thisName, onChanged }: {
  pairs: PairView[] | undefined;
  sourceId: string;
  thisName: string;
  onChanged: () => void;
}): React.ReactElement | null {
  if (!pairs || !pairs.length) return null;
  return (
    <ul className="studio-footage-pairs" aria-label="Recorded together with">
      {pairs.map((pair) => (
        <PairLine key={pair.pairId} pair={pair} sourceId={sourceId} thisName={thisName} onChanged={onChanged} />
      ))}
    </ul>
  );
}
