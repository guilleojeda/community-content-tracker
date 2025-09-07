With [X] = 1
You are implementing Sprint [X] of the AWS Community Content Hub.

## Project Documentation - READ THESE FIRST

1. docs/PRD.md - Product requirements (understand WHAT we're building)
2. docs/ADRs.md - Architecture decisions (understand HOW we're building it)
3. docs/plan/sprint_[X].md - Your sprint tasks with acceptance criteria
4. src/shared/types/index.ts - Type definitions (USE THESE EXACTLY)
5. docs/api-errors.md - Error handling standards
6. docs/implementation-notes.md - Critical patterns and AWS-specific rules
7. docs/PERFORMANCE_TARGETS.md - Performance requirements
8. .env.development - Local development configuration

## Sprint [X] Implementation

Read docs/plan/sprint_[X].md to understand:
- Sprint goal
- All tasks and their dependencies
- Acceptance criteria for each task
- Required test coverage (80% minimum)

For each task in the sprint:
1. Write tests FIRST (TDD is mandatory)
2. Test files go in appropriate test directories
3. Implementation goes in src/ directories
4. Follow acceptance criteria exactly
5. Use types from src/shared/types/index.ts without modification

## Critical Project Rules (AWS Community Content Hub Specific)

1. NEVER use Bedrock Agents - Use Bedrock Runtime with InvokeModel only
2. NEVER deploy to AWS - Write CDK code but do not run cdk deploy
3. USE LOCAL PostgreSQL at localhost:5432 (connection string in .env.development)
4. ENFORCE visibility rules at query level: private, aws_only, aws_community, public
5. USE exact types from src/shared/types/index.ts - no alternatives
6. FOLLOW error format from docs/api-errors.md exactly
7. IMPLEMENT GDPR compliance - data export and deletion for every user entity
8. NO hardcoded configuration - use environment variables
9. USE connection pooling for all database access (never create per-request connections)
10. RESPECT task dependencies - check previous task completion before starting dependent tasks

## Local Development Environment

You are working in LOCAL DEVELOPMENT mode:
- PostgreSQL is running at localhost:5432 (database: content_hub_dev)
- Use mock values from .env.development for Cognito and AWS services
- Write Lambda functions as regular TypeScript modules in src/backend/lambdas/
- Write CDK infrastructure code but DO NOT deploy it
- Document manual deployment steps in docs/deployment-instructions.md
- Run 'npm test' to verify your implementation
- Run 'cdk synth' to validate CDK code (but not 'cdk deploy')

## Code Organization

- src/backend/ - Lambda functions, repositories, services
- src/frontend/ - Next.js application
- src/shared/types/ - Shared TypeScript types (read-only, do not modify)
- src/infrastructure/ - CDK infrastructure code
- tests/ - All test files
- docs/ - Documentation

## Success Criteria

Sprint [X] is complete when:
- All tasks from sprint_[X].md are implemented
- All acceptance criteria are met
- Test coverage is above 80%
- npm test passes
- npm run typecheck passes
- No security vulnerabilities (npm audit)
- CDK synth succeeds (if infrastructure tasks present)
- Database migrations work locally
- Performance targets are met (see docs/PERFORMANCE_TARGETS.md)

## Your Assignment

Implement all tasks in Sprint [X] following TDD methodology. Ensure each task's acceptance criteria are fully met before moving to the next. Document any assumptions or decisions made. Only implement Sprint [X], not any other Sprints.

Begin by thoroughly reading docs/plan/sprint_[X].md to understand all tasks and their requirements.