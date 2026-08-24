'use strict';

/**
 * Was this bug report filed by a person, or by our own machinery?
 *
 * WHY THIS EXISTS (2026-08-24). Three bug reports filed by our own test
 * harness landed in the Loop Queue as "Needs your input", assigned to Dane,
 * with titles that read like genuine complaints. He closed all three by hand
 * and asked what he was supposed to do with them. That is three interruptions
 * of the operator's attention spent on noise we generated ourselves — from the
 * feature whose entire purpose was to route real reports to him cleanly.
 *
 * THE FIX IS AT THE FILING END, NOT THE SUBMITTING END. The harness POSTing to
 * /api/public/bug-report IS the proof that the live path still works (task
 * 86bbjk788 depends on it), and PR #403's review was careful not to delete that
 * evidence. So the report is still made, still stored, still forwarded — it
 * just does not get pushed into the operator's lane.
 *
 * THE ASYMMETRY THAT DECIDES EVERY RULE BELOW. Filing a synthetic report as
 * real costs Dane one interruption. Filing a REAL one as synthetic loses a
 * customer's bug report into a closed ticket nobody reads. Those are not
 * equally bad, so the classifier is deliberately reluctant: it needs a signal
 * no human could produce, or two independent weaker ones.
 */

/**
 * Agents no human filing this form can produce. The popup is JavaScript in a
 * browser — reaching the endpoint with one of these means something scripted
 * did it, so ONE of these is enough on its own.
 */
const NON_BROWSER_AGENTS = /(?:^|[\s(/])(?:curl|wget|python-requests|python-urllib|node-fetch|axios|go-http-client|postmanruntime|okhttp|libwww-perl|java|apache-httpclient)[/\s]/i;

/**
 * Automation driving a real browser. This IS a browser string, so it is only
 * suggestive — a determined person could send it, and a headless agent could
 * in principle be a real accessibility tool.
 */
const AUTOMATED_BROWSER = /(?:HeadlessChrome|PhantomJS|Playwright|Puppeteer|Selenium|Cypress|electron)/i;

/** Hosts no tenant site is ever served from. */
const NON_PUBLIC_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?|.*\.local|.*\.test|.*\.internal)$/i;

/** Project names our fixtures use. Suggestive only — a real client could
 *  plausibly have "test" in their name, which is exactly why it is not enough
 *  on its own. */
const FIXTURE_PROJECT = /(?:harness|fixture|scratch|e2e)/i;

function hostOf(pageUrl) {
  const raw = String(pageUrl || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

/**
 * Classify one report's origin.
 *
 * @returns {{ synthetic: boolean, why: string, signals: string[] }}
 *   `why` is written for a human reading the ticket later, not for a log grep.
 */
function classifyReportOrigin({ pageUrl, userAgent, projectName } = {}) {
  const ua = String(userAgent || '');
  const host = hostOf(pageUrl);

  // Conclusive on its own: nothing that reaches this endpoint with a
  // non-browser agent came from the popup form.
  if (NON_BROWSER_AGENTS.test(ua)) {
    return {
      synthetic: true,
      signals: ['non-browser-agent'],
      why: `submitted by "${ua.slice(0, 80)}", which is not a browser — the report form only runs in one`,
    };
  }

  // Otherwise it takes two independent weak signals. Any one alone is
  // suggestive and deliberately not enough (see the asymmetry above).
  const signals = [];
  if (AUTOMATED_BROWSER.test(ua)) signals.push('automated-browser');
  if (host && NON_PUBLIC_HOST.test(host)) signals.push('non-public-host');
  if (!host) signals.push('no-page-url');
  if (FIXTURE_PROJECT.test(String(projectName || ''))) signals.push('fixture-project');

  if (signals.length >= 2) {
    return {
      synthetic: true,
      signals,
      why: `${signals.length} independent signals of an automated origin (${signals.join(', ')}) — no one of them would have been enough`,
    };
  }

  return {
    synthetic: false,
    signals,
    why: signals.length
      ? `one weak signal (${signals[0]}) and nothing corroborating it — treated as a real person`
      : 'nothing suggests this came from anything but a person',
  };
}

module.exports = {
  classifyReportOrigin,
  NON_BROWSER_AGENTS,
  AUTOMATED_BROWSER,
  NON_PUBLIC_HOST,
};
