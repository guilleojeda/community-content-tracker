With [X] = 5
You are verifying the implementation of Sprint [X] of the AWS Community Content Hub project.

## Project Documentation - READ THESE FIRST

1. docs/PRD.md - Product requirements (understand WHAT we're building)
2. docs/ADRs.md - Architecture decisions (understand HOW we're building it)
3. docs/plan/sprint_[X].md - Your sprint tasks with acceptance criteria
4. src/shared/types/index.ts - Type definitions (THESE MUST BE USED EXACTLY)
5. docs/api-errors.md - Error handling standards
6. docs/implementation-notes.md - Critical patterns and AWS-specific rules

## Sprint [X] Implementation

Read docs/plan/sprint_[X].md to understand:
- Sprint goal
- All tasks and their dependencies
- Acceptance criteria for each task
- Required test coverage (90% minimum)

For each task in the sprint:
1. Carefully analyze the tests that is written
2. Verify whether the tests cover every requirement in the task, and not more
4. Read through the implementation code. Note that there should not be implementation code beyond what is in the requirements and the tests.
5. Implementation is in src/ directories
6. Verify whether acceptance criteria are followed exactly
7. Verify that the code uses types from src/shared/types/index.ts without modification

## Critical Project Rules (AWS Community Content Hub Specific) that you must verify are adhered to

1. NEVER use Bedrock Agents - Use Bedrock Runtime with InvokeModel only
4. ENFORCE visibility rules at query level: private, aws_only, aws_community, public
5. USE exact types from src/shared/types/index.ts - no alternatives
6. FOLLOW error format from docs/api-errors.md exactly
7. IMPLEMENT GDPR compliance - data export and deletion for every user entity
8. NO hardcoded configuration - use environment variables
9. USE connection pooling for all database access (never create per-request connections)
10. RESPECT task dependencies - check previous task completion before starting dependent tasks
11. NEVER use emojis

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
- The code implemented is real, working code, not placeholders
- The code is implemented as specified in the sprint tasks, and the tests test for the specified behavior
- All acceptance criteria are met
- Test coverage is above 90%
- npm test passes
- npm run typecheck passes
- No security vulnerabilities (npm audit)
- If infrastructure tasks are present, npm run build and cdk synth (ran from the src/infrastructure folder) succeed without errors
- Database migrations work locally
- All tests are passing

## Your Assignment

Sprint [X] is supposed to be already fully implemented. Your task is to verify whether that assertion is true, and that the implementation meets all of our quality criteria and rules. This only applies to Sprint [X], not any other Sprints.

You must produce a single, complete report detailing everything that is completed and your assessment on whether it meets our quality standards and rules. If you find something lacking, do not make any changes, instead include in that document instructions for the changes that are needed.

 You must verify that every single criteria listed in # Success Criteria is met. If the success criteria requires executing commands, you must execute those commands and verify their output before asserting that the success criteria is met.

DO NOT MAKE ANY CHANGES TO THE CODE. Do not attempt to fix anything. You are just a verifier, your only job is to assess and verify. The only file you and any subagents related to you are allowed to write to is the report.

Begin by thoroughly reading docs/plan/sprint_[X].md to understand all tasks and their requirements. ultrathink in order to understand everything better.