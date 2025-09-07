You are implementing Sprint [X] of the AWS Community Content Hub using claude-flow orchestration.

## Project Context Loading
Before any implementation, read these project documents:
1. docs/PRD.md - Product requirements
2. docs/ADRs.md - Architecture decisions  
3. docs/plan/sprint_[X].md - Your sprint tasks
4. src/shared/types/index.ts - Type definitions (USE THESE EXACTLY)
5. docs/api-errors.md - Error standards
6. docs/implementation-notes.md - Critical patterns and AWS-specific rules
7. .env.template - Required environment variables

## Sprint Execution with Claude-Flow

### Phase 1: Initialize Sprint
Single message with all setup:
- npx claude-flow sparc tdd 'Sprint [X] - AWS Community Content Hub'
- npx claude-flow hooks session-start --session-id sprint-[X]
- mkdir -p src/{lambdas,repositories,services} tests docs/sprint-[X]

### Phase 2: Parallel Task Implementation
For Sprint [X], spawn ALL task agents concurrently using Claude Code's Task tool:

[Single Message - Complete Sprint Execution]:
  // Read sprint_[X].md to determine how many tasks exist, then spawn agents for each
  // Example pattern - adjust based on actual tasks in sprint_[X].md:
  Task('Task [X].1 Agent', 'Read sprint_[X].md Task [X].1. Write tests FIRST in /tests. Implement in /src. Follow acceptance criteria exactly. Use types from src/shared/types/index.ts', 'tdd-london-swarm')
  Task('Task [X].2 Agent', 'Read sprint_[X].md Task [X].2. Check Task [X].1 completion in memory. Write tests, then implement. Store progress in memory.', 'coder')
  Task('Task [X].3 Agent', 'Read sprint_[X].md Task [X].3. Verify dependencies via memory. TDD implementation. Use hooks for coordination.', 'sparc-coder')
  // Continue for all tasks in the sprint
  
  // Batch all todos - create one todo per acceptance criterion across ALL tasks
  TodoWrite { todos: [
    // Generate todos based on the tasks in sprint_[X].md
  ]}
  
  // Run SPARC TDD for complex tasks
  Bash 'npx claude-flow sparc tdd \"Sprint [X] tasks implementation\"'

### Phase 3: Sprint Validation
After ALL tasks complete:
[Single Message - Validation]:
  Task('Validator', 'Run npm test. Check all acceptance criteria from sprint_[X].md. Verify 80% coverage.', 'production-validator')
  Task('Security Auditor', 'Run npm audit. Check for hardcoded values. Verify no AWS credentials in code.', 'security-manager')
  Task('Performance Tester', 'Check against docs/PERFORMANCE_TARGETS.md. Test with load if applicable.', 'perf-analyzer')

## Critical Project Rules (AWS Community Content Hub Specific)

These override any generic patterns:
1. NEVER use Bedrock Agents - Use Bedrock Runtime with InvokeModel
2. NEVER deploy to AWS - Write CDK code but do not run cdk deploy
3. USE LOCAL PostgreSQL - Connection string in .env.development
4. ENFORCE visibility rules at the query level (private, aws_only, aws_community, public)
5. USE exact types from src/shared/types/index.ts - no alternatives
6. FOLLOW error format from docs/api-errors.md exactly
7. GDPR compliance - implement data export and deletion for every user entity

## Task Dependencies & Coordination

Each agent MUST check dependencies via memory:
- npx claude-flow hooks memory-get --key sprint-[X]/task-Y/complete

Store completion status:
- npx claude-flow hooks memory-set --key sprint-[X]/task-[X].Y/complete --value true

## Acceptance Criteria Validation

For EACH task, the agent MUST:
1. Read the exact acceptance criteria from docs/plan/sprint_[X].md
2. Create one test per criterion
3. Implement until test passes
4. Store validation in memory with key: sprint-[X]/task-[X].Y/criteria-N

## Local Development Mode

IMPORTANT: Work in LOCAL DEVELOPMENT mode only:
- Use mock AWS services where needed
- Use local PostgreSQL (should be running at localhost:5432)
- Do NOT attempt AWS deployments
- Write CDK code but do NOT deploy
- Document deployment steps in docs/deployment-instructions.md

## Sprint Completion Checklist

The final validation agent checks:
- All task completion flags in memory
- npm test passes with >80% coverage
- No npm audit vulnerabilities
- Database migrations successful (npm run db:migrate)
- All acceptance criteria validated
- CDK synth runs successfully (but no deploy) if infrastructure tasks present
- Performance targets met for implemented features

## Your Assignment

Implement Sprint [X] as defined in docs/plan/sprint_[X].md

First, read the sprint file to understand:
1. The sprint goal
2. Number of tasks
3. Task dependencies
4. Acceptance criteria for each task

Then spawn an agent for each task, ensuring dependencies are respected through memory coordination.

Use claude-flow's parallel execution to complete ALL tasks concurrently while respecting dependencies. Each agent handles one task with full TDD implementation.

Begin by reading sprint_[X].md, then spawning all task agents in a SINGLE message.