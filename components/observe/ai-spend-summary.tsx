import React, { useCallback, useRef, useState } from 'react';
import { useLoadWhenShown } from '../settings/ai-quota-page';

/**
 * Observe › Dashboard — one line about AI spend, linking to Settings › AI Quota.
 *
 * The full spend panel used to live here; it moved to the AI Quota page
 * (components/settings/ai-quota-page.tsx, task 86bcvj7k9) so AI spending has
 * one home. This line keeps the number visible where it used to be, and says
 * when that number is partial rather than letting it read as complete.
 */

const SPEND_PATH = '/api/observe/ai-spend';

type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, any>>;

export type SpendLine = { totalUsd: number; complete: boolean; pricedCalls: number; unpricedCalls: number };

export function spendSummaryText(spend: SpendLine): string {
  const dollars = `$${(Number(spend.totalUsd) || 0).toFixed(2)}`;
  const calls = (Number(spend.pricedCalls) || 0) + (Number(spend.unpricedCalls) || 0);
  const partial = spend.complete ? '' : ' (incomplete — some calls could not be priced)';
  return `AI spend, last 30 days: ${dollars}${partial} across ${calls} AI call${calls === 1 ? '' : 's'}.`;
}

function openAiQuota(event: React.MouseEvent) {
  const app = (window as unknown as { App?: any }).App;
  if (typeof app?.setActivePage !== 'function') return;
  event.preventDefault();
  app.setActivePage('settingsAiQuotaPage');
}

export default function AiSpendSummary(): React.ReactElement {
  const hostRef = useRef<HTMLParagraphElement | null>(null);
  const [text, setText] = useState('Loading AI spend…');

  const load = useCallback(() => {
    const app = (window as unknown as { App?: { api?: AppApi } }).App;
    const api = app?.api;
    if (typeof api !== 'function') {
      setText('AI spend could not be read: the admin app is not ready.');
      return;
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    api(`${SPEND_PATH}?since=${encodeURIComponent(since)}`)
      .then((res) => {
        if (res && res.ok === false) setText(`AI spend could not be read: ${String(res?.error?.message || 'unknown error')}`);
        else setText(spendSummaryText((res?.data || res) as SpendLine));
      })
      .catch((err) => setText(`AI spend could not be read: ${err instanceof Error ? err.message : 'unknown error'}`));
  }, []);

  useLoadWhenShown(hostRef, load);

  return (
    <p className="ai-spend-summary" ref={hostRef}>
      {text}{' '}
      <a href="#page=settingsAiQuotaPage" onClick={openAiQuota}>
        Everything about AI spend, including the Mac Mini’s jobs: Settings › AI Quota
      </a>
    </p>
  );
}
