import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * "YouTube Video" — paste one URL, get the whole video.
 *
 * A React island on the frozen vanilla Acquire: YouTube screen. It owns the
 * acquisition itself; the vanilla page still owns the Extract tables below, so
 * when a run finishes this dispatches YOUTUBE_ACQUIRED_EVENT and the page
 * renders the result and refreshes.
 *
 * Everything except the media files comes back from one call. The .mp4/.mp3
 * download is a separate job on the self-hosted worker (lib/acquire/
 * YoutubeMediaWorker.js) because it takes minutes, so it is polled after the
 * rest of the video has already landed.
 */

export const YOUTUBE_ACQUIRED_EVENT = 'starcaster:youtube-acquired';

/**
 * Media polling. A download runs for minutes, so the interval backs off rather
 * than hammering the API for the whole run: quick at first, when a bad URL or
 * a dead worker shows up, then slower once it is clearly just working.
 */
const MEDIA_POLL_FIRST_MS = 5000;
const MEDIA_POLL_MAX_MS = 15000;
const MEDIA_POLL_BACKOFF = 1.5;
const MEDIA_POLL_TIMEOUT_MS = 30 * 60 * 1000;

type Topic = {
  id: number | string;
  topic?: string;
  name?: string;
  label?: string;
};

type MediaFile = {
  url: string;
  bytes?: number;
  content_type?: string;
};

type MediaState = {
  status: string;
  progress: number;
  mp4: MediaFile | null;
  mp3: MediaFile | null;
  error: string;
};

type AcquiredSummary = {
  title: string;
  channel: string;
  hashtags: string;
  transcriptStatus: string;
  socialCount: number;
  videoUrl: string;
};

function safeText(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

/**
 * Calls go through the vanilla App.api() so they carry the session token and
 * the X-Project-ID header. A bare fetch() would lose the tenant scope.
 */
type AppApi = (path: string, options?: RequestInit) => Promise<Record<string, unknown>>;

function getAppApi(): AppApi | null {
  const app = (window as unknown as { App?: { api?: AppApi } }).App;
  return typeof app?.api === 'function' ? app.api : null;
}

async function apiCall(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const api = getAppApi();
  if (!api) throw new Error('The admin app is still loading — try again in a moment.');
  return api(path, options);
}

function notify(message: string, isError = false): void {
  const app = (window as unknown as { App?: { notify?: (m: string, e?: boolean) => void } }).App;
  if (typeof app?.notify === 'function') app.notify(message, isError);
}

/**
 * Accepts the URL shapes people actually paste — watch links, youtu.be shorts,
 * /shorts/, /embed/, or a bare 11-character id — and returns the canonical
 * watch URL. Empty string means "not a YouTube video", which is what gates the
 * submit button.
 */
export function normalizeYoutubeUrl(value: string): string {
  const raw = safeText(value);
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return `https://www.youtube.com/watch?v=${raw}`;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch (_) {
    return '';
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return '';

  let videoId = '';
  if (host === 'youtu.be') {
    videoId = safeText(url.pathname.split('/').filter(Boolean)[0]);
  } else if (url.pathname === '/watch') {
    videoId = safeText(url.searchParams.get('v'));
  } else {
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => ['embed', 'shorts', 'v', 'live'].includes(part));
    if (marker >= 0) videoId = safeText(parts[marker + 1]);
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return '';
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function topicLabel(topic: Topic): string {
  return safeText(topic.topic || topic.name || topic.label) || `Topic ${topic.id}`;
}

function readTopics(body: Record<string, unknown>): Topic[] {
  const direct = body?.topics;
  if (Array.isArray(direct)) return direct as Topic[];
  const data = body?.data;
  if (Array.isArray(data)) return data as Topic[];
  return [];
}

const IDLE_MEDIA: MediaState = { status: '', progress: 0, mp4: null, mp3: null, error: '' };

export function YoutubeVideoAcquirePanel(): React.ReactElement {
  const [videoUrl, setVideoUrl] = useState('');
  const [topic, setTopic] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [captureContact, setCaptureContact] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<AcquiredSummary | null>(null);
  const [media, setMedia] = useState<MediaState>(IDLE_MEDIA);

  // Polling must stop when the panel unmounts or a new run starts, or two
  // timers race and the older one overwrites the newer run's media state.
  const pollTimer = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiCall('/api/acquire/youtube-topics')
      .then((body) => {
        if (cancelled) return;
        setTopics(readTopics(body));
      })
      .catch(() => {
        // A missing topic list is not worth blocking an acquisition over.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedUrl = useMemo(() => normalizeYoutubeUrl(videoUrl), [videoUrl]);
  const urlLooksWrong = Boolean(safeText(videoUrl)) && !normalizedUrl;

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollMedia = useCallback(
    (jobId: string, watchUrl: string, videoId: string, startedAt: number, delayMs: number) => {
      stopPolling();
      pollTimer.current = window.setTimeout(async () => {
        if (!mountedRef.current) return;
        try {
          const query = `?video_url=${encodeURIComponent(watchUrl)}&video_id=${encodeURIComponent(videoId)}`;
          const body = await apiCall(`/api/acquire/youtube-media/${encodeURIComponent(jobId)}${query}`);
          if (!mountedRef.current) return;

          const status = safeText(body.status) || 'queued';
          setMedia({
            status,
            progress: Number(body.progress) || 0,
            mp4: (body.mp4 as MediaFile) || null,
            mp3: (body.mp3 as MediaFile) || null,
            error: safeText(body.error),
          });

          if (status === 'done') {
            notify('Video and audio files ready.');
            return;
          }
          if (status === 'failed') {
            notify(safeText(body.error) || 'Media download failed.', true);
            return;
          }
          if (Date.now() - startedAt > MEDIA_POLL_TIMEOUT_MS) {
            setMedia((prev) => ({
              ...prev,
              status: 'failed',
              error: 'Still running after 30 minutes — check the worker.',
            }));
            return;
          }
          pollMedia(
            jobId,
            watchUrl,
            videoId,
            startedAt,
            Math.min(delayMs * MEDIA_POLL_BACKOFF, MEDIA_POLL_MAX_MS)
          );
        } catch (err) {
          if (!mountedRef.current) return;
          setMedia((prev) => ({
            ...prev,
            status: 'failed',
            error: (err as Error)?.message || 'Lost contact with the media worker.',
          }));
        }
      }, delayMs);
    },
    [stopPolling]
  );

  const acquire = useCallback(async () => {
    const watchUrl = normalizeYoutubeUrl(videoUrl);
    if (!watchUrl) {
      setError('That does not look like a YouTube video link. Paste the URL from the address bar.');
      return;
    }

    stopPolling();
    setBusy(true);
    setError('');
    setSummary(null);
    setMedia(IDLE_MEDIA);

    try {
      const body = await apiCall('/api/acquire/youtube', {
        method: 'POST',
        body: JSON.stringify({
          video_url: watchUrl,
          topic,
          capture_contact: captureContact,
          include_media: includeMedia,
        }),
      });

      const result = (body.result || {}) as Record<string, any>;
      const run = (body.run || {}) as Record<string, any>;
      const video = (result.video || {}) as Record<string, any>;
      const owner = (result.channel_owner || {}) as Record<string, any>;
      const socials = Array.isArray(owner.social_profiles) ? owner.social_profiles : [];

      setSummary({
        title: safeText(video.title || run.title) || 'Untitled video',
        channel: safeText(owner.name || run.channel_name),
        hashtags: Array.isArray(video.hashtags) ? video.hashtags.join(' ') : safeText(video.hashtags),
        transcriptStatus: safeText(video.transcript_status || run.transcript_status) || 'unavailable',
        socialCount: socials.length,
        videoUrl: watchUrl,
      });

      // Hand the result to the vanilla page, which owns the Video Details
      // panel and the Extract tables underneath this form.
      document.dispatchEvent(
        new CustomEvent(YOUTUBE_ACQUIRED_EVENT, { detail: { result, run } })
      );

      const mediaInfo = (body.media || null) as { job_id?: string; status?: string; error?: string } | null;
      if (includeMedia) {
        if (mediaInfo?.job_id) {
          setMedia({ status: safeText(mediaInfo.status) || 'queued', progress: 0, mp4: null, mp3: null, error: '' });
          pollMedia(mediaInfo.job_id, watchUrl, safeText(video.id), Date.now(), MEDIA_POLL_FIRST_MS);
        } else {
          setMedia({
            status: 'failed',
            progress: 0,
            mp4: null,
            mp3: null,
            error:
              safeText(mediaInfo?.error) ||
              'The media worker is not configured — add it under Settings > APIs.',
          });
        }
      }

      notify('YouTube acquire complete');
    } catch (err) {
      setError((err as Error)?.message || 'Acquisition failed.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [videoUrl, topic, captureContact, includeMedia, pollMedia, stopPolling]);

  const mediaRunning = media.status === 'queued' || media.status === 'running';

  return (
    <form
      className="yt-acquire-panel"
      onSubmit={(event) => {
        event.preventDefault();
        void acquire();
      }}
    >
      <div className="yt-acquire-row">
        <label htmlFor="ytAcquireVideoUrl">YouTube Video</label>
        <input
          id="ytAcquireVideoUrl"
          className="hero-action-input yt-acquire-input"
          type="text"
          value={videoUrl}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube Video"
          aria-invalid={urlLooksWrong || undefined}
          onChange={(event) => {
            setVideoUrl(event.target.value);
            if (error) setError('');
          }}
        />
      </div>

      {urlLooksWrong ? (
        <p className="yt-acquire-hint yt-acquire-hint-warn">
          Not a YouTube video link yet — paste the URL straight from the address bar.
        </p>
      ) : null}

      <div className="acquire-web-hero-options-row">
        <details className="hanging-details acquire-web-advanced-details youtube-miner-compact-advanced-details">
          <summary>Advanced</summary>
          <div className="standard-form-grid yt-acquire-advanced-grid">
            <label htmlFor="ytAcquireTopic">Topic</label>
            <select
              id="ytAcquireTopic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            >
              <option value="">No topic</option>
              {topics.map((item) => (
                <option key={String(item.id)} value={topicLabel(item)}>
                  {topicLabel(item)}
                </option>
              ))}
            </select>

            <label>Options</label>
            <div className="yt-acquire-checks">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  className="standard-form-checkbox"
                  checked={includeMedia}
                  onChange={(event) => setIncludeMedia(event.target.checked)}
                />{' '}
                Download .mp4 and .mp3 files
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  className="standard-form-checkbox"
                  checked={captureContact}
                  onChange={(event) => setCaptureContact(event.target.checked)}
                />{' '}
                Save the creator as a contact
              </label>
            </div>
          </div>
        </details>
      </div>

      <button
        type="submit"
        className="btn btn-primary acquire-web-acquire-btn"
        disabled={busy || !normalizedUrl}
      >
        {busy ? 'Acquiring…' : 'Acquire Video'}
      </button>

      {error ? <p className="yt-acquire-error">{error}</p> : null}

      {summary ? (
        <div className="yt-acquire-result">
          <p className="yt-acquire-result-title">{summary.title}</p>
          <ul className="yt-acquire-result-list">
            {summary.channel ? <li>Creator: {summary.channel}</li> : null}
            <li>
              Transcript:{' '}
              {summary.transcriptStatus === 'found' ? 'captured' : summary.transcriptStatus}
            </li>
            {summary.hashtags ? <li>Hashtags: {summary.hashtags}</li> : null}
            <li>
              {summary.socialCount
                ? `${summary.socialCount} social account${summary.socialCount === 1 ? '' : 's'} found`
                : 'No social accounts found'}
            </li>
          </ul>
          <p className="yt-acquire-hint">Full details are in the Extract section below.</p>
        </div>
      ) : null}

      {media.status ? (
        <div className="yt-acquire-media">
          {mediaRunning ? (
            <p className="yt-acquire-hint">
              Downloading video and audio… {media.progress ? `${media.progress}%` : ''} This runs on
              the worker and can take a few minutes — you can leave this page.
            </p>
          ) : null}

          {media.status === 'done' ? (
            <ul className="yt-acquire-media-links">
              {media.mp4?.url ? (
                <li>
                  <a href={media.mp4.url} target="_blank" rel="noopener noreferrer">
                    Download .mp4
                  </a>{' '}
                  <span className="muted">{formatBytes(media.mp4.bytes || 0)}</span>
                </li>
              ) : null}
              {media.mp3?.url ? (
                <li>
                  <a href={media.mp3.url} target="_blank" rel="noopener noreferrer">
                    Download .mp3
                  </a>{' '}
                  <span className="muted">{formatBytes(media.mp3.bytes || 0)}</span>
                </li>
              ) : null}
            </ul>
          ) : null}

          {media.status === 'failed' ? (
            <p className="yt-acquire-error">
              Media download failed: {media.error || 'unknown error'}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

export default YoutubeVideoAcquirePanel;
