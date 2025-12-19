#!/usr/bin/env python3
"""
Extract Q&A pairs from Claude Code session files.
Finds AskUserQuestion tool calls and their corresponding user answers.

Usage:
  python extract-qa.py <session_file> [--output-dir <dir>] [--format md|json|both]

Or as a hook:
  Receives session data via stdin (hook context)
"""

import json
import sys
import os
import argparse
from datetime import datetime
from pathlib import Path


def extract_qa_from_session(session_lines: list[str]) -> list[dict]:
    """Extract Q&A pairs from session JSONL lines."""
    qa_pairs = []
    tool_use_map = {}  # Map tool_use_id to question data

    for line in session_lines:
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Look for AskUserQuestion tool_use
        message = entry.get("message", {})
        content = message.get("content", [])

        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    # Found a tool_use for AskUserQuestion
                    if item.get("type") == "tool_use" and item.get("name") == "AskUserQuestion":
                        tool_id = item.get("id")
                        questions = item.get("input", {}).get("questions", [])
                        timestamp = entry.get("timestamp")
                        if tool_id and questions:
                            tool_use_map[tool_id] = {
                                "questions": questions,
                                "timestamp": timestamp
                            }

                    # Found a tool_result - check if it's for an AskUserQuestion
                    if item.get("type") == "tool_result":
                        tool_id = item.get("tool_use_id")
                        if tool_id and tool_id in tool_use_map:
                            # Get answers from toolUseResult
                            tool_result = entry.get("toolUseResult", {})
                            answers = tool_result.get("answers", {})

                            if answers:
                                question_data = tool_use_map[tool_id]
                                qa_pairs.append({
                                    "timestamp": question_data["timestamp"],
                                    "answer_timestamp": entry.get("timestamp"),
                                    "questions": question_data["questions"],
                                    "answers": answers
                                })

    return qa_pairs


def format_qa_markdown(qa_pairs: list[dict], session_id: str = None) -> str:
    """Format Q&A pairs as markdown."""
    lines = ["# Claude Code Q&A Extraction\n"]

    if session_id:
        lines.append(f"Session: `{session_id}`\n")

    lines.append(f"Extracted: {datetime.now().isoformat()}\n")
    lines.append("---\n")

    for i, qa in enumerate(qa_pairs, 1):
        lines.append(f"## Q&A #{i}\n")

        if qa.get("timestamp"):
            lines.append(f"*Asked: {qa['timestamp']}*\n")

        for question in qa.get("questions", []):
            q_text = question.get("question", "Unknown question")
            header = question.get("header", "")
            options = question.get("options", [])
            answer = qa.get("answers", {}).get(q_text, "No answer recorded")

            lines.append(f"### {header}: {q_text}\n")

            if options:
                lines.append("**Options:**")
                for opt in options:
                    label = opt.get("label", "")
                    desc = opt.get("description", "")
                    marker = "**[Selected]**" if label == answer else ""
                    lines.append(f"- {label}: {desc} {marker}")
                lines.append("")

            lines.append(f"**Answer:** {answer}\n")

        lines.append("---\n")

    return "\n".join(lines)


def format_qa_json(qa_pairs: list[dict], session_id: str = None) -> str:
    """Format Q&A pairs as JSON."""
    output = {
        "session_id": session_id,
        "extracted_at": datetime.now().isoformat(),
        "qa_pairs": qa_pairs
    }
    return json.dumps(output, indent=2)


def process_session_file(filepath: str, output_dir: str = None, output_format: str = "md"):
    """Process a single session file and extract Q&A pairs."""
    with open(filepath, "r") as f:
        lines = f.readlines()

    qa_pairs = extract_qa_from_session(lines)

    if not qa_pairs:
        print(f"No Q&A pairs found in {filepath}", file=sys.stderr)
        return None

    session_id = Path(filepath).stem

    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
        base_name = f"qa-{session_id}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

        if output_format in ("md", "both"):
            md_path = os.path.join(output_dir, f"{base_name}.md")
            with open(md_path, "w") as f:
                f.write(format_qa_markdown(qa_pairs, session_id))
            print(f"Markdown saved to: {md_path}", file=sys.stderr)

        if output_format in ("json", "both"):
            json_path = os.path.join(output_dir, f"{base_name}.json")
            with open(json_path, "w") as f:
                f.write(format_qa_json(qa_pairs, session_id))
            print(f"JSON saved to: {json_path}", file=sys.stderr)
    else:
        # Output to stdout
        if output_format == "json":
            print(format_qa_json(qa_pairs, session_id))
        else:
            print(format_qa_markdown(qa_pairs, session_id))

    return qa_pairs


def process_hook_input():
    """Process input when running as a Claude Code hook."""
    # Read hook context from stdin
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("Error: Invalid JSON input from hook", file=sys.stderr)
        sys.exit(1)

    session_id = hook_input.get("session_id")
    cwd = hook_input.get("cwd", os.getcwd())

    # PreCompact hook provides transcript_path directly
    transcript_path = hook_input.get("transcript_path")

    if transcript_path:
        # Expand ~ in path
        session_file = os.path.expanduser(transcript_path)
    else:
        # Fallback: Find the session file from session_id
        home = os.path.expanduser("~")
        project_path = cwd.replace("/", "-").lstrip("-")
        session_dir = os.path.join(home, ".claude", "projects", f"-{project_path}")
        session_file = os.path.join(session_dir, f"{session_id}.jsonl")

    if not os.path.exists(session_file):
        print(f"Session file not found: {session_file}", file=sys.stderr)
        sys.exit(0)  # Don't fail the hook

    # Extract to project's .claude directory
    output_dir = os.path.join(cwd, ".claude", "qa-extractions")
    qa_pairs = process_session_file(session_file, output_dir, "md")

    # Return success for hook
    if qa_pairs:
        print(f"Extracted {len(qa_pairs)} Q&A pair(s) before compaction", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Extract Q&A pairs from Claude Code sessions")
    parser.add_argument("session_file", nargs="?", help="Path to session .jsonl file")
    parser.add_argument("--output-dir", "-o", help="Directory to save output files")
    parser.add_argument("--format", "-f", choices=["md", "json", "both"], default="md",
                        help="Output format (default: md)")
    parser.add_argument("--hook", action="store_true", help="Run in hook mode (read from stdin)")

    args = parser.parse_args()

    # If explicit --hook flag, run in hook mode
    if args.hook:
        process_hook_input()
        return

    # If session file provided, process it directly
    if args.session_file:
        process_session_file(args.session_file, args.output_dir, args.format)
        return

    # No args - check if running as a hook with stdin
    if not sys.stdin.isatty():
        process_hook_input()
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
