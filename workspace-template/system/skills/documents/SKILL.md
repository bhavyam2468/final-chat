---
name: documents
description: Working with files the user brings or wants back — PDF, Word, Excel/CSV, PowerPoint, images — plus Python for data, conversion and math.
---
Sandbox Python: run_python(code) — fresh process each call, cwd = workspace, 120 s, state only through files. pip_install(["pkg"]) adds to the same venv. Preinstalled: numpy pandas scipy sympy openpyxl python-pptx python-docx pypdf pdfplumber pillow requests bs4 tabulate yt-dlp.
Charts are shown with blocks, not files: <x-chart> / <x-graph> / <x-tikz> for anything the user should see; matplotlib/PIL PNGs only when they asked for an image file, and even then the result they read is a block. Print summaries (df.head().to_markdown(), df.describe()), never whole frames.

Recipes beyond the basics live in reference/: office.md (Excel, Word, PowerPoint), pdf.md (extract, merge, annotate), python.md (sandbox limits, downloads, math).
- Read a file the user mentions with context_add(path) — pdf/docx/xlsx/pptx text is extracted automatically; page/sheet ranges go through Python.
- Their annotations of a file live in notes/<filename>.md (notes + highlights): read it before answering "what did I mark…". Study notes you write go to notes/<name>.md, headings per section, ==key terms==.
- Build deliverables in artifacts/ and link the file. A spreadsheet, deck or document the agent produces is a file, not blocks; a table the user reads in chat is x-table.
- Extract figures/tables from PDFs with pdfplumber; keep page numbers with the extracted text.
