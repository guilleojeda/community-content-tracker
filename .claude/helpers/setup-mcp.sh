#!/bin/bash
# Setup MCP server for Claude Flow

echo "LAUNCH Setting up Claude Flow MCP server..."

# Check if claude command exists
if ! command -v claude &> /dev/null; then
    echo "FAIL Error: Claude Code CLI not found"
    echo "Please install Claude Code first"
    exit 1
fi

# Add MCP server
echo "PACKAGE Adding Claude Flow MCP server..."
claude mcp add claude-flow npx claude-flow mcp start

echo "PASS MCP server setup complete!"
echo "🎯 You can now use mcp__claude-flow__ tools in Claude Code"
