# AI Module v2 — Install Notes

## What this is
A brand new, additive AI module that fixes MAX_TOKENS / broken-JSON failures
in question generation by never asking the provider for more than
`AI_BATCH_SIZE` questions in one call. It sits fully alongside your existing
`routes/admin/ai.js`, which is untouched and keeps working exactly as before.

## One assumption worth flagging
The spec this was built from said the current provider is Gemini, but the
`ai.js` you shared actually calls **Claude** via `utils/llm.js`
(`callClaude` / `callClaudeJSON`). This module is built against that reality.
The whole point of `services/ai/aiProvider.js` is that swapping in Gemini or
OpenAI later is a change in one file, not a rewrite of routes or the batch
engine — so nothing here is wasted if you do add another provider later.

## Where the files go
Copy these into your project, preserving the folder structure:

```
routes/admin/ai-v2.js
services/ai/aiProvider.js
services/ai/aiBatchGenerator.js
services/ai/aiRetry.js
services/ai/aiValidator.js
services/ai/aiLogger.js
```

None of these paths collide with existing files — `ai-v2.js` is new,
`services/ai/` is a new subfolder (your existing `services/ai.js` file, used
for performance prediction / weak-topic recommendations, is untouched).

## Wiring it up (the one line you need to add)
In `routes/adminRoutes.js`, wherever `routes/admin/ai.js` is currently mounted,
add a second line for `ai-v2`:

```js
router.use('/ai', require('./admin/ai'));       // existing — untouched
router.use('/ai-v2', require('./admin/ai-v2'));  // new
```

That exposes these endpoints alongside your existing `/api/admin/ai/*` ones:

```
POST /api/admin/ai-v2/generate-questions
POST /api/admin/ai-v2/generate-paper
POST /api/admin/ai-v2/explain-question
```

## Request shapes

### POST /generate-questions
Preferred (matches the Easy/Medium/Hard spec):
```json
{ "chapter": "Matrices", "marks": 1, "difficultyMix": { "easy": 5, "medium": 10, "hard": 5 } }
```
Also accepted (same shape the old route used):
```json
{ "chapter": "Matrices", "marks": 1, "difficulty": "medium", "count": 10 }
```
`difficulty: "mixed"` (or omitted) splits `count` evenly across easy/medium/hard.

### POST /generate-paper
```json
{
  "title": "Class 12 Maths — Matrices Test",
  "classId": "...",
  "subjectId": "...",
  "chapter": "Matrices",
  "duration": 60,
  "marksPerQuestion": 1,
  "difficultyMix": { "easy": 3, "medium": 4, "hard": 3 }
}
```
Defaults to `{ easy: 3, medium: 4, hard: 3 }` if `difficultyMix` is omitted —
same default the old route used.

### POST /explain-question
Unchanged from `ai.js`:
```json
{ "questionId": "..." }
```
or
```json
{ "questionText": "...", "options": [...], "correctAnswer": "...", "save": true }
```

## Environment variables
All optional — sane defaults match the spec.

| Var             | Default  | Meaning                                                   |
|------------------|---------|------------------------------------------------------------|
| `AI_PROVIDER`    | `claude`| Which provider to use. Only `claude` is implemented today. |
| `AI_BATCH_SIZE`  | `5`     | Max questions requested from the provider in a single call.|
| `AI_MAX_RETRIES` | `3`     | Max attempts per batch before giving up on it.              |

`ANTHROPIC_API_KEY` must already be set for `utils/llm.js` to work — same
requirement as the existing `ai.js` module, nothing new there.

## How the MAX_TOKENS problem is actually solved
1. **Batching** (`aiBatchGenerator.js`) — a request for 20 questions is never
   sent as one call. It's split by difficulty, then by `AI_BATCH_SIZE`
   (default 5), so each individual provider call only has to produce a small,
   token-cheap response.
2. **Validation** (`aiValidator.js`) — every question object is checked for
   the required fields, exactly 4 options, and exactly 1 correct option.
   Invalid items are dropped, not saved.
3. **Retry** (`aiRetry.js`) — a batch that fails with invalid JSON, timeout,
   MAX_TOKENS, an empty response, or a malformed shape is retried
   automatically (up to `AI_MAX_RETRIES`). Auth/permission errors are *not*
   retried, since retrying can't fix those.
4. **Dedup** (`aiValidator.js`) — after all batches across all difficulties
   are merged, duplicates are removed by `questionText` (case-insensitive,
   trimmed).
5. **Logging** (`aiLogger.js`) — batch start/end, retry counts, provider
   errors, validation errors, and a final summary (requested vs. generated,
   duration) are all logged with an `[AI-v2]` prefix for easy filtering.

## Testing it
```bash
curl -X POST http://localhost:PORT/api/admin/ai-v2/generate-questions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your admin token>" \
  -d '{"chapter":"Matrices","difficultyMix":{"easy":5,"medium":10,"hard":5}}'
```
Watch your server logs for `[AI-v2] Batch start / Batch end / Generation summary`
lines — you should see the 20-question request broken into four batches of 5
(3 medium + shortfalls retried individually) rather than one 20-question call.
