from bedrock_agentcore.runtime import (
    BedrockAgentCoreApp,
)  #### AGENTCORE RUNTIME - LINE 1 ####
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
import requests
import boto3
from scripts.utils import get_ssm_parameter, get_cognito_client_secret
from lab_helpers.lab1_strands_agent import (
    get_return_policy,
    get_product_info,
    MODEL_ID,
)

from lab_helpers.lab2_memory import (
    CustomerSupportMemoryHooks,
    memory_client,
    ACTOR_ID,
    SESSION_ID,
)

# Lab1 import: Create the Bedrock model
model = BedrockModel(model_id=MODEL_ID)

# Lab2 import : Initialize memory via hooks
memory_id = get_ssm_parameter("/app/customersupport/agentcore/memory_id")
memory_hooks = CustomerSupportMemoryHooks(
    memory_id, memory_client, ACTOR_ID, SESSION_ID
)

# Lab3 import: Set up gateway client for MCP tools
def get_token(client_id: str, client_secret: str, scope_string: str, url: str) -> dict:
    """Get OAuth token for gateway authentication"""
    try:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope_string,
        }
        response = requests.post(url, headers=headers, data=data)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as err:
        return {"error": str(err)}

# Get gateway access token
gateway_access_token = get_token(
    get_ssm_parameter("/app/customersupport/agentcore/machine_client_id"),
    get_cognito_client_secret(),
    get_ssm_parameter("/app/customersupport/agentcore/cognito_auth_scope"),
    get_ssm_parameter("/app/customersupport/agentcore/cognito_token_url")
)

# Get gateway URL from SSM
gateway_id = get_ssm_parameter("/app/customersupport/agentcore/gateway_id")
gateway_client = boto3.client("bedrock-agentcore-control", region_name=boto3.session.Session().region_name)
gateway_response = gateway_client.get_gateway(gatewayIdentifier=gateway_id)
gateway_url = gateway_response["gatewayUrl"]

# Set up MCP client for gateway tools
mcp_client = MCPClient(
    lambda: streamablehttp_client(
        gateway_url,
        headers={"Authorization": f"Bearer {gateway_access_token['access_token']}"},
    )
)

# Initialize MCP client
try:
    mcp_client.start()
except Exception as e:
    print(f"Error initializing MCP client: {str(e)}")

# Combine local tools with gateway tools
tools = [get_return_policy, get_product_info] + mcp_client.list_tools_sync()

# Customer Service Assistant system prompt for runtime
CUSTOMER_SERVICE_SYSTEM_PROMPT = """You are a helpful and professional Customer Service Assistant for an electronics e-commerce company.
Your role is to:
- Help customers with return policy questions using accurate information
- Provide detailed product information and specifications
- Assist with order tracking and status inquiries
- Be friendly, patient, and understanding with customers
- Always offer additional help after answering questions
- If you can't help with something, direct customers to the appropriate contact

You have access to the following tools:
1. get_return_policy() - For return policy and warranty questions
2. get_product_info() - To get detailed product specifications and information
3. Gateway tools - For order tracking and customer profile information

Always use the appropriate tool to get accurate, up-to-date information rather than making assumptions about products, policies, or order status."""

# Create the Customer Service Assistant agent with all tools (local + gateway)
agent = Agent(
    model=model,
    tools=tools,  # Includes both local tools and gateway tools from MCP client
    system_prompt=CUSTOMER_SERVICE_SYSTEM_PROMPT,
    hooks=[memory_hooks],
)

# Initialize the AgentCore Runtime App
app = BedrockAgentCoreApp()  #### AGENTCORE RUNTIME - LINE 2 ####


@app.entrypoint  #### AGENTCORE RUNTIME - LINE 3 ####
def invoke(payload):
    """AgentCore Runtime entrypoint function"""
    user_input = payload.get("prompt", "")

    # Invoke the agent
    response = agent(user_input)
    return response.message["content"][0]["text"]


if __name__ == "__main__":
    app.run()  #### AGENTCORE RUNTIME - LINE 4 ####
