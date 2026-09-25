---
name: presentations
description: Read and build PowerPoint slides with python-pptx; classroom slide study workflows.
---
- Read: Presentation(path); for i,s in enumerate(prs.slides): texts from shape.has_text_frame; notes via s.notes_slide.notes_text_frame.text.
- Build: prs=Presentation(); layout prs.slide_layouts[1]; slide.shapes.title.text; placeholders[1].text_frame; add_picture; save to artifacts/.
- Study flow: extract slide text -> outline -> concise notes to notes/<deck>.md -> optional quiz as Blocks form.
- PDF slides: see skill pdf.
