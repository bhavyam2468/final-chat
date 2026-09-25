---
name: python
description: Python sandbox for data analysis, plotting, file conversion, math; installing libraries.
---
- run_python(code): fresh process each call; state persists only via files. cwd=workspace. 120s timeout.
- Preinstalled: numpy pandas scipy sympy matplotlib(Agg) openpyxl python-pptx python-docx pypdf pillow requests bs4 yt-dlp tabulate.
- pip_install(["pkg"]) to add more (e.g. seaborn, scikit-learn, networkx, rdkit).
- Plots: plt.savefig('artifacts/name.png', dpi=150, bbox_inches='tight'); then show with ![](artifacts/name.png).
- DataFrames: print(df.head().to_markdown()) / df.describe(). Never print huge outputs.
- yt-dlp: `yt_dlp.YoutubeDL({'outtmpl':'uploads/%(title)s.%(ext)s'})`; subtitles via writesubtitles.
