#!/usr/bin/python
import json
import os
import sys
import click
from botocore.exceptions import ClientError
import boto3
from utils import get_aws_region

REGION = get_aws_region()
CREDENTIALS_FILE = "credentials.json"

identity_client = boto3.client(
    "bedrock-agentcore-control",
    region_name=REGION,
)
ssm = boto3.client("ssm", region_name=REGION)


def store_provider_name_in_ssm(provider_name: str):
    """Store credential provider name in SSM parameter."""
    param_name = "/app/customersupport/agentcore/google_provider"
    try:
        ssm.put_parameter(
            Name=param_name, Value=provider_name, Type="String", Overwrite=True
        )
        click.echo(f"[CLOSED LOCK WITH KEY] Stored provider name in SSM: {param_name}")
    except ClientError as e:
        click.echo(f"[WARNING SIGN] Failed to store provider name in SSM: {e}")


def get_provider_name_from_ssm() -> str:
    """Get credential provider name from SSM parameter."""
    param_name = "/app/customersupport/agentcore/google_provider"
    try:
        response = ssm.get_parameter(Name=param_name)
        return response["Parameter"]["Value"]
    except ClientError:
        return None


def delete_ssm_param():
    """Delete SSM parameter for provider."""
    param_name = "/app/customersupport/agentcore/google_provider"
    try:
        ssm.delete_parameter(Name=param_name)
        click.echo(f"[BROOM] Deleted SSM parameter: {param_name}")
    except ClientError as e:
        click.echo(f"[WARNING SIGN] Failed to delete SSM parameter: {e}")


def load_google_credentials(credentials_file: str) -> tuple:
    """Load Google OAuth2 credentials from JSON file."""
    if not os.path.isfile(credentials_file):
        click.echo(f"[CROSS MARK] Error: '{credentials_file}' file not found", err=True)
        sys.exit(1)

    click.echo(f"[PAGE FACING UP] Reading credentials from {credentials_file}...")
    try:
        with open(credentials_file, "r") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        click.echo(f"[CROSS MARK] Error parsing JSON: {e}", err=True)
        sys.exit(1)

    web_config = data.get("web")
    if not web_config:
        click.echo("[CROSS MARK] Error: 'web' section missing in credentials.json", err=True)
        sys.exit(1)

    client_id = web_config.get("client_id")
    client_secret = web_config.get("client_secret")

    if not client_id:
        click.echo("[CROSS MARK] Error: 'client_id' not found in credentials.json", err=True)
        sys.exit(1)

    if not client_secret:
        click.echo("[CROSS MARK] Error: 'client_secret' not found in credentials.json", err=True)
        sys.exit(1)

    click.echo("[WHITE HEAVY CHECK MARK] Client ID and Secret loaded from credentials.json")
    return client_id, client_secret


def create_google_provider(provider_name: str, credentials_file: str) -> dict:
    """Create a Google OAuth2 credential provider."""
    try:
        client_id, client_secret = load_google_credentials(credentials_file)

        click.echo("[WRENCH] Creating Google OAuth2 credential provider...")
        google_provider = identity_client.create_oauth2_credential_provider(
            name=provider_name,
            credentialProviderVendor="GoogleOauth2",
            oauth2ProviderConfigInput={
                "googleOauth2ProviderConfig": {
                    "clientId": client_id,
                    "clientSecret": client_secret,
                }
            },
        )

        click.echo("[WHITE HEAVY CHECK MARK] Google OAuth2 credential provider created successfully")
        provider_arn = google_provider["credentialProviderArn"]
        click.echo(f"   Provider ARN: {provider_arn}")
        click.echo(f"   Provider Name: {google_provider['name']}")

        # Store provider name in SSM
        store_provider_name_in_ssm(provider_name)

        return google_provider

    except Exception as e:
        click.echo(f"[CROSS MARK] Error creating Google credential provider: {str(e)}", err=True)
        sys.exit(1)


def delete_google_provider(provider_name: str) -> bool:
    """Delete a Google OAuth2 credential provider."""
    try:
        click.echo(f"[WASTEBASKET]  Deleting Google OAuth2 credential provider: {provider_name}")

        identity_client.delete_oauth2_credential_provider(name=provider_name)

        click.echo("[WHITE HEAVY CHECK MARK] Google OAuth2 credential provider deleted successfully")
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
    """AgentCore Google Credential Provider Management CLI.

    Create and delete OAuth2 credential providers for Google Calendar integration.
    """
    ctx.ensure_object(dict)


@cli.command()
@click.option(
    "--name", required=True, help="Name for the credential provider (required)"
)
@click.option(
    "--credentials-file",
    default=CREDENTIALS_FILE,
    help=f"Path to Google credentials JSON file (default: {CREDENTIALS_FILE})",
)
def create(name, credentials_file):
    """Create a new Google OAuth2 credential provider."""
    click.echo(f"[ROCKET] Creating Google credential provider: {name}")
    click.echo(f"[ROUND PUSHPIN] Region: {REGION}")

    # Check if provider already exists in SSM
    existing_name = get_provider_name_from_ssm()
    if existing_name:
        click.echo(f"[WARNING SIGN]  A provider already exists in SSM: {existing_name}")
        if not click.confirm("Do you want to replace it?"):
            click.echo("[CROSS MARK] Operation cancelled")
            sys.exit(0)

    try:
        provider = create_google_provider(
            provider_name=name, credentials_file=credentials_file
        )
        click.echo("[PARTY POPPER] Google credential provider created successfully!")
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
    """Delete a Google OAuth2 credential provider."""

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

    if delete_google_provider(name):
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
