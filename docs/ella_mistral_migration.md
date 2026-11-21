# Migration plan — Ella conversation to the Mistral API (Agents toolkit)

Goal: move the hand-rolled agent loop in `services/backend/src/agent/mistral.js` onto Mistral's hosted **Agents API / Agents SDK** (`mistralai`), keeping the mock mode for offline demos.

---

## Current state

| Piece | Where | Notes |
|---|---|---|
| Hand-rolled tool loop (max 3 rounds, `fetch` to `/v1/chat/completions`) | `agent/mistral.js` `runAgent()` | Real mode only when `MISTRAL_API_KEY` set |
| Mock keyword FSM calling the same tools | `agent/mistral.js` `mockAgent()` | Offline demo path — keep |
| System prompt (persona, safety, tool rules) | `agent/prompt.js` | Reuse verbatim as agent instructions |
| Tool defs + execution: `predict`, `log_checkin`, `send_alert` | `agent/tools.js` | Keep implementations; change transport only |
| History: in-memory `Map<patientId, last 20 msgs>` | `server.js` (`conversations`) | Replace with server-side conversation/session |
| Endpoint | `POST /chat/:patient` → `{ reply, toolCalls }` | Keep contract for the mobile app |

## Target architecture

```
mobile app → POST /chat/:patient → backend → Mistral Agents API/SDK
                                              │ agent (system prompt = prompt.js)
                                              │ tools: predict / log_checkin / send_alert
                                              ▼
                                     backend executes tool fns (tools.js)
                                     results fed back → model replies
```

- **Agent**: create once on La Plateforme (`client.beta.agents` / Agents SDK `Agent`) with `mistral-large-latest` (or `MISTRAL_MODEL`) and the `SYSTEM_PROMPT` as instructions.
- **Tools**: register the three functions; keep the actual logic in `tools.js` (SDK runs your Python/JS functions and you return results; Agents API uses connectors or client-side function calls fed back into the conversation).
- **Conversations**: one per `patientId` (`conversation_id` / SDK session with `get_history()` + `start_session(history=...)`). Drop the in-memory `Map`.

## Migration steps

1. **Prep**: add `mistralai` dependency (or keep zero-dep and use the Agents REST API `/v1/conversations` with `agent_id`). Set `MISTRAL_API_KEY`, `MISTRAL_MODEL` in env.
2. **Create the agent** with the existing `SYSTEM_PROMPT`; attach tool schemas matching `tools.js` defs.
3. **Port the loop**: replace the manual `for round < 3` loop with the SDK harness / conversation entries. Mind SDK specifics: tool results must be `role: "tool"` with `tool_call_id` (SDK ≥ 0.0.11; `role: "user"` is silently ignored), and `function.arguments` is a JSON string — parse before executing.
4. **Keep `tools.js` unchanged** — `execute(name, args, deps)` stays the single tool implementation for both mock and real modes.
5. **Swap history storage**: `conversations.get(patientId)` → `conversation_id` per patient (persist beyond 20 msgs if desired; SDK: `session` history).
6. **Keep the `/chat/:patient` contract** (`{ reply, toolCalls }`) so `apps/mobile` needs no changes. `toolCalls` can be derived from the SDK's recorded function-call entries.
7. **Keep mock mode**: no API key → `mockAgent()` unchanged, same tools. `/health` still reports `agent: mock|mistral`.
8. **Resilience**: exponential backoff on 429s (rate limits hit multi-turn tool loops fast); timeout per round; fall back to mock on repeated failure so the demo never dies.

## Validation checklist

- [ ] `MISTRAL_API_KEY` set → `/health` shows `mistral`; unset → `mock`
- [ ] Meal/sleep/exercise/stress messages each trigger `log_checkin` + `predict` (check `toolCalls` in `/chat` response)
- [ ] Forecast shifts after a check-in (log before/after `/forecast` values)
- [ ] Fault beats: drift/occlusion → agent replies `alarm_only` framing + asks how the patient feels
- [ ] Multi-turn: conversation resumes across requests for the same `patientId` (server-side history)
- [ ] No-key run: identical demo path as today (mock FSM, same tools)
- [ ] 429 handling: backoff works, no crash

## Risks

- **Rate limits** on multi-turn tool loops → backoff + round cap (keep max 3).
- **Tool-message format drift** across SDK versions → pin `mistralai` version, keep tests.
- **Cost/latency** vs mock → keep mock as default when key absent.
- **Demo safety** → rollback plan: unset `MISTRAL_API_KEY`; code path returns to today's behavior instantly.
