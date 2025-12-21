Extract all Q&A pairs (AskUserQuestion interactions) from the current session.

Find the current session file in ~/.claude/projects/ and extract all clarifying questions Claude asked along with the user's answers. Save the results as markdown to .claude/qa-extractions/.

Run the extraction script:
```bash
python3 .claude/hooks/extract-qa.py ~/.claude/projects/-Users-$USER-repo/*.jsonl --output-dir .claude/qa-extractions --format md
```

Then report:
1. How many Q&A pairs were found
2. A summary of the questions and answers
3. The path to the saved file
