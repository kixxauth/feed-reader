I have an epic (collection of user stories related to a new feature) for this website. Review these user stories and acceptance criteria, and think about how you would implement them cohesively.

After reviewing the user stories and acceptance criteria in this epic, create an implementation plan document.

Before writing the implementation plan, explore the repository structure and review the relevant source files so that file paths, module names, and technical references in the plan are grounded in the actual codebase.

The epic is located at .

Review all user stories and acceptance criteria, then create an implementation plan and put the plan document in the plans/ directory.

The plan should begin with a brief Implementation Approach section (3–5 sentences) summarizing the overall strategy and any cross-cutting concerns across the stories.

The rest of the document is a TODO list. Break each user story into discrete technical tasks — one task per file change, component, route, or logical unit of work. Each TODO item must follow this exact format:

```
- [ ] **<Short title>**
  - **Story**: <User story ID or title>
  - **What**: <What to build or change, in concrete terms>
  - **Where**: <File path(s) or module(s) to create or modify>
  - **Acceptance criteria**: <Which AC items this task satisfies>
  - **Depends on**: <Item titles this must come after, or "none">
```

Order items so that dependencies come first. Do not group items by story — sequence them by the order they should be implemented.

