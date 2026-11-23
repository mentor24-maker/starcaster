import React, { useCallback, useEffect, useState } from 'react';
import { KEYWORDS_PATH, announceKeywords, onKeywordsSaved, type Keywords } from './youtube-creators';
import type { OutreachChannel, OutreachStage } from './outreach-wizard-panel';

/**
 * Getting started on a channel — Outreach wizard 19/19, slice C (task SC-916).
 *
 * A brand-new channel's first-run path, from Connect to its first approved
 * reply, without leaving Engage › Outreach: sign the Mini in, choose the
 * account it posts as, pick the keywords, approve the first 5 creators,
 * approve the first reply. Each step says where it stands, what happens next,
 * and how long that takes.
 *
 * It adds no capability. Every step's work is done by a stage below — the
 * step's button opens that stage and brings it into sight — except the
 * keywords, which are edited right here through the wizard's shared list
 * (GET/PUT /api/outreach/keywords). That list starts from what is saved, else
 * from the Substack Miner's keywords; nothing derives keywords from the canon
 * yet, so the step says where its starting words came from rather than
 * claiming they are the canon's.
 *
 * It shows only while the channel has COUNTED zero approved replies. A
 * channel whose replies could not be read is not called new (landmine 17: a
 * number that was not counted is never 0).
 */

/** How many creators the path asks for before replies. */
export const FIRST_CREATORS = 5;

export type StepKey = 'connect' | 'account' | 'keywords' | 'creators' | 'reply';
export type StepState = 'done' | 'now' | 'later' | 'cannot_tell';

export type FirstRunStep = {
  key: StepKey;
  title: string;
  state: StepState;
  /** Where this step stands now. */
  sentence: string;
  /** What happens once it is done, and how long that takes. */
  next: string;
  /** The stage below that does this step's work; null when it is done right here. */
  stage: string | null;
};

type Words = { creators: string; findButton: string; afterCreators: string; afterReply: string };

const CHANNEL_WORDS: Record<string, Words> = {
  youtube: {
    creators: 'channels',
    findButton: 'Find channels',
    afterCreators: 'Find channels searches YouTube for your keywords — about a minute. Each channel you approve has its newest comments read straight away, into Find conversations.',
    afterReply: 'In Find conversations, click Write Replies on a comment: the reply options are written in under a minute. Approve one and the Mini posts it within YouTube\'s pace.',
  },
  substack: {
    creators: 'writers',
    findButton: 'Find writers',
    afterCreators: 'Find writers searches the web for Substack writers on your keywords — a few minutes — or paste a writer\'s link. An approved writer\'s newest Notes are read within about two hours, into Find conversations.',
    afterReply: 'In Find conversations, click Write Replies on a Note: the reply options are written in under a minute. Approve one and the Mini posts it within Substack\'s pace.',
  },
  reddit: {
    creators: 'subreddits',
    findButton: 'Find subreddits for my topics',
    afterCreators: 'Find subreddits for my topics suggests some from your canon and keywords — usually under a minute. The Mini reads approved subreddits every four hours, or press Read now in Find conversations.',
    afterReply: 'In Find conversations, click Write Replies on a post: the reply options are written in under a minute. Approve one and the Mini posts it within Reddit\'s pace.',
  },
};

function wordsFor(key: string): Words {
  return CHANNEL_WORDS[key] || { creators: 'creators', findButton: 'Find', afterCreators: '', afterReply: '' };
}

type Counted = OutreachStage & { approvedCount?: number };

function stageOf(channel: OutreachChannel, key: string): Counted | undefined {
  return channel.stages.find((s) => s.key === key) as Counted | undefined;
}

/** Is this channel new — zero approved replies, counted? */
export function isFirstRun(channel: OutreachChannel): boolean {
  const replies = stageOf(channel, 'replies');
  return !!replies && replies.state !== 'cannot_tell' && replies.approvedCount === 0;
}

/**
 * The five steps, each with its state. Pure. `keywords` is the shared list,
 * null while it is being read, or `{ error }` when the read failed.
 */
export function firstRunSteps(channel: OutreachChannel, keywords: Keywords | { error: string } | null): FirstRunStep[] {
  const label = channel.label;
  const w = wordsFor(channel.key);
  const account = channel.account;
  const creators = stageOf(channel, 'creators');
  const replies = stageOf(channel, 'replies');

  const steps: Array<Omit<FirstRunStep, 'state'> & { done: boolean | null }> = [];

  steps.push({
    key: 'connect',
    title: `Sign the Mini in to ${label}`,
    done: account ? !!account.observedAccount : null,
    sentence: !account
      ? 'Cannot tell: the account the Mini is signed in as could not be read — Connect below says why.'
      : account.observedAccount
        ? `The Mini is signed in to ${label} as ${account.observedAccount}.`
        : `The Mini has not seen a ${label} account yet. Click Connect ${label} in Connect and sign its browser in.`,
    next: 'When you close the sign-in window, the Mini checks which account it sees — usually within a few minutes.',
    stage: 'connect',
  });

  // Chosen AND matching what the Mini is signed in as. A mismatch is not
  // done: Connect flags it, and nothing would post as the chosen account.
  const mismatch = !!account?.expectedAccount && !!account?.observedAccount
    && account.expectedAccount !== account.observedAccount; // the same test Connect flags it by
  steps.push({
    key: 'account',
    title: 'Choose the account it posts as',
    done: account ? !!account.expectedAccount && !mismatch : null,
    sentence: !account
      ? 'Cannot tell until the account can be read.'
      : mismatch
        ? `${label} is set to post as ${account.expectedAccount}, but the Mini is signed in as ${account.observedAccount}. In Connect, click Post as this account, or sign the Mini in as ${account.expectedAccount}.`
        : account.expectedAccount
          ? `${label} posts as ${account.expectedAccount}.`
          : `Click Post as this account in Connect — one click. Nothing posts on ${label} until you do.`,
    next: 'Saved at once. Then pick the keywords the creators are found by.',
    stage: 'connect',
  });

  const kwError = keywords && 'error' in keywords ? keywords.error : '';
  const kw = keywords && !('error' in keywords) ? keywords : null;
  steps.push({
    key: 'keywords',
    title: 'Pick your keywords',
    done: kwError ? null : kw ? kw.source === 'saved' && kw.keywords.length > 0 : false,
    sentence: kwError
      ? `Cannot tell: ${kwError}`
      : !kw
        ? 'Reading your keywords…'
        : kw.source === 'saved'
          ? `Saved: ${kw.keywords.join(', ')}.`
          : kw.source === 'substack_miner'
            ? 'Started from the Substack Miner\'s keywords. Change them, or save them as they are.'
            : 'No keywords yet. Type the subjects you want creators in, separated by commas.',
    next: 'Saving takes a moment. All three channels share this one list.',
    stage: null,
  });

  const approved = creators?.approvedCount;
  const creatorsKnown = !!creators && creators.state !== 'cannot_tell' && typeof approved === 'number';
  steps.push({
    key: 'creators',
    title: `Approve your first ${FIRST_CREATORS} ${w.creators}`,
    done: creatorsKnown ? (approved as number) >= FIRST_CREATORS : null,
    sentence: creatorsKnown
      ? `${Math.min(approved as number, FIRST_CREATORS)} of ${FIRST_CREATORS} approved. Click ${w.findButton} in Find creators, then Approve the ones worth talking to.`
      : 'Cannot tell how many are approved — Find creators below says why.',
    next: w.afterCreators,
    stage: 'creators',
  });

  const waiting = replies?.waitingCount || 0;
  const toWrite = replies?.toWriteCount || 0;
  steps.push({
    key: 'reply',
    title: 'Approve your first reply',
    done: replies && replies.state !== 'cannot_tell' && typeof replies.approvedCount === 'number' ? replies.approvedCount > 0 : null,
    sentence: waiting
      ? `${waiting} ${waiting === 1 ? 'reply is' : 'replies are'} waiting for you. Write replies below walks you through ${waiting === 1 ? 'it' : 'them'}.`
      // Ideas already picked but not yet drafted: Write drafts is the move,
      // not Find conversations (SC-916 round 2).
      : toWrite
        ? `${toWrite} ${toWrite === 1 ? 'idea is' : 'ideas are'} waiting to be written. Click Write drafts in Write replies below.`
        : replies?.writeBlocked
          ? replies.writeBlocked
          : 'No reply written yet.',
    next: w.afterReply,
    stage: waiting || toWrite || replies?.writeBlocked ? 'replies' : 'conversations',
  });

  // The first step not done is the one to do now; a step that cannot be told
  // stays "cannot tell", never done, and does not hold up the rest.
  let nowSet = false;
  return steps.map(({ done, ...s }) => {
    if (done === true) return { ...s, state: 'done' as const };
    if (done === null) return { ...s, state: 'cannot_tell' as const };
    if (!nowSet) { nowSet = true; return { ...s, state: 'now' as const }; }
    return { ...s, state: 'later' as const };
  });
}

const STEP_WORD: Record<StepState, string> = { done: 'Done', now: 'Now', later: 'Next', cannot_tell: 'Cannot tell' };

type Api = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

function getApi(): Api | null {
  const app = (window as unknown as { App?: { api?: Api } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'unknown error';
}

export default function FirstRunPath({ channel, onShowStage, onChanged }: {
  channel: OutreachChannel;
  /** Open a stage below and bring it into sight. */
  onShowStage: (stageKey: string) => void;
  onChanged: () => void;
}): React.ReactElement {
  const [keywords, setKeywords] = useState<Keywords | { error: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const api = getApi();
    if (!api) { setKeywords({ error: 'the admin app is still loading — try again in a moment.' }); return; }
    try {
      const reply = await api(KEYWORDS_PATH);
      const k = (reply?.data as Keywords) || { keywords: [], source: 'none' };
      setKeywords(k);
      setDraft((k.keywords || []).join(', '));
    } catch (err) {
      setKeywords({ error: `your keywords could not be read: ${errorText(err)}.` });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // A save in Find creators shows here at once, not after a reload.
  useEffect(() => onKeywordsSaved((saved) => { setKeywords(saved); setDraft(saved.keywords.join(', ')); }), []);

  const save = async () => {
    const api = getApi();
    if (!api) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const list = draft.split(',').map((k) => k.trim()).filter(Boolean);
      const reply = await api(KEYWORDS_PATH, { method: 'PUT', body: JSON.stringify({ keywords: list }) });
      const saved = (reply?.data as Keywords) || null;
      if (saved) { setKeywords(saved); setDraft(saved.keywords.join(', ')); announceKeywords(saved); }
      setNotice('Keywords saved.');
      onChanged();
    } catch (err) {
      setError(`The keywords were not saved: ${errorText(err)}`);
    } finally { setBusy(false); }
  };

  const steps = firstRunSteps(channel, keywords);
  const inputId = `first-run-keywords-${channel.key}`;

  return (
    <section className="outreach-first-run" aria-label={`Getting started on ${channel.label}`} data-first-run={channel.key}>
      <h3 className="outreach-first-run-title">{`Getting started on ${channel.label}`}</h3>
      <p className="outreach-wizard-muted">{`Five steps to your first approved ${channel.label} reply, all on this screen.`}</p>
      <ol className="outreach-first-run-steps">
        {steps.map((s) => (
          <li key={s.key} className={`outreach-first-run-step outreach-first-run-step--${s.state}`} data-step={s.key} data-state={s.state}>
            <div className="outreach-first-run-head">
              <strong>{s.title}</strong>
              <span className="outreach-wizard-stage-state">{STEP_WORD[s.state]}</span>
            </div>
            <p className="outreach-first-run-sentence">{s.sentence}</p>
            {s.state === 'now' || s.state === 'cannot_tell' ? (
              <>
                <p className="outreach-wizard-muted" data-step-next>{`Next: ${s.next}`}</p>
                {s.key === 'keywords' && s.state === 'now' && keywords && !('error' in keywords) ? (
                  <form className="outreach-wizard-connect-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                    <label htmlFor={inputId}>Keywords</label>
                    <input id={inputId} type="text" className="outreach-wizard-account-input" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button type="submit" className="btn btn-save" disabled={busy || !draft.trim()}>{busy ? 'Saving…' : 'Save keywords'}</button>
                  </form>
                ) : null}
                {s.stage ? (
                  <div className="outreach-wizard-stage-actions">
                    <button type="button" className="btn" data-show-stage={s.stage} onClick={() => onShowStage(s.stage!)}>
                      {`Go to ${channel.stages.find((x) => x.key === s.stage)?.label || s.stage}`}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {notice ? <p className="outreach-wizard-notice" role="status">{notice}</p> : null}
      {error ? <p className="outreach-wizard-error" role="alert">{error}</p> : null}
    </section>
  );
}
