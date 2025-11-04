# Contributing to AWS Community Content Hub

We love your input! We want to make contributing to this project as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to sync code, track issues and feature requests, and accept pull requests.

### Pull Requests

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

### Branch Protection Rules

- `main` branch is protected
- All changes must go through pull requests
- At least 1 approval required from code owners
- Status checks must pass before merging
- Branch must be up-to-date before merging

## Development Guidelines

### Code Style

This project follows strict coding standards:

- **TypeScript**: All code must be in TypeScript with strict mode enabled
- **ESLint**: Follow the project's ESLint configuration
- **Prettier**: Code formatting is handled by Prettier
- **Tests**: Maintain >80% code coverage

### Testing Requirements

We follow Test-Driven Development (TDD):

1. **Write tests first**: Before implementing new features
2. **Test behavior, not implementation**: Focus on what the code should do
3. **Test types**:
   - Unit tests for business logic
   - Integration tests for database/external API interactions
   - Contract tests for API endpoints
   - E2E tests for critical user journeys

#### Test Structure

```typescript
describe('Feature Name', () => {
  describe('when specific condition', () => {
    it('should do expected behavior', async () => {
      // Arrange: Set up test data
      // Act: Execute the behavior
      // Assert: Verify outcomes
    });
  });
});
```

### Architecture Principles

- **Serverless-first**: Use AWS Lambda and managed services
- **Clean Architecture**: Separate business logic from infrastructure
- **SOLID principles**: Follow object-oriented design principles
- **DRY**: Don't repeat yourself, but avoid premature abstractions
- **YAGNI**: You aren't gonna need it - implement only what's required

### Database Guidelines

- **Migrations**: All schema changes must have migrations
- **Transactions**: Use database transactions for data consistency
- **Query optimization**: Always consider query performance
- **Indexing**: Add appropriate indexes for query patterns
- **Constraints**: Use database constraints for data integrity

### Security Best Practices

- **No hardcoded secrets**: Use environment variables or AWS Secrets Manager
- **Input validation**: Validate all user inputs
- **SQL injection prevention**: Use parameterized queries
- **Authentication**: All API endpoints must be authenticated (except public search)
- **Authorization**: Implement granular permissions based on content visibility

## Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(search): add semantic search using pgvector

Add vector similarity search alongside existing full-text search.
Combines results using weighted scoring algorithm.

Closes #123
```

```
fix(auth): prevent unauthorized access to private content

Add proper visibility checks in content query filters.
Users can now only see content based on their badges and permissions.
```

## Environment Setup

### Prerequisites

- Node.js 18+
- Docker (for local database)
- AWS CLI configured
- Git

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start local database: `docker-compose up -d`
4. Run migrations: `npm run db:migrate`
5. Start development servers:
   ```bash
   npm run dev:backend    # Backend
   npm run dev:frontend   # Frontend
   ```

### Running Tests

```bash
# All tests
npm test

# Backend workspace
npm run test --workspace=src/backend
npm run test --workspace=src/backend -- --coverage

# Frontend workspace
npm run test --workspace=src/frontend
npm run test --workspace=src/frontend -- --coverage
```

### Code Quality Checks

Before submitting a PR, ensure these pass:

```bash
npm run lint          # ESLint
npm run typecheck     # TypeScript
npm test              # All tests
npm run build         # Build check
```

## File Organization

```
src/
├── backend/
│   ├── lambdas/          # Lambda function handlers
│   ├── repositories/     # Database access layer
│   ├── services/         # Business logic
│   ├── types/            # Backend-specific types
│   └── utils/            # Utility functions
├── frontend/
│   ├── components/       # React components
│   ├── pages/            # Next.js pages
│   ├── hooks/            # Custom React hooks
│   ├── utils/            # Frontend utilities
│   └── styles/           # CSS/styling
├── shared/
│   ├── types/            # Shared TypeScript types
│   └── utils/            # Shared utilities
└── infrastructure/
    ├── lib/              # CDK constructs and stacks
    ├── bin/              # CDK app entry point
    └── test/             # Infrastructure tests

tests/
├── backend/              # Backend unit/integration tests
├── frontend/             # Frontend component tests
├── infrastructure/       # CDK infrastructure tests
└── e2e/                  # End-to-end tests
```

## Issue Reporting

### Bug Reports

Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node.js version, etc.)
- Screenshots if applicable

### Feature Requests

Include:

- Problem statement (what you're trying to solve)
- Proposed solution
- Alternative solutions considered
- Additional context

## Code of Conduct

### Our Pledge

We pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Our Standards

Examples of behavior that contributes to creating a positive environment include:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

## Performance Considerations

When contributing, keep these performance targets in mind:

- API response times <500ms (p95)
- Search queries <1s (p95)
- Database queries optimized with proper indexing
- Lambda cold start impact minimized
- Frontend bundle size kept reasonable

## Documentation Requirements

All contributions should include appropriate documentation:

- **API changes**: Update OpenAPI spec
- **New features**: Update README and create docs/ files
- **Configuration changes**: Update environment variable documentation
- **Architecture changes**: Create or update ADRs (Architecture Decision Records)

## Getting Help

- Check existing issues and discussions
- Join our community discussions
- Review the project documentation
- Ask questions in issues (use the "question" label)

## License

By contributing, you agree that your contributions will be licensed under the same MIT License that covers the project.

## Recognition

Contributors will be recognized in our README file and release notes. We appreciate all contributions, no matter how small!

---

Thank you for contributing to the AWS Community Content Hub!
