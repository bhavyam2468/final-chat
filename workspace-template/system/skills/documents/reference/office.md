# Excel / CSV
- Read every sheet: `pd.read_excel(path, sheet_name=None)` → dict of DataFrames; print shapes and heads.
- Read computed values: `openpyxl.load_workbook(path, data_only=True)`.
- Edit in place, keeping formatting: `ws = wb.active; ws['B2'] = 'x'; ws['C2'] = '=A2*B2'; ws.column_dimensions['A'].width = 24; wb.save(path)`.
- Create: `df.to_excel(path, index=False)`, then openpyxl for widths, number formats, freeze panes.
- Charts inside the file: `openpyxl.chart.BarChart` / `LineChart` with `Reference(ws, min_col=…, min_row=…)`. A chart the user reads **in chat** is `<x-chart>`, never a PNG.

# Word
- Read: `docx.Document(path)`; paragraphs and `table.rows[i].cells[j].text`.
- Write: build from a template when the user has one (`Document(template)`), keep styles, set `section` margins; save to artifacts/.
- Preserve existing content: open, append or edit the specific paragraph/run, save — never regenerate the whole document.

# PowerPoint
- Read: `prs = Presentation(path); for i, s in enumerate(prs.slides):` text from `shape.has_text_frame`, speaker notes via `s.notes_slide.notes_text_frame.text`.
- Build: `prs.slide_layouts[1]`, `slide.shapes.title.text`, `slide.placeholders[1].text_frame`, `add_picture`, save to artifacts/.
- Study flow: slide text → outline → concise notes to notes/<deck>.md → optional quiz as an `<x-choice>` / `<form>` block. PDF slides: see pdf.md.
