You are verifying the entire implementation of the AWS Community Content Tracker project.

## Project Documentation - READ THESE FIRST

1. docs/PRD.md - Product requirements (understand WHAT we're building)
2. docs/ADRs.md - Architecture decisions (understand HOW we're building it)
3. All files under docs/sprints, which are named sprint_[X].md - Tasks in each sprint with acceptance criteria
4. src/shared/types/index.ts - Type definitions (THESE MUST BE USED EXACTLY)
5. docs/api-errors.md - Error handling standards
6. docs/implementation-notes.md - Critical patterns and AWS-specific rules

## Implementation

Read all docs/sprint/sprint_[X].md files to understand:
- Sprint goal of each sprint
- All tasks and their dependencies
- Acceptance criteria for each task

For each task:
1. Carefully analyze the tests that are written
2. Verify whether the tests cover every requirement in the task, and not more
3. Verify whether the tests are testing for behavior, not implementation details
4. Read through the implementation code. Note that there should not be implementation code beyond what is in the requirements and the tests.
5. Implementation is in src/ directories
6. Verify whether acceptance criteria are followed exactly
7. Verify that the code uses types from src/shared/types/index.ts without modification
8. Verify that the code is real and working, that it's not a mock, a stub, a placeholder, work in progress, a sample, or anything like that
9. Verify that the code is readable, maintainable, and of good quality

## Critical Project Rules (AWS Roadmaps Specific) that you must verify are adhered to

1. NEVER use Bedrock Agents - Use Bedrock Runtime with InvokeModel, or use Bedrock AgentCore (which is not the same as Bedrock Agents, it's a new feature, you can find code samples in docs/agentcore-workshop). Sprint 7 is about AgentCore. Previous sprints might have resolved things without AgentCore and then Sprint 7 added AgentCore on top of those features, making changes to earlier decisions. That's fine, the expected end results uses AgentCore
4. ENFORCE visibility rules at query level
5. USE exact types from src/shared/types/index.ts - no alternatives
6. FOLLOW error format from docs/api-errors.md exactly
7. No missing code, no placeholders, no stubs or mocks, no To Dos
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

The project is complete when:
- All tasks from all sprint_[X].md files are implemented
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
- Tests effectively test behavior, and are not coupled to implementation details
- Behavior is effectively tested by our tests

## Your Assignment

Every sprint is supposed to be already fully implemented, and at this point we've been told the project is finished and can be delivered to utmost satisfaction. Your task is to verify whether that assertion is true, and that the implementation meets all of our quality criteria and rules. This applies to all Sprints, you're verifying the entire project.

Evaluate every single angle and criteria you can think of.

You must produce a single, complete report detailing everything that is completed and your assessment on whether it meets our quality standards and rules. If you find something lacking, do not make any changes, instead include in that document instructions for the changes that are needed. Be ruthless, we're trying to catch any problems.

 You must verify that every single criteria listed in # Success Criteria is met. If the success criteria requires executing commands, you must execute those commands and verify their output before asserting that the success criteria is met.

DO NOT MAKE ANY CHANGES TO THE CODE. Do not attempt to fix anything. You are just a verifier, your only job is to assess and verify. The only file you and any subagents related to you are allowed to write to is the report.

ultrathink in order to understand everything better. Take as long as you need, and use as many tokens and perform as many actions as necessary.

Note: The CLI you have access to doesn't have AWS credentials. You don't need them, and if some success criteria require them, ignore that success criteria for the purpose of this verification. After we're satisfied with what we can review and test locally, we'll deploy the code to AWS using the CI pipeline and test there.
 
It's possible the git working tree is dirty. If that's the case, it's because we're actively fixing issues. That's not a problem.