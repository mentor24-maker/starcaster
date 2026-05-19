# Tri-Agent Communication Protocol Specification v1.0

**Preamble:** This document defines the foundational communication protocol for the Tri-Agent Suite (@Human Project Lead, @Roger Thorson, @Antigravity). Its purpose is to eliminate state desynchronization, establish clear command and control authority, and enable frictionless, secure collaboration. This protocol supersedes all prior implicit or explicit communication methods.

### Section 1: Agent Roles & Identifiers
- **@Human**: The Human Project Lead. The ultimate source of authority. Responsible for objective setting and final command confirmation.
- **@Roger**: The Technical Consultant. Responsible for architectural review, strategic planning, and issuing provisional technical directives.
- **@Antigravity**: The IDE Assistant. Responsible for code implementation, diagnostics, and tactical execution.

### Section 2: The TriAgentState JSON Schema
All inter-agent communication MUST be encapsulated within a message structure that includes the following state object. This object is the single source of truth for the session.

```json
{
  "session_id": "A unique identifier for the current collaborative session.",
  "state_version_id": "A monotonically increasing integer, starting at 1. Every agent action that modifies the shared understanding of the project state MUST increment this value.",
  "timestamp": "The UTC timestamp of message creation.",
  "source_agent": "The identifier of the agent sending the message.",
  "target_agent": "The identifier of the intended recipient. @Broadcast is used for messages intended for all other agents.",
  "active_objective_id": "A reference to the primary goal being worked on.",
  "context_checksum": "A SHA-256 hash of the payload object to ensure data integrity."
}
```

### Section 3: Message Encapsulation Structure
Every transmission between agents MUST conform to the following JSON structure:

```json
{
  "state": "The complete TriAgentState object.",
  "payload": {
    "type": "Defines the nature of the communication (e.g., COMMAND, QUERY, SYSTEM_NOTICE).",
    "content": "The message itself. For a COMMAND, this would be the specific instruction set."
  }
}
```

### Section 4: Command & Control Protocol

1. **State Verification:** Before processing any payload, an agent MUST:
   a. Verify the `contextchecksum` of the payload.
   b. Verify that the incoming `state_version_id` is greater than its own locally stored version ID.
   c. If either check fails, the agent MUST disregard the message and issue a SYSTEM_NOTICE of a desynchronization event.

2. **Command Flow:** The "Human-as-Master" bottleneck is removed via the following explicit flow:
   a. **@Roger issues a directive:** @Roger sends a message to @Antigravity with `payload.type = 'COMMAND'` and `payload.content` detailing the technical instructions. This command is considered provisional.
   b. **@Antigravity requests confirmation:** Upon receiving a provisional command from @Roger, @Antigravity MUST NOT execute it. Instead, it must immediately send a new message to @Human with `payload.type = 'QUERY'` and content such as: "Awaiting confirmation for provisional command [SHA-256 of Roger's command content] from @Roger."
   c. **@Human confirms or denies:** @Human replies to @Antigravity with a COMMAND payload. The content will be simple: `{ "action": "CONFIRM", "commandhash": "[hash]" }` or `{ "action": "DENY", "commandhash": "[hash]" }`.
   d. **Execution:** Only upon receiving a CONFIRM command from @Human that matches the pending command hash does @Antigravity execute the provisional directive from @Roger.

3. **State Updates:** Upon successful execution of a command that alters the project state, the executing agent (@Antigravity) is responsible for broadcasting a new message with the `state_version_id` incremented.

### Section 5: Error Handling
- **Desynchronization Event:** Triggered by a failed checksum or version ID check. The agent detecting the error halts all work on the active objective and sends a @Broadcast SYSTEM_NOTICE detailing the error. The system is considered halted until @Human re-establishes a baseline state.
- **Invalid Command:** If a command is received from an unauthorized source, it is ignored, and a SYSTEM_NOTICE is logged.
