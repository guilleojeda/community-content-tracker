#!/bin/bash

# AWS Community Content Hub - First Time Setup Script
# This script automates the initial setup process for new developers

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_deps=()
    
    if ! command_exists node; then
        missing_deps+=("Node.js (v18 or higher)")
    else
        node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$node_version" -lt 18 ]; then
            missing_deps+=("Node.js v18+ (current: $(node --version))")
        fi
    fi
    
    if ! command_exists npm; then
        missing_deps+=("npm")
    fi
    
    if ! command_exists docker; then
        missing_deps+=("Docker")
    fi
    
    if ! command_exists docker-compose; then
        missing_deps+=("Docker Compose")
    fi
    
    if ! command_exists git; then
        missing_deps+=("Git")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing prerequisites:"
        for dep in "${missing_deps[@]}"; do
            echo "  - $dep"
        done
        log_error "Please install missing prerequisites and run this script again."
        echo ""
        echo "Installation guides:"
        echo "  Node.js: https://nodejs.org/en/download/"
        echo "  Docker: https://docs.docker.com/get-docker/"
        echo "  Git: https://git-scm.com/downloads"
        exit 1
    fi
    
    log_success "All prerequisites are installed"
}

# Setup environment configuration
setup_environment() {
    log_info "Setting up environment configuration..."
    
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            log_success "Created .env file from template"
            log_warning "Please edit .env file with your specific configuration"
        else
            log_error ".env.example file not found"
            exit 1
        fi
    else
        log_warning ".env file already exists, skipping creation"
    fi
}

# Install dependencies
install_dependencies() {
    log_info "Installing project dependencies..."
    
    # Root dependencies
    log_info "Installing root dependencies..."
    npm install
    
    # Backend dependencies
    if [ -d "src/backend" ]; then
        log_info "Installing backend dependencies..."
        cd src/backend
        npm install
        cd ../..
    fi
    
    # Frontend dependencies (if exists)
    if [ -d "src/frontend" ]; then
        log_info "Installing frontend dependencies..."
        cd src/frontend
        npm install
        cd ../..
    fi
    
    # Infrastructure dependencies (if exists)
    if [ -d "infrastructure" ]; then
        log_info "Installing infrastructure dependencies..."
        cd infrastructure
        npm install
        cd ..
    fi
    
    log_success "Dependencies installed successfully"
}

# Setup AWS CLI
setup_aws_cli() {
    log_info "Checking AWS CLI configuration..."
    
    if ! command_exists aws; then
        log_warning "AWS CLI not found. Installing..."
        
        case "$(uname -s)" in
            Darwin*)
                log_info "Installing AWS CLI for macOS..."
                curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
                sudo installer -pkg AWSCLIV2.pkg -target /
                rm AWSCLIV2.pkg
                ;;
            Linux*)
                log_info "Installing AWS CLI for Linux..."
                curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
                unzip awscliv2.zip
                sudo ./aws/install
                rm -rf aws awscliv2.zip
                ;;
            *)
                log_warning "Unsupported OS. Please install AWS CLI manually"
                log_warning "Visit: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
                return
                ;;
        esac
    fi
    
    # Check if AWS is configured
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_warning "AWS CLI is not configured"
        log_info "Please run 'aws configure' to set up your AWS credentials"
        log_info "See docs/setup/aws-prerequisites.md for detailed instructions"
    else
        log_success "AWS CLI is configured"
    fi
}

# Install CDK CLI
install_cdk() {
    log_info "Installing AWS CDK CLI..."
    
    if ! command_exists cdk; then
        npm install -g aws-cdk
        log_success "AWS CDK CLI installed"
    else
        log_success "AWS CDK CLI already installed"
    fi
    
    # Check CDK version
    cdk_version=$(cdk --version)
    log_info "CDK Version: $cdk_version"
}

# Setup Docker services
setup_docker_services() {
    log_info "Setting up Docker services..."
    
    # Check if Docker is running
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker is not running. Please start Docker and run this script again."
        exit 1
    fi
    
    # Check if docker-compose.yml exists
    if [ ! -f docker-compose.yml ]; then
        log_warning "docker-compose.yml not found, creating basic configuration..."
        cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: contentuser
      POSTGRES_PASSWORD: your-secure-password
      POSTGRES_DB: contenthub
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U contentuser -d contenthub"]
      interval: 30s
      timeout: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5

volumes:
  postgres_data:
  redis_data:
EOF
        log_success "Created docker-compose.yml"
    fi
    
    # Start services
    log_info "Starting Docker services..."
    docker-compose up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be ready..."
    timeout 60 bash -c 'until docker-compose ps | grep -q "healthy"; do sleep 2; done' || {
        log_error "Services failed to start within 60 seconds"
        docker-compose logs
        exit 1
    }
    
    log_success "Docker services are running"
}

# Setup database
setup_database() {
    log_info "Setting up database..."
    
    # Wait a bit more for database to be fully ready
    sleep 5
    
    # Test database connection
    if docker-compose exec -T postgres pg_isready -U contentuser -d contenthub >/dev/null 2>&1; then
        log_success "Database connection successful"
    else
        log_error "Cannot connect to database"
        docker-compose logs postgres
        exit 1
    fi
    
    # Run migrations if backend exists
    if [ -d "src/backend" ] && [ -f "src/backend/package.json" ]; then
        if grep -q '"db:migrate"' src/backend/package.json; then
            log_info "Running database migrations..."
            cd src/backend
            npm run db:migrate || {
                log_warning "Database migrations failed or not configured yet"
                log_info "You can run migrations later with: npm run db:migrate"
            }
            cd ../..
        else
            log_info "Database migrations not configured yet"
        fi
    else
        log_info "Backend not found, skipping database migrations"
    fi
}

# Create necessary directories
create_directories() {
    log_info "Creating project directories..."
    
    directories=(
        "logs"
        "uploads"
        "backups"
        "docs/api"
        "src/backend/src/entities"
        "src/backend/src/database/migrations"
        "src/backend/src/database/seeds"
        "src/backend/tests"
        "src/frontend/src/components"
        "src/frontend/src/pages"
        "src/frontend/src/utils"
        "infrastructure/lib"
        "scripts"
    )
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_info "Created directory: $dir"
        fi
    done
    
    log_success "Project directories created"
}

# Setup git hooks
setup_git_hooks() {
    log_info "Setting up Git hooks..."
    
    if [ -f "package.json" ] && grep -q '"husky"' package.json; then
        npm run prepare 2>/dev/null || {
            log_warning "Husky not configured or failed to install hooks"
        }
        log_success "Git hooks configured"
    else
        log_info "Husky not found, skipping Git hooks setup"
    fi
}

# Validate setup
validate_setup() {
    log_info "Validating setup..."
    
    local errors=()
    
    # Check if .env exists
    if [ ! -f .env ]; then
        errors+=(".env file missing")
    fi
    
    # Check if Docker services are running
    if ! docker-compose ps | grep -q "Up"; then
        errors+=("Docker services not running")
    fi
    
    # Check database connection
    if ! docker-compose exec -T postgres pg_isready -U contentuser -d contenthub >/dev/null 2>&1; then
        errors+=("Cannot connect to database")
    fi
    
    # Check if backend can start (if exists)
    if [ -d "src/backend" ]; then
        if ! timeout 30 bash -c 'cd src/backend && npm run build >/dev/null 2>&1'; then
            errors+=("Backend build failed")
        fi
    fi
    
    if [ ${#errors[@]} -ne 0 ]; then
        log_error "Validation failed:"
        for error in "${errors[@]}"; do
            echo "  - $error"
        done
        log_error "Please check the errors above and run the setup again"
        exit 1
    fi
    
    log_success "Setup validation passed"
}

# Display next steps
show_next_steps() {
    log_success "First-time setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Review and update your .env file with proper values"
    echo "2. Configure AWS credentials: aws configure"
    echo "3. Bootstrap CDK (if using AWS): npx cdk bootstrap"
    echo "4. Read the documentation:"
    echo "   - docs/setup/local-development.md"
    echo "   - docs/setup/aws-prerequisites.md"
    echo "5. Start development:"
    echo "   - npm run dev (start backend)"
    echo "   - npm test (run tests)"
    echo ""
    echo "Useful commands:"
    echo "  - docker-compose logs        # View service logs"
    echo "  - docker-compose restart     # Restart services"
    echo "  - npm run db:migrate         # Run database migrations"
    echo "  - npm run lint              # Check code quality"
    echo ""
    echo "For help, see docs/setup/troubleshooting.md"
}

# Main execution
main() {
    echo "AWS Community Content Hub - First Time Setup"
    echo "=============================================="
    echo ""
    
    check_prerequisites
    echo ""
    
    setup_environment
    echo ""
    
    install_dependencies
    echo ""
    
    setup_aws_cli
    echo ""
    
    install_cdk
    echo ""
    
    create_directories
    echo ""
    
    setup_docker_services
    echo ""
    
    setup_database
    echo ""
    
    setup_git_hooks
    echo ""
    
    validate_setup
    echo ""
    
    show_next_steps
}

# Run main function
main "$@"
