/** Host header value for local Next.js dev (`npm run dev`). */
export const LOCAL_DEV_HOST = "localhost:3000";

export function isLocalDevHost(host: string | null | undefined): boolean {
  return host?.toLowerCase() === LOCAL_DEV_HOST;
}
