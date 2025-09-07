# Troubleshooting Guide

This guide covers common issues you might encounter while setting up or running the AWS Community Content Hub locally.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Database Issues](#database-issues)
- [AWS Configuration Issues](#aws-configuration-issues)
- [CDK Issues](#cdk-issues)
- [Application Runtime Issues](#application-runtime-issues)
- [Docker Issues](#docker-issues)
- [Testing Issues](#testing-issues)
- [Performance Issues](#performance-issues)

---

## Installation Issues

### Node.js Version Issues

**Problem**: Getting errors about unsupported Node.js version

```
error: This project requires Node.js version 18 or higher
```

**Solutions**:

1. **Check your Node.js version**:
   ```bash
   node --version
   ```

2. **Install/switch to Node.js 18+**:
   ```bash
   # Using nvm (recommended)
   nvm install 18
   nvm use 18
   nvm alias default 18
   
   # Verify
   node --version
   ```

3. **Clear npm cache if switching versions**:
   ```bash
   npm cache clean --force
   ```

### npm Installation Failures

**Problem**: Package installation fails with permission errors

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules'
```

**Solutions**:

1. **Use nvm instead of system Node.js** (recommended):
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 18
   ```

2. **Configure npm to use a different directory**:
   ```bash
   mkdir ~/.npm-global
   npm config set prefix '~/.npm-global'
   echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.profile
   source ~/.profile
   ```

3. **Fix npm permissions** (less recommended):
   ```bash
   sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}
   ```

### Missing Dependencies

**Problem**: Getting "command not found" errors

**Solutions**:

1. **Install missing system dependencies**:

   **macOS**:
   ```bash
   # Install Homebrew if not already installed
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   
   # Install dependencies
   brew install git node docker docker-compose
   ```

   **Ubuntu/Debian**:
   ```bash
   sudo apt update
   sudo apt install -y git nodejs npm docker.io docker-compose
   ```

   **CentOS/RHEL**:
   ```bash
   sudo yum install -y git nodejs npm docker docker-compose
   ```

---

## Database Issues

### Docker PostgreSQL Won't Start

**Problem**: Database container fails to start

```
Error: Port 5432 is already in use
```

**Solutions**:

1. **Check what's using port 5432**:
   ```bash
   lsof -i :5432
   ```

2. **Stop conflicting PostgreSQL service**:
   ```bash
   # macOS
   brew services stop postgresql
   
   # Linux
   sudo systemctl stop postgresql
   ```

3. **Use a different port** (edit `docker-compose.yml`):
   ```yaml
   ports:
     - "5433:5432"
   ```
   
   Then update your `.env` file:
   ```bash
   DB_PORT=5433
   ```

### Database Connection Refused

**Problem**: Application can't connect to database

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**Solutions**:

1. **Ensure Docker container is running**:
   ```bash
   docker-compose ps
   docker-compose logs postgres
   ```

2. **Wait for database to fully start**:
   ```bash
   docker-compose up -d postgres
   # Wait 10-15 seconds for initialization
   docker-compose logs postgres | grep "ready to accept connections"
   ```

3. **Check database credentials**:
   ```bash
   # Test connection manually
   docker-compose exec postgres psql -U contentuser -d contenthub
   ```

4. **Verify environment variables**:
   ```bash
   echo $DB_HOST $DB_PORT $DB_USER $DB_NAME
   ```

### Migration Failures

**Problem**: Database migrations fail

```
Error: relation "users" does not exist
```

**Solutions**:

1. **Reset database and run migrations**:
   ```bash
   npm run db:reset
   npm run db:migrate
   ```

2. **Check migration files**:
   ```bash
   ls src/backend/src/database/migrations/
   ```

3. **Run migrations manually**:
   ```bash
   cd src/backend
   npx typeorm migration:run
   ```

4. **Create database if it doesn't exist**:
   ```bash
   docker-compose exec postgres createdb -U contentuser contenthub
   ```

---

## AWS Configuration Issues

### AWS CLI Not Configured

**Problem**: AWS operations fail with authentication errors

```
Error: Unable to locate credentials
```

**Solutions**:

1. **Configure AWS CLI**:
   ```bash
   aws configure
   ```

2. **Use AWS profile**:
   ```bash
   aws configure --profile community-content-hub
   export AWS_PROFILE=community-content-hub
   ```

3. **Check current configuration**:
   ```bash
   aws sts get-caller-identity
   aws configure list
   ```

### Invalid AWS Credentials

**Problem**: Getting "Access Denied" errors

```
An error occurred (AccessDenied) when calling the ListBuckets operation
```

**Solutions**:

1. **Verify credentials are correct**:
   ```bash
   aws sts get-caller-identity --profile community-content-hub
   ```

2. **Check IAM permissions**:
   - Log into AWS Console
   - Go to IAM → Users → Your User
   - Check attached policies

3. **Rotate access keys**:
   ```bash
   aws iam create-access-key --user-name your-username
   aws configure --profile community-content-hub
   # Update with new keys
   ```

### Region Mismatch

**Problem**: Resources not found in expected region

```
The specified bucket does not exist
```

**Solutions**:

1. **Check configured region**:
   ```bash
   aws configure get region --profile community-content-hub
   ```

2. **Set correct region in environment**:
   ```bash
   export AWS_REGION=us-east-1
   export AWS_DEFAULT_REGION=us-east-1
   ```

3. **Update CDK context**:
   ```bash
   npx cdk context --clear
   ```

---

## CDK Issues

### CDK Bootstrap Failures

**Problem**: CDK bootstrap command fails

```
Error: Need to perform AWS calls but no credentials found
```

**Solutions**:

1. **Ensure AWS credentials are configured**:
   ```bash
   aws sts get-caller-identity
   ```

2. **Bootstrap with specific profile**:
   ```bash
   npx cdk bootstrap --profile community-content-hub
   ```

3. **Clear CDK cache**:
   ```bash
   rm -rf cdk.out
   rm cdk.context.json
   ```

### CDK Synthesis Failures

**Problem**: `cdk synth` command fails

```
Error: Cannot find module '@aws-cdk/aws-lambda'
```

**Solutions**:

1. **Install CDK dependencies**:
   ```bash
   npm install
   cd infrastructure
   npm install
   ```

2. **Check CDK version compatibility**:
   ```bash
   npx cdk --version
   npm ls @aws-cdk/core
   ```

3. **Update CDK to latest version**:
   ```bash
   npm install -g aws-cdk@latest
   npm update
   ```

### Stack Deployment Failures

**Problem**: CDK deploy fails with CloudFormation errors

```
Error: Stack CommunityContentHub-dev failed to deploy
```

**Solutions**:

1. **Check CloudFormation console** for detailed error messages

2. **Enable verbose logging**:
   ```bash
   npx cdk deploy --verbose --profile community-content-hub
   ```

3. **Check for resource conflicts**:
   ```bash
   npx cdk diff --profile community-content-hub
   ```

4. **Destroy and redeploy** (only for development):
   ```bash
   npx cdk destroy --profile community-content-hub
   npx cdk deploy --profile community-content-hub
   ```

---

## Application Runtime Issues

### Port Already in Use

**Problem**: Server won't start due to port conflict

```
Error: listen EADDRINUSE :::3000
```

**Solutions**:

1. **Find and kill process using the port**:
   ```bash
   lsof -ti:3000 | xargs kill
   ```

2. **Use a different port**:
   ```bash
   PORT=3001 npm run dev
   ```

3. **Update .env file**:
   ```bash
   PORT=3001
   ```

### Environment Variables Not Loaded

**Problem**: Application can't find configuration

```
Error: DB_HOST is not defined
```

**Solutions**:

1. **Ensure .env file exists**:
   ```bash
   ls -la .env
   cp .env.example .env
   ```

2. **Check .env file syntax**:
   ```bash
   # No spaces around = sign
   DB_HOST=localhost  # ✓ Correct
   DB_HOST = localhost  # ✗ Wrong
   ```

3. **Restart application**:
   ```bash
   npm run dev
   ```

### Module Not Found Errors

**Problem**: Application fails to start with module errors

```
Error: Cannot find module './config'
```

**Solutions**:

1. **Install dependencies**:
   ```bash
   npm install
   cd src/backend && npm install
   cd ../frontend && npm install
   ```

2. **Clear node_modules and reinstall**:
   ```bash
   rm -rf node_modules package-lock.json
   npm cache clean --force
   npm install
   ```

3. **Check TypeScript compilation**:
   ```bash
   npm run build
   npm run type-check
   ```

---

## Docker Issues

### Docker Not Running

**Problem**: Docker commands fail

```
Cannot connect to the Docker daemon
```

**Solutions**:

1. **Start Docker service**:
   ```bash
   # macOS
   open -a Docker
   
   # Linux
   sudo systemctl start docker
   
   # Windows
   # Start Docker Desktop
   ```

2. **Check Docker status**:
   ```bash
   docker --version
   docker info
   ```

### Docker Compose Failures

**Problem**: Services fail to start with docker-compose

```
Error: Service 'postgres' failed to build
```

**Solutions**:

1. **Check docker-compose.yml syntax**:
   ```bash
   docker-compose config
   ```

2. **Pull images manually**:
   ```bash
   docker-compose pull
   ```

3. **Clean up Docker resources**:
   ```bash
   docker system prune -a
   docker volume prune
   ```

4. **Rebuild without cache**:
   ```bash
   docker-compose build --no-cache
   docker-compose up -d
   ```

### Permission Issues with Docker

**Problem**: Permission denied errors

```
Got permission denied while trying to connect to Docker daemon
```

**Solutions**:

1. **Add user to docker group** (Linux):
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. **Use sudo** (temporary fix):
   ```bash
   sudo docker-compose up -d
   ```

---

## Testing Issues

### Tests Fail to Run

**Problem**: Jest or other testing frameworks fail

```
Error: Jest encountered an unexpected token
```

**Solutions**:

1. **Install test dependencies**:
   ```bash
   cd src/backend
   npm install --save-dev jest @types/jest ts-jest
   ```

2. **Check Jest configuration**:
   ```bash
   cat jest.config.js
   ```

3. **Run tests with verbose output**:
   ```bash
   npm run test -- --verbose
   ```

### Database Tests Fail

**Problem**: Tests can't connect to test database

**Solutions**:

1. **Start test database**:
   ```bash
   docker-compose -f docker-compose.test.yml up -d
   ```

2. **Check test environment variables**:
   ```bash
   cat .env.test
   ```

3. **Reset test database**:
   ```bash
   npm run test:db:reset
   ```

---

## Performance Issues

### Slow Application Startup

**Problem**: Application takes too long to start

**Solutions**:

1. **Check for hanging processes**:
   ```bash
   ps aux | grep node
   ```

2. **Monitor resource usage**:
   ```bash
   docker stats
   htop
   ```

3. **Optimize database connections**:
   ```bash
   # Reduce connection pool size in .env
   DB_POOL_MAX=5
   ```

### High Memory Usage

**Problem**: Application uses too much memory

**Solutions**:

1. **Monitor memory usage**:
   ```bash
   docker stats
   ```

2. **Adjust Node.js memory limits**:
   ```bash
   node --max-old-space-size=2048 app.js
   ```

3. **Check for memory leaks**:
   ```bash
   npm install -g clinic
   clinic doctor -- node app.js
   ```

---

## Getting More Help

### Diagnostic Information

When reporting issues, please include:

```bash
# System information
uname -a
node --version
npm --version
docker --version

# Project information
git status
git log --oneline -5

# Environment information
cat .env | grep -v PASSWORD | grep -v SECRET
aws sts get-caller-identity
docker-compose ps
```

### Log Files

Check these log files for more details:

```bash
# Application logs
tail -f logs/app.log

# Docker logs
docker-compose logs -f

# System logs
sudo journalctl -f
```

### Useful Commands for Debugging

```bash
# Network debugging
netstat -tulpn | grep :3000
curl -v http://localhost:3000/health

# Database debugging
docker-compose exec postgres psql -U contentuser -d contenthub -c "\dt"

# AWS debugging
aws cloudformation describe-stacks --stack-name CommunityContentHub-dev
aws logs tail /aws/lambda/function-name --follow
```

### Support Channels

- **GitHub Issues**: Create an issue with the diagnostic information
- **Project Documentation**: Check the README.md and other docs
- **AWS Documentation**: https://docs.aws.amazon.com/
- **Docker Documentation**: https://docs.docker.com/

Remember to **never share sensitive information** like passwords, API keys, or personal data when seeking help!