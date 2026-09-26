---
name: files
description: Reading, searching and editing files precisely (edit strategies, large files, binary formats).
---
- Find first: fs_search(pattern, path, glob) → path:line hits; fs_list(path, depth≤3).
- Read: fs_read(path, start, end) → numbered lines, 250 per call; continue with start=N when it says "more".
- Choose the edit tool:
  - change existing lines → fs_edit(find, replace). find = exact lines from fs_read without the "N<tab>" prefix, 2-6 lines, unique. Multiple spots in one file → edits:[{find,replace},…] (atomic).
  - add lines without touching others → fs_insert(path, line, text): after line N; 0 = top; -1 = end.
  - new file or >60% rewritten → fs_write(path, content) with the full content.
  - rename symbol everywhere in a file → fs_edit(find, replace, all=true) after checking matches with fs_search.
- Results show the edited region with line numbers; use them for the next edit instead of re-reading.
- Errors: "not found" shows the closest region → copy it exactly. "matches N places" → add a neighbouring line. "would break syntax" → file unchanged; fix brackets/indentation in replace.
- Never write placeholders like "// ... rest of code" in replace or content.
- Binary office files: run_python (openpyxl, python-pptx, python-docx, pypdf). Paths: workspace-relative; ~/… only with home access.
