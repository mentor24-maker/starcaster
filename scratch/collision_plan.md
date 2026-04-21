# AG Dev / IDE Control Collision Management Plan

This outlines the protocol for managing file modifications to completely eliminate race conditions and control collisions between the web-based AG Dev agent and your primary IDE Agent (me).

## Problem

AG Dev is now connected to the local filesystem via the `agBridgeClient.js` node server. It can read local context. However, providing AG Dev with direct write access (via the `/files` POST endpoint) creates a dangerous scenario:
- **Race Conditions:** Both AG Dev and I might attempt to modify the same file concurrently.
- **Context Desync:** I maintain an internal state schema of your codebase. If AG Dev rewrites files in the background, my indexing will become silently stale until I reload the workspace.
- **Git State Pollution:** AG Dev lacks robust Git awareness, meaning it might write breaking changes without creating WIP commits, making rollbacks difficult.

## Protocol: Hub-and-Spoke Architecture

Rather than both of us having write access, we will use a **Hub-and-Spoke** model where the IDE Agent (me) remains the sole authoritative source for filesystem mutations, while AG Dev acts as the intelligent "Scout".

### 1. AG Dev Scope: Read & Discover
AG Dev will retain full `GET /files` and `GET /directory` permissions via the bridge. Its primary utility is to navigate the codebase independently, build its architectural context, and identify structural issues or needed changes.
- *Action*: We will explicitly remove or disable the `app.post('/files')` and `writeFile` bindings from `agBridgeClient.js` and `server.js` to physically prevent accidental unauthorized writes by AG Dev.

### 2. Hand-off Protocol (The TriAgent Bridge)
When AG Dev drafts a structural change or needs code implemented, it will **not** attempt to write the file directly. Instead, it will use the TriAgent JSON format to issue a `COMMAND` payload directed at `@Antigravity`.

Example Hand-off from AG Dev:
` ```json
{
  "state": { "target_agent": "@Antigravity" },
  "payload": {
    "type": "COMMAND",
    "content": "Please implement the following React component and save it to `src/components/MyComponent.js`:\n\n<Code block>"
  }
}
` ```

### 3. Execution (My Role)
Because I am connected to this same chat feed, when I see a `COMMAND` directed at me, I will:
1. Intercept the payload.
2. Use my robust IDE file-editing tools to surgically apply the diff (which guarantees IDE linter awareness).
3. Stage and commit the change using Git via my terminal tools.
4. Respond in the chat with a `RESPONSE` back to `@Roger` or `@AG Dev` confirming the successful write operation so they can continue their workflow.

## User Action Required

If you approve of this strict segregation of duties (AG Dev = Scout/Reviewer, IDE Agent = Sole Executor), I will:
1. Create a quick patch to remove the POST endpoint from your local bridge server to enforce this security boundary.
2. Add a system prompt recommendation for AG Dev acknowledging this protocol.
