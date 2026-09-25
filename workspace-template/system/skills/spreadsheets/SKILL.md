---
name: spreadsheets
description: Read, analyse, create and edit Excel/CSV files with pandas and openpyxl.
---
- Read: pd.read_excel(path, sheet_name=None) -> dict of sheets; print shapes and head.
- Edit preserving formatting: openpyxl.load_workbook(path); ws['B2']='x'; wb.save(path). Formulas: ws['C2']='=A2*B2'. load_workbook(data_only=True) to read computed values.
- Create: df.to_excel(path, index=False) then openpyxl for widths/styles (ws.column_dimensions['A'].width).
- Charts: openpyxl.chart BarChart/LineChart, or matplotlib png.
- Show results as markdown table (<=15 rows) or x-table/x-chart.
