#!/usr/bin/env python3
"""
Claude Code Hook: Model Armor WebFetch Filter

This hook integrates with Google Cloud Model Armor to:
1. PreToolUse: Check URLs for sensitive data exfiltration (e.g., API keys, secrets in query params)
2. PostToolUse: Check returned web page content for prompt injection attacks

Supports both PreToolUse and PostToolUse events for the WebFetch tool.
"""

import json
import os
import sys
from typing import Any
from urllib.parse import urlparse, parse_qs

# Check if google-cloud-modelarmor is available
try:
    from google.cloud import modelarmor_v1
    from google.api_core.gapic_v1 import client_options as grpc_client_options
    HAS_MODEL_ARMOR = True
except ImportError:
    HAS_MODEL_ARMOR = False


def get_config() -> dict:
    """Get Model Armor configuration from environment variables."""
    return {
        "project_id": os.environ.get("MODEL_ARMOR_PROJECT_ID", os.environ.get("GCLOUD_PROJECT")),
        "location": os.environ.get("MODEL_ARMOR_LOCATION", "us-central1"),
        "template_id": os.environ.get("MODEL_ARMOR_TEMPLATE_ID", "default-template"),
    }


def create_client(location: str) -> "modelarmor_v1.ModelArmorClient":
    """Create a Model Armor client for the specified location."""
    return modelarmor_v1.ModelArmorClient(
        transport="rest",
        client_options=grpc_client_options.ClientOptions(
            api_endpoint=f"modelarmor.{location}.rep.googleapis.com"
        ),
    )


def sanitize_user_prompt(client: "modelarmor_v1.ModelArmorClient", config: dict, text: str) -> dict:
    """
    Check outgoing content against Model Armor filters.
    Used to detect sensitive data exfiltration in URLs.

    Returns dict with 'blocked' (bool), 'reason' (str if blocked), and 'details'.
    """
    template_name = f"projects/{config['project_id']}/locations/{config['location']}/templates/{config['template_id']}"

    request = modelarmor_v1.SanitizeUserPromptRequest(
        name=template_name,
        user_prompt_data=modelarmor_v1.DataItem(text=text),
    )

    response = client.sanitize_user_prompt(request=request)
    return parse_filter_response(response, check_type="exfiltration")


def sanitize_model_response(client: "modelarmor_v1.ModelArmorClient", config: dict, text: str) -> dict:
    """
    Check incoming web content against Model Armor filters.
    Used to detect prompt injection attacks in fetched content.

    Returns dict with 'blocked' (bool), 'reason' (str if blocked), and 'details'.
    """
    template_name = f"projects/{config['project_id']}/locations/{config['location']}/templates/{config['template_id']}"

    request = modelarmor_v1.SanitizeModelResponseRequest(
        name=template_name,
        model_response_data=modelarmor_v1.DataItem(text=text),
    )

    response = client.sanitize_model_response(request=request)
    return parse_filter_response(response, check_type="injection")


def parse_filter_response(response: Any, check_type: str = "general") -> dict:
    """
    Parse Model Armor response and determine if content should be blocked.

    Args:
        response: Model Armor API response
        check_type: "exfiltration" for URL checks, "injection" for content checks
    """
    result = {"blocked": False, "reason": None, "details": {}}

    # Check if any filter matched
    if hasattr(response, 'filter_match_state'):
        match_state = str(response.filter_match_state)
        if "MATCH_FOUND" in match_state:
            result["blocked"] = True

    # Extract filter results for detailed reasoning
    if hasattr(response, 'filter_results'):
        filter_results = response.filter_results
        reasons = []

        # Check sensitive data protection (SDP) - critical for exfiltration detection
        if hasattr(filter_results, 'sdp') and filter_results.sdp:
            sdp = filter_results.sdp
            if hasattr(sdp, 'match_state') and "MATCH_FOUND" in str(sdp.match_state):
                if check_type == "exfiltration":
                    reasons.append("Sensitive data detected in URL (potential data exfiltration)")
                else:
                    reasons.append("Sensitive data detected in response")
                result["details"]["sensitive_data"] = True
                result["blocked"] = True

        # Check prompt injection/jailbreak - critical for injection detection
        if hasattr(filter_results, 'pi_and_jailbreak') and filter_results.pi_and_jailbreak:
            pi = filter_results.pi_and_jailbreak
            if hasattr(pi, 'match_state') and "MATCH_FOUND" in str(pi.match_state):
                if check_type == "injection":
                    reasons.append("Prompt injection attack detected in web content")
                else:
                    reasons.append("Prompt injection pattern detected")
                result["details"]["prompt_injection"] = True
                result["blocked"] = True

        # Check malicious URIs
        if hasattr(filter_results, 'malicious_uris') and filter_results.malicious_uris:
            uris = filter_results.malicious_uris
            if hasattr(uris, 'match_state') and "MATCH_FOUND" in str(uris.match_state):
                reasons.append("Malicious URL detected")
                result["details"]["malicious_uri"] = True
                result["blocked"] = True

        # Check RAI (Responsible AI) filters
        if hasattr(filter_results, 'rai') and filter_results.rai:
            rai = filter_results.rai
            if hasattr(rai, 'match_state') and "MATCH_FOUND" in str(rai.match_state):
                reasons.append("Content policy violation detected")
                result["details"]["rai"] = True

        # Check CSAM - always block
        if hasattr(filter_results, 'csam') and filter_results.csam:
            csam = filter_results.csam
            if hasattr(csam, 'match_state') and "MATCH_FOUND" in str(csam.match_state):
                reasons.append("Prohibited content detected")
                result["details"]["csam"] = True
                result["blocked"] = True

        if reasons:
            result["reason"] = "; ".join(reasons)

    return result


def extract_url_content_for_check(url: str, prompt: str = "") -> str:
    """
    Extract content from URL and prompt that should be checked for sensitive data.
    Focuses on query parameters and prompt content that could contain exfiltrated data.
    """
    content_parts = []

    # Parse URL and extract query parameters
    try:
        parsed = urlparse(url)

        # Add the full URL for malicious URL detection
        content_parts.append(f"URL: {url}")

        # Extract and highlight query parameters (common exfiltration vector)
        if parsed.query:
            query_params = parse_qs(parsed.query)
            for key, values in query_params.items():
                for value in values:
                    content_parts.append(f"Query param '{key}': {value}")

        # Check URL path segments for encoded data
        if parsed.path:
            content_parts.append(f"Path: {parsed.path}")

    except Exception:
        content_parts.append(f"URL: {url}")

    # Include the prompt as it may contain data being sent
    if prompt:
        content_parts.append(f"Prompt: {prompt}")

    return "\n".join(content_parts)


def handle_pre_tool_use(input_data: dict) -> None:
    """
    Handle PreToolUse event - check URL for sensitive data exfiltration.

    Blocks requests where:
    - URL query parameters contain sensitive data (API keys, tokens, PII)
    - URL points to a known malicious domain
    """
    tool_input = input_data.get("tool_input", {})
    url = tool_input.get("url", "")
    prompt = tool_input.get("prompt", "")

    if not url:
        sys.exit(0)

    config = get_config()

    if not config["project_id"]:
        print("Warning: MODEL_ARMOR_PROJECT_ID not set, skipping exfiltration check", file=sys.stderr)
        sys.exit(0)

    if not HAS_MODEL_ARMOR:
        print("Warning: google-cloud-modelarmor not installed, skipping check", file=sys.stderr)
        sys.exit(0)

    try:
        client = create_client(config["location"])

        # Extract URL content for sensitive data check
        content_to_check = extract_url_content_for_check(url, prompt)
        result = sanitize_user_prompt(client, config, content_to_check)

        if result["blocked"]:
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"Model Armor blocked request: {result['reason']}"
                }
            }
            print(json.dumps(output))
            sys.exit(0)

        # Allow the request
        sys.exit(0)

    except Exception as e:
        # Log error but don't block on failures (fail-open)
        print(f"Model Armor exfiltration check failed: {e}", file=sys.stderr)
        sys.exit(0)


def handle_post_tool_use(input_data: dict) -> None:
    """
    Handle PostToolUse event - check fetched web content for prompt injection.

    Warns/blocks when:
    - Web content contains prompt injection attacks
    - Content attempts to override system instructions
    - Content contains jailbreak patterns
    """
    tool_response = input_data.get("tool_response", "")

    # Handle both string and dict responses
    if isinstance(tool_response, dict):
        # Extract the actual content from the response
        if "content" in tool_response:
            tool_response = tool_response["content"]
        elif "output" in tool_response:
            tool_response = tool_response["output"]
        else:
            tool_response = json.dumps(tool_response)

    if not tool_response:
        sys.exit(0)

    config = get_config()

    if not config["project_id"]:
        print("Warning: MODEL_ARMOR_PROJECT_ID not set, skipping injection check", file=sys.stderr)
        sys.exit(0)

    if not HAS_MODEL_ARMOR:
        print("Warning: google-cloud-modelarmor not installed, skipping check", file=sys.stderr)
        sys.exit(0)

    try:
        client = create_client(config["location"])
        result = sanitize_model_response(client, config, str(tool_response))

        if result["blocked"]:
            # For prompt injection in web content, this is a serious security issue
            # We emit a strong warning since we can't block after execution
            if result["details"].get("prompt_injection"):
                output = {
                    "systemMessage": f"🚨 SECURITY WARNING: {result['reason']}. The fetched web content may be attempting to manipulate Claude's behavior. Proceed with caution.",
                    "suppressOutput": False
                }
            else:
                output = {
                    "systemMessage": f"⚠️ Model Armor warning: {result['reason']}"
                }
            print(json.dumps(output))

        sys.exit(0)

    except Exception as e:
        print(f"Model Armor injection check failed: {e}", file=sys.stderr)
        sys.exit(0)


def main():
    """Main entry point for the hook."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Failed to parse input JSON: {e}", file=sys.stderr)
        sys.exit(1)

    hook_event = input_data.get("hook_event_name", "")
    tool_name = input_data.get("tool_name", "")

    # Only process WebFetch tool
    if tool_name != "WebFetch":
        sys.exit(0)

    if hook_event == "PreToolUse":
        handle_pre_tool_use(input_data)
    elif hook_event == "PostToolUse":
        handle_post_tool_use(input_data)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
