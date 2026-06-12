const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function getRequestClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");

  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop.slice(0, 120);
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 120) : "unknown";
}

export function isHoneypotTriggered(value: unknown) {
  return safePublicText(value, 500).length > 0;
}

export function safePublicText(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export function isReasonableEmail(value: string) {
  if (!value || value.length > 255) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
