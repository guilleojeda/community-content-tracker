With [X] = 7
You are verifying the implementation of Sprint [X] of the AWS Community Content Hub project.

## Project Documentation - READ THESE FIRST

1. docs/PRD.md - Product requirements (understand WHAT we're building)
2. docs/ADRs.md - Architecture decisions (understand HOW we're building it)
3. docs/plan/sprint_[X].md - Your sprint tasks with acceptance criteria
4. src/shared/types/index.ts - Type definitions (THESE MUST BE USED EXACTLY)
5. docs/api-errors.md - Error handling standards
6. docs/implementation-notes.md - Critical patterns and AWS-specific rules

## Sprint [X] Review

Read docs/plan/sprint_[X].md to understand:
- Sprint goal
- All tasks and their dependencies
- Acceptance criteria for each task
- Required test coverage (90% minimum)

For each task in the sprint:
1. Carefully analyze the tests that are written
2. Verify whether the tests cover every requirement in the task, and not more
3. Verify whether the tests are testing for behavior, not implementation details
4. Read through the implementation code. Note that there should not be implementation code beyond what is in the requirements and the tests.
5. Implementation is in src/ directories
6. Verify whether acceptance criteria are followed exactly
7. Verify that the code uses types from src/shared/types/index.ts without modification
8. Verify that the code is real (not a placeholder, a mock or a To Do) and actually fulfills the requirements in a real way

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
12. Tests must test behavior, not implementation details

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
- Tests are verified to be test behavior, not implementation details

## Your Assignment

Sprint [X] is supposed to be already fully implemented, and the quality is decent. However, I have doubts about how we're testing it. Your job is to review all the tests, and make sure that:
- They are testing for the expected behaviors, according to the tasks and acceptance criteria
- They are testing behaviors, not implementation details
- They are not coupled to implementation details, and allow for code refactors
- They are implemented following testing best practices
- They are using mocks and stubs in the correct way, and only when appropriate
- They are not fragile and dependent on environment configurations
- They offer complete coverage of functionalities

You must produce a single, complete report detailing everything that is completed and your assessment on whether it meets our quality standards and rules. If you find something lacking, do not make any changes, instead include in that document instructions for the changes that are needed.

 You must verify that every single criteria is met. If the success criteria requires executing commands, you must execute those commands and verify their output before asserting that the success criteria is met.

DO NOT MAKE ANY CHANGES TO THE CODE. Do not attempt to fix anything. You are just a verifier, your only job is to assess and verify. The only file you and any subagents related to you are allowed to write to is the report.

Begin by thoroughly reading docs/plan/sprint_[X].md to understand all tasks and their requirements. ultrathink in order to understand everything better.