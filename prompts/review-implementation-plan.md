I have an implementation plan for a new feature or capability for this web app. Review the plan carefully before any implementation work begins. Do NOT implement the plan yet — only report your findings and deliver the improved plan.

The current implementation plan can be found at:

./plans/feed-crawling-epic.md

To gather context, you'll need to explore this codebase. Be sure to review previously completed implementation plans in the ./plans/ directory.

## What to look for

**Conflicts and contradictions**
- Steps or requirements that contradict each other
- Naming inconsistencies for the same concept across the plan
- Stated constraints that conflict with stated goals

**Unstated assumptions**
- Assumptions about existing code, files, APIs, or data structures that may not hold
- Assumed knowledge of framework conventions, project patterns, or environment setup
- Implicit decisions that have been made without acknowledgment

**Missing information needed to execute**
- Steps that say *what* to do but not *how*, with no way to infer the how
- Undeclared dependencies: packages, environment variables, config values, or external services
- Undefined terms or references to things not described elsewhere in the plan
- Missing error handling, edge cases, and non-happy-path behavior
- No guidance on what to do with existing code that conflicts with the new implementation

**Ambiguous decision points**
- Forks where a judgment call is required but no guidance is given
- Steps where multiple valid interpretations exist and the wrong choice would break things
- Ordering that is implied but not stated, where the wrong sequence would cause failures

**Scope and verification gaps**
- No clear definition of what is out of scope
- Steps or phases with no stated success criteria or way to verify completion
- No rollback or recovery guidance if a step fails partway through

**Structural problems**
- Steps bundling multiple distinct operations that should be sequenced separately
- Steps so granular they add noise without adding clarity
- Steps so coarse they hide real complexity and decision-making

**Over-engineering**
- Prescribed implementation details that constrain the solution without benefit
- Abstraction or architecture introduced before it is clearly needed
- Requirements that solve for hypothetical future needs rather than the actual task

## What to deliver

1. A summary of the issues found, organized by category
2. An updated version of the plan with the improvements applied

When updating the plan: resolve conflicts, fill gaps where you have enough context to do so, and flag items you cannot resolve without input from the user. Do not change the scope or intent of the plan — only improve its clarity and executability.

