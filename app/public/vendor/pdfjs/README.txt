PDF.js 4.10.38 (legacy build), from the pdfjs-dist package, Apache License 2.0.

Served from here rather than from a CDN because the content security policy
allows scripts from this server only, and because a municipal office network
must be able to open a scanned letter when the internet is down.

The .mjs files were renamed .js so that every static file server, including
the one in front of the serverless deployment, sends them with a JavaScript
content type. A module script served as anything else is refused.

To upgrade: npm install pdfjs-dist@<version> somewhere temporary and copy
legacy/build/pdf.min.mjs, legacy/build/pdf.worker.min.mjs and standard_fonts/
over these, renaming as above.
