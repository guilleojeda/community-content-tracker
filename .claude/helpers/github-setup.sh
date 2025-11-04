#!/bin/bash
# Setup GitHub integration for Claude Flow

echo "🔗 Setting up GitHub integration..."

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo "WARN  GitHub CLI (gh) not found"
    echo "Install from: https://cli.github.com/"
    echo "Continuing without GitHub features..."
else
    echo "PASS GitHub CLI found"
    
    # Check auth status
    if gh auth status &> /dev/null; then
        echo "PASS GitHub authentication active"
    else
        echo "WARN  Not authenticated with GitHub"
        echo "Run: gh auth login"
    fi
fi

echo ""
echo "PACKAGE GitHub swarm commands available:"
echo "  - npx claude-flow github swarm"
echo "  - npx claude-flow repo analyze"
echo "  - npx claude-flow pr enhance"
echo "  - npx claude-flow issue triage"
