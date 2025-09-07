# Quick Reference

## Key Commands:
```bash
# Local development
npm run dev           # Start local server
npm run test         # Run tests
npm run db:migrate   # Run migrations
npm run db:seed      # Seed test data

# Deployment
npm run deploy:dev   # Deploy to dev
npm run deploy:prod  # Deploy to production

# Utilities
npm run generate:types    # Generate TypeScript types
npm run check:security   # Security audit
npm run analyze:bundle   # Bundle analysis

Key Endpoints:

POST /auth/register
POST /auth/login
GET /content
POST /content
GET /search
GET /profile/{username}
POST /admin/badges

Database Access:
bash# Dev database
psql $DATABASE_URL

# Production (via bastion)
ssh bastion
psql -h aurora-cluster.region.rds.amazonaws.com -U admin -d content_hub