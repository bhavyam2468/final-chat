# PDF
- Text: `pypdf.PdfReader(p).pages[i].extract_text()`. Keep the page number with every extracted block, e.g. `[p12] …`.
- Tables, formulas, columns: `pdfplumber` (`page.extract_tables()`, `extract_words()` with coordinates). Scanned pages need OCR — `pytesseract` only if tesseract is installed; otherwise say the page is an image and read it with view_image after rendering it.
- Merge / split / rotate: `pypdf.PdfWriter`.
- Fill a form: `PdfReader(...).get_fields()` → set values → `writer.update_page_form_field_values`.
- Write results to artifacts/ and link the file.
