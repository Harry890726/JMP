# StatLab Explorer

A browser-based interactive statistics workbench in the style of desktop statistical-discovery software: data tables, point-and-click analysis platforms, dynamically linked graphs, red-triangle option menus, and collapsible report outlines.

一個在瀏覽器中執行的互動式統計分析軟體：資料表、點選式分析平台、互相連動的圖形、紅色三角形選項選單，以及可折疊的報表大綱。

No build step and no dependencies. Plain HTML, CSS and JavaScript.

## Run

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly also works. Serving it over HTTP is needed only for **File ▸ Export Report as HTML**, which inlines the stylesheet.

## Features

| Menu | Platforms / commands |
|---|---|
| **File** | New table, open CSV/TSV/JSON, sample data, new table from clipboard, save as CSV, save project, export report, print |
| **Tables** | Summary, Subset, Sort, Stack, Split, Transpose, Concatenate, Join, Tabulate |
| **Rows** | Exclude / Hide / Label, colors, Select Where, invert, random, duplicates, color by column, add and delete rows |
| **Cols** | New columns (sequence, random, constant, formula), Column Info, Formula Editor, Recode, modeling type, Columns Viewer |
| **DOE** | Full Factorial, Screening (fractional factorial), Response Surface (central composite), Sample Size & Power |
| **Analyze** | Distribution · Fit Y by X (Bivariate / Oneway / Contingency / Logistic) · Tabulate · Fit Model (least squares with effect tests, profiler, nominal logistic) · Multivariate · Principal Components · Hierarchical and K-Means clustering · Control Charts (IR, XBar-R, XBar-S, P) · Process Capability · Pareto |
| **Graph** | Graph Builder (drag columns onto X / Y / Group X / Group Y / Overlay; points, smoother, line of fit, line, bar, box, histogram, heatmap, area), Scatterplot Matrix |

How the interface works:

- **Modeling types** decide which analysis runs: continuous ▲, ordinal, and nominal. Click a column's icon to change its type.
- **Linked selection:** clicking or dragging over points, bars or table cells in any report selects those rows in the data table and in every other report.
- **Row states:** excluded rows are left out of analyses, hidden rows are left out of graphs, and labelled rows show their labels on the graphs. Reports update automatically.
- **Formulas** reference columns with `:name` or `:"name with spaces"`, for example `:weight / (:height ^ 2) * 703` or `If(:age > 14, "Teen", "Child")`.

## Code layout

```
index.html
css/app.css
js/util.js          formatting, RNG, icons
js/stats.js         distributions, OLS, logistic, eigen, Shapiro-Wilk, k-means, loess …
js/datatable.js     data model, row states, formula engine, CSV/JSON I/O
js/ui.js            window manager, menus, dialogs, launch (role) dialogs
js/plot.js          SVG plotting primitives
js/tableview.js     virtualised data grid
js/report.js        report outlines, hotspot menus, linked selection, brushing
js/platforms/*.js   analysis platforms
js/graphbuilder.js  Graph Builder
js/tableops.js      Tables menu + DOE
js/app.js           menus, toolbar, column/row dialogs, home window
```

All sample data is generated synthetically. This is an independent project and is not affiliated with any commercial software vendor.
