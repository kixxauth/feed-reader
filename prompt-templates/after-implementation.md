Implementation of the plan is complete. Before this session ends, work through each of the following.

## 1. Cleanup pass

Review all code touched during implementation and remove anything that shouldn't survive into the final commit:
- Commented-out code
- Debug logging or temporary console output
- Workarounds or hacks that were meant to be temporary
- TODO comments added during implementation (either resolve them or convert them into tracked follow-up items per section 4 below)

## 2. Stale references

Identify any existing documentation, inline comments, or architectural notes that described the old behavior and are now inaccurate or misleading. Either update them in place or flag them explicitly if they require broader discussion before changing.

## 3. Close the loop on the plan

If implementation deviated from the plan in any way — a different approach taken, scope deferred, something discovered that changed the direction — annotate the plan to reflect what actually happened and why. The plan file should not be left as a misleading record of intent.

## 4. Follow-up items

During implementation you may have noticed things that were out of scope but worth tracking. Produce a short list of:
- Deferred edge cases or error handling
- Related areas of the codebase that look fragile or inconsistent
- Small improvements that weren't part of the ask but would be worthwhile
- Anything intentionally left incomplete and what finishing it would require

These should be concrete enough to act on later, not vague observations.

## 5. Documentation

Write documentation capturing what was built and what future contributors need to understand.

Focus on:
- A concise summary of what changed — files, components, dependencies
- Decisions made during implementation that aren't visible from reading the code alone — especially why a particular approach was chosen over alternatives
- Patterns established here that should be followed in future related work
- Environment variables, config values, or setup steps required
- Known limitations and unhandled edge cases

For each piece of documentation, decide where it should live: inline comments, a module-level doc, an update to MANUAL.md, and put it there.

Write for a future developer or AI assistant with no context about this session. Assume they can read the code — focus on the *why*, the tradeoffs, and anything that isn't visible from the code alone.

The MANUAL.md doc is for users, admins, and developer operations, so write for them there.

## 6. Smoke test checklist

Produce a plain-language checklist of the specific things a human should manually verify to confirm the implementation is working correctly. Cover the happy path, key edge cases, and any integration points with other parts of the system.

---

Work through these in order and report back with the results of each section before the session closes.