import re

with open('lib/authStore.js', 'r', encoding='utf-8') as f:
    text = f.read()

replacement = """async function getUserFromSessionToken(tokenInput) {
  const token = safeText(tokenInput);
  if (!token) return { error: 'No token provided' };

  if (useSupabase()) {
    const session = await findSessionByTokenSupabase(token);
    if (!session.ok || !session.row) return { error: 'Session not found in DB', dbData: session };
    const expiresAt = new Date(String(session.row.expires_at || 0)).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { error: 'Session expired', expiresAt, now: Date.now() };

    const userResult = await findUserByIdSupabase(safeText(session.row.user_id));
    if (!userResult.ok || !userResult.row) return { error: 'User not found for session', sessionRow: session.row, userResult };
    return sanitizeUser(userResult.row);
  }

  const now = Date.now();
  const sessions = listSessionsFile();
  const active = sessions.find((row) => safeText(row.token) === token && new Date(String(row.expiresAt || 0)).getTime() > now);
  if (!active) return { error: 'Local session missing or expired', token, sessionsTotal: sessions.length };
  const users = listUsersFile();
  const user = users.find((row) => safeText(row.id) === safeText(active.userId));
  if (!user) return { error: 'Local user missing for session' };
  return sanitizeUser(user);
}"""

# regex replace
text = re.sub(r'async function getUserFromSessionToken[\s\S]+?\}\n', replacement + '\n', text, count=1)
with open('lib/authStore.js', 'w', encoding='utf-8') as f:
    f.write(text)

with open('routes/auth.js', 'r', encoding='utf-8') as f:
    authText = f.read()
authText = authText.replace(
    "if (!user) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;",
    "if (!user || user.error) return sendErr(res, 401, 'Not authenticated: ' + (user ? JSON.stringify(user) : 'null'), { code: 'AUTH_REQUIRED' }), true;"
)
with open('routes/auth.js', 'w', encoding='utf-8') as f:
    f.write(authText)

with open('public/js/core.js', 'r', encoding='utf-8') as f:
    coreText = f.read()

coreText = coreText.replace(
    "if (res.status === 401 && App.auth && typeof App.auth.handleUnauthorized === 'function') {",
    "if (res.status === 401 && App.auth && typeof App.auth.handleUnauthorized === 'function') {\\n      if (body?.error?.message) App.notify(body.error.message, true);"
)
# Fix python literal newline replacement
coreText = coreText.replace("\\n", "\n")
with open('public/js/core.js', 'w', encoding='utf-8') as f:
    f.write(coreText)
