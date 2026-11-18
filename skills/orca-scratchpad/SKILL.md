---
name: orca-scratchpad
description: "Reads and writes the user's scratchpad, the single draft note shared with the Orca Scratchpad plugin: ~/orca-scratchpad.md (home folder, on macOS, Linux and Windows). Triggers: 'write/note/add this to my scratchpad', 'put this in the scratch', 'read my scratchpad', 'what is in my scratchpad', 'my notepad', 'remove X from the scratchpad'. Reads and edits the file directly, never with git."
---

# orca-scratchpad

One file: `~/orca-scratchpad.md`, at the root of the home folder (`$HOME` on macOS and Linux, `%USERPROFILE%` on Windows). Resolve the path to an absolute one before opening it, whatever the session's working directory. If the user chose another file in the plugin's settings and gives you its path, use that one.

It is the user's draft, not a project document: touch it when asked, nothing more. The Orca Scratchpad panel shows the same file and reloads on its own what you write there.

## Read

Read the file, then return its content or answer the question asked about it. Empty or missing file: say so in one line.

## Write

Append **at the end of the file**, with no timestamp or added heading, the text as the user gave it.

1. Read the file first (editing requires it, and the user also edits it by hand in the panel: always start from its real state).
2. Empty or missing file: write the text. Otherwise: an edit anchored on the last lines that appends the text after them, separated by a blank line.

Never rewrite, reformat or reorder the existing content. Change or remove an existing part only when the user explicitly asks for it, and only that part.

## Never

- **No git**: no `add`, `commit`, `status` or `diff` on this file, even if another skill or an end-of-session hook suggests it.
- No copy, backup or durable memory of its content: it stays in this file.
