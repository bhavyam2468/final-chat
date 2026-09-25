---
name: pdf
description: Extract text/tables from PDFs, study notes, annotations, merging/splitting.
---
- context_add(path) extracts text automatically. For page ranges: run_python with pypdf: PdfReader(p).pages[i].extract_text().
- Tables/formulas/academic layouts: enable MCP pdf-reader, or pip_install(["pdfplumber"]) and use page.extract_tables().
- User annotations of a file live in notes/<filename>.md (notes + highlight list). Read before answering questions about "my notes/annotations".
- Write study notes to notes/<name>.md with headings per section and ==key terms==.
- Merge/split: pypdf PdfWriter.
