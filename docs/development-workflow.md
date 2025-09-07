# Development Workflow for AI Agents

## Starting a New Task:

1. **Read the task description completely**
2. **Check dependencies** - ensure prerequisite tasks are complete
3. **Review relevant ADRs** - understand architectural decisions
4. **Write tests first** - TDD is mandatory
5. **Implement the feature**
6. **Verify all acceptance criteria**
7. **Update documentation**
8. **Create PR with proper description**

## Branch Naming:
- Feature: `feature/task-X.Y-brief-description`
- Bug fix: `fix/issue-description`
- Hotfix: `hotfix/critical-issue`

## Commit Messages:
[Task X.Y] Brief description

Detailed point 1
Detailed point 2

Closes #issue-number

## PR Description Template:
```markdown
## Task
[Task X.Y: Task Title]

## Changes
- What was implemented
- Key decisions made
- Any deviations from plan

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] All acceptance criteria met
- [ ] Documentation updated
- [ ] No hardcoded values
- [ ] Error handling implemented
File Naming Conventions:

Lambda handlers: content-create.handler.ts
Repositories: user.repository.ts
Services: embedding.service.ts
Tests: *.test.ts or *.spec.ts
React components: PascalCase.tsx
Utilities: kebab-case.ts

