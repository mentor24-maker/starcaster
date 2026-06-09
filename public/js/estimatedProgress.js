'use strict';

/**
 * Indeterminate progress bars for long-running jobs.
 *
 * Methodology:
 * - Pace the bar to reach ~maxPercent only after estimatedMs * upperBoundFactor.
 * - Use an upper-bound estimate (default 5 minutes) so the bar usually finishes
 *   before 100% when the job completes early.
 * - Show a static "Estimated time: …" label above the status text.
 */
(function (App) {
  const DEFAULT_ESTIMATE_MS = 5 * 60 * 1000;
  const DEFAULT_MAX_PERCENT = 92;
  const DEFAULT_INITIAL_PERCENT = 5;
  const DEFAULT_TICK_MS = 500;
  const DEFAULT_UPPER_BOUND_FACTOR = 1.1;

  const ESTIMATES = {
    default: DEFAULT_ESTIMATE_MS,
    peerDiscovery: 5 * 60 * 1000,
    websiteAcquire: 2 * 60 * 1000,
    contactsPeerSites: 5 * 60 * 1000,
    messagingTopics: 4 * 60 * 1000,
  };

  function resolveElement(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return document.getElementById(ref);
    return ref;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(1, Math.round(Number(ms || 0) / 1000));
    if (totalSeconds < 60) {
      return totalSeconds === 1 ? '1 second' : `${totalSeconds} seconds`;
    }
    const minutes = Math.round(totalSeconds / 60);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }

  function formatEstimateLabel(ms) {
    return `Estimated time: ${formatDuration(ms)}`;
  }

  function ensureEstimateElement(wrapEl, estimateEl, estimateMs) {
    let el = resolveElement(estimateEl);
    if (el) return el;
    if (!wrapEl) return null;

    el = wrapEl.querySelector('[data-progress-estimate]');
    if (el) return el;

    el = document.createElement('div');
    el.className = 'asset-upload-progress-estimate';
    el.setAttribute('data-progress-estimate', '1');
    el.textContent = formatEstimateLabel(estimateMs);

    const textEl = wrapEl.querySelector('.asset-upload-progress-text');
    if (textEl) wrapEl.insertBefore(el, textEl);
    else wrapEl.prepend(el);
    return el;
  }

  function createController(options = {}) {
    const wrapEl = resolveElement(options.wrap);
    const barEl = resolveElement(options.bar);
    const textEl = resolveElement(options.text);
    const estimateMs = Math.max(1000, Number(options.estimatedMs || DEFAULT_ESTIMATE_MS));
    const upperBoundFactor = Math.max(1, Number(options.upperBoundFactor || DEFAULT_UPPER_BOUND_FACTOR));
    const maxPercent = Math.min(98, Math.max(50, Number(options.maxPercent || DEFAULT_MAX_PERCENT)));
    const initialPercent = Math.min(maxPercent - 1, Math.max(0, Number(options.initialPercent || DEFAULT_INITIAL_PERCENT)));
    const tickMs = Math.max(200, Number(options.tickMs || DEFAULT_TICK_MS));
    const hideDelayOk = Number(options.hideDelayOk ?? 900);
    const hideDelayErr = Number(options.hideDelayErr ?? 1800);
    const barDurationMs = estimateMs * upperBoundFactor;
    const estimateEl = ensureEstimateElement(wrapEl, options.estimate, estimateMs);

    let timer = null;

    function setEstimateLabel() {
      if (estimateEl) {
        estimateEl.textContent = formatEstimateLabel(estimateMs);
        estimateEl.classList.remove('hidden');
      }
    }

    function clearTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    return {
      start(statusText) {
        clearTimer();
        if (wrapEl) wrapEl.classList.remove('hidden');
        if (barEl) barEl.value = initialPercent;
        setEstimateLabel();
        if (textEl && statusText) textEl.textContent = String(statusText).trim();
        if (typeof options.onStart === 'function') options.onStart();

        const ticks = barDurationMs / tickMs;
        const increment = ticks > 0 ? (maxPercent - initialPercent) / ticks : 0;
        timer = setInterval(() => {
          if (!barEl) return;
          const current = Number(barEl.value || 0) || 0;
          if (current >= maxPercent) return;
          barEl.value = Math.min(maxPercent, current + increment);
        }, tickMs);
      },

      setStatus(text) {
        if (textEl && text) textEl.textContent = String(text).trim();
      },

      finish(ok, message) {
        clearTimer();
        if (barEl) {
          barEl.value = ok ? 100 : Math.max(initialPercent, Number(barEl.value || 0) || initialPercent);
        }
        if (textEl && message) textEl.textContent = String(message).trim();
        if (typeof options.onFinish === 'function') options.onFinish(ok);
        if (wrapEl) {
          window.setTimeout(() => wrapEl.classList.add('hidden'), ok ? hideDelayOk : hideDelayErr);
        }
      },

      stop() {
        clearTimer();
      },
    };
  }

  App.estimatedProgress = {
    DEFAULT_ESTIMATE_MS,
    ESTIMATES,
    formatDuration,
    formatEstimateLabel,
    createController,
  };
})(window.App = window.App || {});
