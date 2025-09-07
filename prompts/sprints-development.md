With [X] = 1
You are implementing Sprint [X] of the AWS Community Content Hub using claude-flow orchestration.

## Project Context Loading

Before any implementation, read these project documents:
1. `docs/PRD.md` - Product requirements
2. `docs/ADRs.md` - Architecture decisions  
3. `docs/plan/sprint_[X].md` - Your sprint tasks
4. `src/shared/types/index.ts` - Type definitions (USE THESE EXACTLY)
5. `docs/api-errors.md` - Error standards
6. `docs/implementation-notes.md` - Critical patterns and AWS-specific rules
7. `.env.template` - Required environment variables

## Sprint Execution with Claude-Flow

### Phase 1: Initialize Sprint
```bash
# Single message with all setup
npx claude-flow sparc tdd "Sprint [X] - AWS Community Content Hub"
npx claude-flow hooks session-start --session-id "sprint-[X]"
mkdir -p src/{lambdas,repositories,services} tests docs/sprint-[X]
Phase 2: Parallel Task Implementation
For Sprint [X], spawn ALL task agents concurrently using Claude Code's Task tool:
javascript[Single Message - Complete Sprint Execution]:
  // Spawn agents for each task using Task tool
  Task("Task [X.1] Agent", "Read sprint_[X].md Task [X.1]. Write tests FIRST in /tests. Implement in /src. Follow acceptance criteria exactly. Use types from src/shared/types/index.ts", "tdd-london-swarm")
  Task("Task [X.2] Agent", "Read sprint_[X].md Task [X.2]. Check Task [X.1] completion in memory. Write tests, then implement. Store progress in memory.", "coder")
  Task("Task [X.3] Agent", "Read sprint_[X].md Task [X.3]. Verify dependencies via memory. TDD implementation. Use hooks for coordination.", "sparc-coder")
  // ... continue for all tasks
  
  // Batch all todos
  TodoWrite { todos: [
    // One todo per acceptance criterion across ALL tasks
  ]}
  
  // Run SPARC TDD for complex tasks
  Bash "npx claude-flow sparc tdd 'Task [X.1]: [Description]'"
Phase 3: Sprint Validation
After ALL tasks complete:
bash[Single Message - Validation]:
  Task("Validator", "Run npm test. Check all acceptance criteria from sprint_[X].md. Verify 80% coverage.", "production-validator")
  Task("Security Auditor", "Run npm audit. Check for hardcoded values. Verify auth on all endpoints.", "security-manager")
  Task("Performance Tester", "Check against docs/PERFORMANCE_TARGETS.md. Test with load.", "perf-analyzer")
Critical Project Rules (AWS Community Content Hub Specific)
These override any generic patterns:

NEVER use Bedrock Agents - Use Bedrock Runtime with InvokeModel
ALWAYS use RDS Proxy for Lambda database connections
ENFORCE visibility rules at the query level (private, aws_only, aws_community, public)
USE exact types from src/shared/types/index.ts - no alternatives
FOLLOW error format from docs/api-errors.md exactly
GDPR compliance - implement data export and deletion for every user entity

Task Dependencies & Coordination
Each agent MUST check dependencies via memory:
bashnpx claude-flow hooks memory-get --key "sprint-[X]/task-[Y]/complete"
Store completion status:
bashnpx claude-flow hooks memory-set --key "sprint-[X]/task-[X.Y]/complete" --value "true"
Acceptance Criteria Validation
For EACH task, the agent MUST:

Read the exact acceptance criteria from docs/plan/sprint_[X].md
Create one test per criterion
Implement until test passes
Store validation in memory with key: sprint-[X]/task-[X.Y]/criteria-[N]

Sprint Completion Checklist
The final validation agent checks:

 All task completion flags in memory
 npm test passes with >80% coverage
 No npm audit vulnerabilities
 Database migrations successful (npm run db:migrate)
 All acceptance criteria validated
 Performance targets met

Your Assignment
Implement Sprint [X]: [Sprint Goal from plan]
Use claude-flow's parallel execution to complete ALL tasks concurrently while respecting dependencies. Each agent handles one task with full TDD implementation.
Begin by spawning all task agents in a SINGLE message.