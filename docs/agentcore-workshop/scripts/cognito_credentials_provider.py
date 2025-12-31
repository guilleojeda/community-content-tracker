#!/usr/bin/python
import boto3
import click
import sys
from botocore.exceptions import ClientError
from utils import get_ssm_parameter, get_aws_region

REGION = get_aws_region()

identity_client = boto3.client(
    "bedrock-agentcore-control",
    region_name=REGION,
)
ssm = boto3.client("ssm", region_name=REGION)


def store_provider_name_in_ssm(provider_name: str):
    """Store credential provider name in SSM parameter."""
    param_name = "/app/customersupport/agentcore/cognito_provider"
    try:
        ssm.put_parameter(
            Name=param_name, Value=provider_name, Type="String", Overwrite=True
        )
        click.echo(f"[CLOSED LOCK WITH KEY] Stored provider name in SSM: {param_name}")
    except ClientError as e:
        click.echo(f"[WARNING SIGN] Failed to store provider name in SSM: {e}")


def get_provider_name_from_ssm() -> str:
    """Get credential provider name from SSM parameter."""
    param_name = "/app/customersupport/agentcore/cognito_provider"
    try:
        response = ssm.get_parameter(Name=param_name)
        return response["Parameter"]["Value"]
    except ClientError:
        return None


def delete_ssm_param():
    """Delete SSM parameter for provider."""
    param_name = "/app/customersupport/agentcore/cognito_provider"
    try:
        ssm.delete_parameter(Name=param_name)
        click.echo(f"[BROOM] Deleted SSM parameter: {param_name}")
    except ClientError as e:
        click.echo(f"[WARNING SIGN] Failed to delete SSM parameter: {e}")


def create_cognito_provider(provider_name: str) -> dict:
    """Create a Cognito OAuth2 credential provider."""
    try:
        click.echo("[INBOX TRAY] Fetching Cognito configuration from SSM...")
        client_id = get_ssm_parameter(
            "/app/customersupport/agentcore/machine_client_id"
        )
        click.echo(f"[WHITE HEAVY CHECK MARK] Retrieved client ID: {client_id}")

        client_secret = get_ssm_parameter(
            "/app/customersupport/agentcore/cognito_secret"
        )
        click.echo(f"[WHITE HEAVY CHECK MARK] Retrieved client secret: {client_secret[:4]}***")

        issuer = get_ssm_parameter(
            "/app/customersupport/agentcore/cognito_discovery_url"
        )
        auth_url = get_ssm_parameter("/app/customersupport/agentcore/cognito_auth_url")
        token_url = get_ssm_parameter(
            "/app/customersupport/agentcore/cognito_token_url"
        )

        click.echo(f"[WHITE HEAVY CHECK MARK] Issuer: {issuer}")
        click.echo(f"[WHITE HEAVY CHECK MARK] Authorization Endpoint: {auth_url}")
        click.echo(f"[WHITE HEAVY CHECK MARK] Token Endpoint: {token_url}")

        click.echo("[GEAR]  Creating OAuth2 credential provider...")
        cognito_provider = identity_client.create_oauth2_credential_provider(
            name=provider_name,
            credentialProviderVendor="CustomOauth2",
            oauth2ProviderConfigInput={
                "customOauth2ProviderConfig": {
                    "clientId": client_id,
                    "clientSecret": client_secret,
                    "oauthDiscovery": {
                        "authorizationServerMetadata": {
                            "issuer": issuer,
                            "authorizationEndpoint": auth_url,
                            "tokenEndpoint": token_url,
                            "responseTypes": ["code", "token"],
                        }
                    },
                }
            },
        )

        click.echo("[WHITE HEAVY CHECK MARK] OAuth2 credential provider created successfully")
        provider_arn = cognito_provider["credentialProviderArn"]
        click.echo(f"   Provider ARN: {provider_arn}")
        click.echo(f"   Provider Name: {cognito_provider['name']}")

        # Store provider name in SSM
        store_provider_name_in_ssm(provider_name)

        return cognito_provider

    except Exception as e:
        click.echo(f"[CROSS MARK] Error creating Cognito credential provider: {str(e)}", err=True)
        sys.exit(1)


def delete_cognito_provider(provider_name: str) -> bool:
    """Delete a Cognito OAuth2 credential provider."""
    try:
        click.echo(f"[WASTEBASKET]  Deleting OAuth2 credential provider: {provider_name}")

        identity_client.delete_oauth2_credential_provider(name=provider_name)

        click.echo("[WHITE HEAVY CHECK MARK] OAuth2 credential provider deleted successfully")
        return True

    except Exception as e:
        click.echo(f"[CROSS MARK] Error deleting credential provider: {str(e)}", err=True)
        return False


def list_credential_providers() -> list:
    """List all OAuth2 credential providers."""
    try:
        response = identity_client.list_oauth2_credential_providers(maxResults=20)
        providers = response.get("credentialProviders", [])
        return providers

    except Exception as e:
        click.echo(f"[CROSS MARK] Error listing credential providers: {str(e)}", err=True)
        return []


def find_provider_by_name(provider_name: str) -> bool:
    """Check if provider exists by name."""
    providers = list_credential_providers()
    for provider in providers:
        if provider.get("name") == provider_name:
            return True
    return False


@click.group()
@click.pass_context
def cli(ctx):
    """AgentCore Cognito Credential Provider Management CLI.

    Create and delete OAuth2 credential providers for Cognito authentication.
    """
    ctx.ensure_object(dict)


@cli.command()
@click.option(
    "--name", required=True, help="Name for the credential provider (required)"
)
def create(name):
    """Create a new Cognito OAuth2 credential provider."""
    click.echo(f"[ROCKET] Creating Cognito credential provider: {name}")
    click.echo(f"[ROUND PUSHPIN] Region: {REGION}")

    # Check if provider already exists in SSM
    existing_name = get_provider_name_from_ssm()
    if existing_name:
        click.echo(f"[WARNING SIGN]  A provider already exists in SSM: {existing_name}")
        if not click.confirm("Do you want to replace it?"):
            click.echo("[CROSS MARK] Operation cancelled")
            sys.exit(0)

    try:
        provider = create_cognito_provider(provider_name=name)
        click.echo("[PARTY POPPER] Cognito credential provider created successfully!")
        click.echo(f"   Provider ARN: {provider['credentialProviderArn']}")
        click.echo(f"   Provider Name: {provider['name']}")

    except Exception as e:
        click.echo(f"[CROSS MARK] Failed to create credential provider: {str(e)}", err=True)
        sys.exit(1)


@cli.command()
@click.option(
    "--name",
    help="Name of the credential provider to delete (if not provided, will read from SSM parameter)",
)
@click.option("--confirm", is_flag=True, help="Skip confirmation prompt")
def delete(name, confirm):
    """Delete a Cognito OAuth2 credential provider."""

    # If no name provided, try to get from SSM
    if not name:
        name = get_provider_name_from_ssm()
        if not name:
            click.echo(
                "[CROSS MARK] No provider name provided and couldn't read from SSM parameter",
                err=True,
            )
            click.echo("   Hint: Use 'list' command to see available providers")
            sys.exit(1)
        click.echo(f"[OPEN BOOK] Using provider name from SSM: {name}")

    click.echo(f"[LEFT-POINTING MAGNIFYING GLASS] Looking for credential provider: {name}")

    # Check if provider exists
    if not find_provider_by_name(name):
        click.echo(f"[CROSS MARK] No credential provider found with name: {name}", err=True)
        click.echo("   Hint: Use 'list' command to see available providers")
        sys.exit(1)

    click.echo(f"[OPEN BOOK] Found provider: {name}")

    # Confirmation prompt
    if not confirm:
        if not click.confirm(
            f"[WARNING SIGN]  Are you sure you want to delete credential provider '{name}'? This action cannot be undone."
        ):
            click.echo("[CROSS MARK] Operation cancelled")
            sys.exit(0)

    if delete_cognito_provider(name):
        click.echo(f"[WHITE HEAVY CHECK MARK] Credential provider '{name}' deleted successfully")

        # Always delete SSM parameter
        delete_ssm_param()
        click.echo("[PARTY POPPER] Credential provider and SSM parameter deleted successfully")
    else:
        click.echo("[CROSS MARK] Failed to delete credential provider", err=True)
        sys.exit(1)


@cli.command("list")
def list_providers():
    """List all OAuth2 credential providers."""
    providers = list_credential_providers()

    if not providers:
        click.echo("INFO:  No credential providers found")
        return

    click.echo(f"[CLIPBOARD] Found {len(providers)} credential provider(s):")
    for provider in providers:
        click.echo(f"  • Name: {provider.get('name', 'N/A')}")
        click.echo(f"    ARN: {provider['credentialProviderArn']}")
        click.echo(f"    Vendor: {provider.get('credentialProviderVendor', 'N/A')}")
        if "createdTime" in provider:
            click.echo(f"    Created: {provider['createdTime']}")
        click.echo()


if __name__ == "__main__":
    cli()
