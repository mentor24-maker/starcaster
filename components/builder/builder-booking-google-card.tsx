/**
 * The Booking Manager's Google Calendar card (SC-913, slice 5 of the booking
 * calendar): whether this project's Google Calendar is connected, as whom, and
 * the Connect / Disconnect buttons.
 *
 * Connect opens Google's sign-in in its own small window. The window comes
 * back to /api/connections/google_calendar/callback, which saves the
 * connection and tells this window (postMessage) that it is done; this card
 * then reads the status back from the server. The message is only a nudge to
 * re-read: what the card shows is always what the server says, so a message
 * from anywhere else can at most cause one extra read. Closing the window
 * early re-reads too. With pop-ups blocked the sign-in happens in this tab
 * and comes back to this page with the outcome on the hash
 * (readGoogleConnectReturn).
 *
 * No token ever reaches this screen: GET /api/booking/google answers with the
 * account's email and the connection's state only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  googleStatusLine,
  normalizeGoogleStatus,
  readGoogleConnectReturn,
  type GoogleCalendarStatus,
} from "@/lib/booking-manager";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

type Props = {
  api: Api;
  /** Called after a connect or disconnect, so the bookings list can refresh. */
  onChanged?: () => void;
};

export const GOOGLE_CONNECTION_MESSAGE = "starcaster-connection";

export function BookingGoogleCard({ api, onChanged }: Props) {
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const popupWatch = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setStatus(normalizeGoogleStatus(await api<unknown>("/google")));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Whether Google Calendar is connected could not be read.");
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  // Back from Google in this same tab (pop-ups were blocked): show how it went,
  // then take it off the address so a reload does not show it again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const back = readGoogleConnectReturn(window.location.hash);
    if (!back) return;
    if (back.ok) setNote(back.message); else setError(back.message);
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${back.hash}`);
    } catch { /* the message still shows */ }
    onChanged?.();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; provider?: string; ok?: boolean; message?: string } | null;
      if (!data || data.type !== GOOGLE_CONNECTION_MESSAGE || data.provider !== "google_calendar") return;
      if (data.ok) { setNote(String(data.message || "Google Calendar is connected.")); setError(""); }
      else { setError(String(data.message || "Google Calendar was not connected.")); setNote(""); }
      setBusy(false);
      void load();
      onChanged?.();
    }
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (popupWatch.current !== null) window.clearInterval(popupWatch.current);
    };
  }, [load, onChanged]);

  async function connect() {
    setError("");
    setNote("");
    setBusy(true);
    // Opened inside the click, before any await, or the browser blocks it as a pop-up.
    const popup = window.open("", "starcaster-google-calendar", "width=520,height=700");
    try {
      // Where to come back to if the sign-in has no pop-up to report to.
      const started = await api<{ authorizeUrl: string }>("/google/connect", {
        method: "POST",
        body: JSON.stringify({ returnTo: window.location.href }),
      });
      if (!started?.authorizeUrl) throw new Error("Google did not give a sign-in address.");
      if (popup && !popup.closed) {
        popup.location.href = started.authorizeUrl;
        if (popupWatch.current !== null) window.clearInterval(popupWatch.current);
        popupWatch.current = window.setInterval(() => {
          if (!popup.closed) return;
          if (popupWatch.current !== null) window.clearInterval(popupWatch.current);
          popupWatch.current = null;
          setBusy(false);
          void load();
        }, 800);
      } else {
        // Pop-ups blocked: go there in this tab instead; Google's sign-in
        // comes back to this page with the outcome on the address.
        window.location.href = started.authorizeUrl;
      }
    } catch (e) {
      popup?.close();
      setBusy(false);
      setError(e instanceof Error ? e.message : "Google Calendar could not be connected.");
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const done = await api<{ revokedAtProvider: boolean; notRevoked?: string[] }>("/google", { method: "DELETE" });
      setNote(done.revokedAtProvider
        ? "Google Calendar is disconnected, and Google has withdrawn Starcaster's access."
        : `Google Calendar is disconnected here. ${(done.notRevoked || []).filter(Boolean)[0] || ""}`.trim());
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google Calendar could not be disconnected.");
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
      await load();
    }
  }

  return (
    <section className="booking-manager-section booking-manager-google" aria-label="Google Calendar">
      <h4 className="booking-manager-section-title">Google Calendar</h4>
      {loadError ? (
        <>
          <p className="booking-manager-error" role="alert">{loadError}</p>
          <button type="button" className="booking-manager-btn" onClick={() => void load()}>Try Again</button>
        </>
      ) : !status ? (
        <p className="booking-manager-muted">Checking Google Calendar…</p>
      ) : (
        <>
          <p className={status.needsAttention ? "booking-manager-error-inline" : "booking-manager-hint"} data-google-status>
            {googleStatusLine(status)}
          </p>
          {status.connected ? (
            <p className="booking-manager-hint">
              Every new booking goes on this Google Calendar with a Google Meet link, and the times you are busy there are hidden from visitors.
            </p>
          ) : null}
          <div className="booking-manager-google-actions">
            {!status.connected || status.needsAttention ? (
              <button
                type="button"
                className="booking-manager-btn booking-manager-btn-primary"
                disabled={busy || !status.configured}
                onClick={() => void connect()}
              >
                {busy ? "Waiting for Google…" : status.connected || status.needsAttention ? "Connect Again" : "Connect Google Calendar"}
              </button>
            ) : null}
            {status.connected || status.needsAttention ? (
              confirmDisconnect ? (
                <span className="booking-manager-confirm">
                  Disconnect Google Calendar? New bookings will get no Meet link.
                  <button type="button" className="booking-manager-btn booking-manager-btn-danger" disabled={busy} onClick={() => void disconnect()}>
                    Disconnect
                  </button>
                  <button type="button" className="booking-manager-btn" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Keep It</button>
                </span>
              ) : (
                <button type="button" className="booking-manager-btn" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
              )
            ) : null}
          </div>
        </>
      )}
      {error ? <p className="booking-manager-error" role="alert">{error}</p> : null}
      {note ? <p className="booking-manager-saved" role="status">{note}</p> : null}
    </section>
  );
}
