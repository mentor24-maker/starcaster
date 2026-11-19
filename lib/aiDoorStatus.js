'use strict';

/**
 * The HTTP status a caller of the AI door (lib/aiClient.js generate) should
 * answer with when the door says no. One rule, so the five Acquire/outreach
 * callers moved onto the door in AI switch 4 (SC-846) answer alike:
 *
 *   no_provider     400  nothing is set up to answer (was "API key not configured")
 *   provider_error  the provider's own status, else 502
 *   no_answer       504  the provider never answered
 *   bad_json        502  it answered, but not with what was asked for
 *   anything else   500
 */
function doorFailureStatus(result) {
  const code = result && result.code;
  if (code === 'no_provider') return 400;
  if (code === 'provider_error') return Number(result.status) || 502;
  if (code === 'no_answer') return 504;
  if (code === 'bad_json') return 502;
  return 500;
}

module.exports = { doorFailureStatus };
