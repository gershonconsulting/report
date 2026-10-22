# report.gershoncrm.com — One-Pager Generator

Static, browser-only generator that turns a month of LinkedIn campaign exports
(Sales Navigator campaign report, Cloud Campaign / SNC social report, written
narrative; all PDFs) into the Gershon client one-pager. PDFs are parsed in the
browser with pdf.js and never uploaded anywhere. Output: print to PDF or
download as HTML.

Replaces the old v0.1 "Launching soon" Drive-folder + n8n form page.

## Files

- `index.html` - page, styles (inline, on purpose: "Download HTML" re-embeds them)
- `app.js` - PDF reading, parsers, analysis, conclusions, report renderer
- `_headers` - security headers (unchanged)

## Third-party assets (CDN, exact versions)

- pdf.js 3.11.174 `pdf.min.js` and `pdf.worker.min.js` from cdnjs.cloudflare.com
- Google Fonts: Archivo, IBM Plex Sans, IBM Plex Mono

The pdf.js files are ~320KB+ so they are referenced from the CDN rather than
vendored. To self-host later, download both from
`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/` into the repo root and
change the script `src` in `index.html` and `workerSrc` in `app.js`.

## Use

1. Drop the exports in (or click "Load the Enzymicals August example").
2. Check every extracted figure (amber = not found).
3. Build the one-pager, then Save as PDF or Download HTML.

## Local preview

Open `index.html`, or `python3 -m http.server 8080`.

## Deploy

Cloudflare Pages project `gershoncrm-report`, Git-connected to this repo
(branch `main`, no build command, no output directory; repo root is the site).
See HANDOFF.txt.
