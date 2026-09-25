---
name: files
description: Create, read, edit, rename, delete workspace files; diffs; safe editing patterns.
---
- fs_list(path='.') tree depth 2. fs_read(path,start?,end?) numbered lines.
- fs_write(path,content,mode='overwrite'|'append'): creates dirs. Use for new files or full rewrites.
- fs_edit(path,find,replace,all=false): exact substring replace; find must be unique unless all=true. Read first to copy exact text. Prefer several small edits over rewrites.
- fs_move(from,to) rename/move. fs_delete(path) files or dirs.
- Paths relative to workspace. In full-access mode absolute paths reach the user's disk.
- Binary formats: use run_python (openpyxl, python-pptx, python-docx, pypdf).
