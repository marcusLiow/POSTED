# Posted — Plan: Cross-NPC Relationship Graph (Propagation Layer)

## Goal

Right now each NPC's relationship score (`S.johnRel`, `S.drakeRel`, `S.alexRel`) moves in total isolation — being cruel to Drake has zero effect on John or Alex, even though they're all classmates who would plausibly notice or hear about it. This plan adds a lightweight **graph propagation layer** on top of the existing hearts system so relationships ripple outward realistically, without needing a second ML model or duplicating the AI-judgment work already planned elsewhere.

## How this relates to the open-ended-input plan

This is a companion to `posted-ai-input-plan.md` (open-ended input + AI-judged grading), not a competing approach. The two slot together as two different stages of the same pipeline:

- **Stage 1 — per-NPC AI judgment** (the other plan): a Claude call reads the player's actual text and returns a structured `relationship_delta` for the NPC directly addressed. This *is* the tonality/intent detection — holistic, closeness-aware, no keyword matching. No separate classifier is needed on top of this.
- **Stage 2 — cross-NPC propagation** (this plan): takes that already-computed `relationship_delta` and pushes a smaller, decayed ripple to *other* NPCs, based on a hand-authored social graph and whether the originating moment was public or private.

The other plan explicitly defers "cross-NPC awareness" to a later phase (see its "Per-NPC swarm agents" section: *"Start isolated, add cross-awareness later... John never 'knows' what Drake decided"*). Its proposed mechanism for that later phase is giving each NPC-agent visibility into a shared world-state log inside its prompt. This plan is a concrete, cheaper alternative for the same problem: instead of feeding more context into every LLM call (more tokens, harder to keep consistent), model the ripple explicitly as a graph and compute it in plain code — no extra API calls, no extra latency.

**One-line insight for the write-up:** a single LLM call per NPC already gives AI-judged tonality per relationship. The gap isn't better tonality detection — it's that relationships don't talk to each other. A graph-propagation layer over the existing hearts state closes that gap for free, and doubles as the mechanical enforcement of the game's own core insight that "public and private both count — but differently."

## Design

**Graph**
- Nodes: `John`, `Drake`, `Alex` (extendable to the full 31-day cast later)
- Node state: the existing `rel` score, 0–5 — no new data needed
- Edges: a static, hand-authored table of how socially connected each pair of NPCs is (not learned — see stretch goal below)

**Direct vs. secondary deltas**
- The *direct* delta (the NPC actually addressed) is untouched — still whatever the existing grading logic (or, later, the Stage 1 AI call) computes.
- The *secondary* delta is new: `delta * social_weight[source][neighbor] * visibility_weight`, added on top of the neighbor's existing score, clamped 0–5.

**Visibility is the key lever.** A public post ripples at full weight; a private DM or face-to-face apology ripples much less (0.15×) — a mechanical version of the game's own stated design pillar that public and private moments both matter, just differently.

## What was implemented (this build)

Added to `Posted-Demo.html`, right after the `S` state declaration:

```js
const SOCIAL_GRAPH = {
  john:  { drake:0.5,  alex:0.25 },
  drake: { john:0.5,   alex:0.2  },
  alex:  { john:0.25,  drake:0.2 }
};
const VISIBILITY_WEIGHT = { public:1, private:0.15 };
function propagateRelationship(sourceKey, delta, visibility){
  const neighbors = SOCIAL_GRAPH[sourceKey] || {};
  const vis = VISIBILITY_WEIGHT[visibility] ?? 0;
  if(!delta || !vis) return;
  Object.entries(neighbors).forEach(([nKey, weight])=>{
    const prop = nKey+"Rel";
    const ripple = delta * weight * vis;
    S[prop] = Math.max(0, Math.min(5, S[prop] + ripple));
  });
}
```

Wired into the three existing relationship-update sites, with no change to grading, coins, or presentation:

| Site | Direct target | Visibility | Reasoning |
|---|---|---|---|
| `answer(kind)` — John's public confrontation | John | `public` | Everyone saw the post; the confrontation reaction is public knowledge |
| `showSummary(kind)` — Drake's outcome | Drake | `private` only if `kind==="amends"` (a face-to-face apology), else `public` | "Bad"/"good" outcomes are just the public post playing out; only the in-person apology is a private moment |
| `showReflection()` — Alex's DM reply | Alex | `private` | Day 2 is explicitly a private DM |

The social-graph weights (`0.5`, `0.25`, `0.2`, etc.) are placeholder guesses for the demo, not tuned or learned — flagged as such below.

## Stretch goal: a real GNN

Once there's a corpus of logged playthroughs (relationship states + outcomes over many players), the hand-tuned `SOCIAL_GRAPH` weights could instead be *learned* — e.g. a small GraphSAGE-style model (PyTorch Geometric) trained to predict how a delta on one NPC should propagate to others, using real player-outcome data instead of guessed weights. This is the same reasoning the other plan gives for deferring its multiplayer persona ML work: the real ML opportunity is in accumulated gameplay data, not at build time. Not being built now — captured here so the direction isn't lost.

## Adjacent idea: RAG for memory, SEA-LION for Singlish (no training needed either way)

A second groupmate raised two more directions worth capturing here, both relevant to the AI-judgment layer (`posted-ai-input-plan.md`) rather than to the propagation layer itself — but both reinforce the same theme: nothing in this project needs a model trained from scratch.

**RAG — fits the "persistent memory across days" pillar, not tonality detection.** RAG retrieves relevant context and feeds it into a prompt; it doesn't classify tone any better than the judgment call already planned. Its real value is solving the memory problem the other plan already flags as needed regardless of architecture: over 31 days you can't stuff full history into every prompt (cost/context blow-up). Instead, embed a short summary of each day's significant events, store them, and retrieve only the top-k most relevant past events for whichever NPC is judging the current interaction. That's what makes "day 12 notices he's stopped posting about food much" possible without hand-authoring it.

**SEA-LION — a real AI Singapore model family tuned for Southeast Asian languages/code-mixed text, worth testing for Singlish, not urgent yet.** If players type Singlish, a generic model might misread tone (particles like "leh"/"lor"/"sia" shifting the emotional read, sarcasm markers). Recommended sequencing: first test realistic Singlish phrases against the Claude judgment call already being built — Claude's multilingual training often handles this reasonably well already. Only add SEA-LION as a second provider if that test shows real gaps, and if so, use it as a small upstream signal (tone/sentiment read) passed alongside the raw text into the existing Claude prompt, rather than replacing the pipeline.

**Neither needs training.** RAG needs embeddings + retrieval (no training); SEA-LION would be used off-the-shelf via API, same as Claude. Consistent with the "no custom classifier, no custom GNN" direction elsewhere in this doc.

## Risks / things to watch

- **Placeholder weights**: the social graph numbers are authored guesses, not validated against how the ripple actually *feels* in playtesting — expect to retune after a few playthroughs.
- **Compounding drift**: because propagation applies on top of direct deltas every scene, small ripples could accumulate oddly over a 31-day version — worth a bounds/decay check if the cast or day count grows.
- **Depends on Stage 1 semantics**: once the other plan's AI-judged `relationship_delta` replaces the current hardcoded `kind`-based deltas, this layer keeps working unchanged — it only needs *a* delta and *a* visibility, not where the delta came from.
