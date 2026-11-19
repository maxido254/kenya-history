# Kenyan History Library

A free, offline-capable web app for reading Kenyan history books. It is a static site, so it runs on GitHub Pages with no server.

## Features
- Catalog with search and topic filter
- Built-in PDF reader (uses the browser's PDF viewer)
- "Save offline" per book, so readers can use it without data
- Installable on phones (PWA)
- Every book shows who gave permission and under what terms

## Add a book
1. Put the PDF in the `books/` folder.
2. Add an entry to `books.json`:

```json
{
  "title": "Book title",
  "author": "Author",
  "year": 1990,
  "description": "One or two sentences.",
  "topics": ["Colonial era"],
  "file": "books/book-name.pdf",
  "permission_from": "Who gave permission",
  "license": "Terms, e.g. Free educational distribution"
}
```

Entries missing `permission_from` or `license` are not shown. Keep the written permission for each title (email or letter) in a private folder, not in the repo.

## Publish on GitHub Pages
1. Create a repo and upload these files.
2. Go to Settings, then Pages, choose the `main` branch and root folder, and save.
3. Your site appears at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

Note: GitHub recommends repos stay under about 1 GB and files under 100 MB. For many large books, host the PDFs elsewhere (for example Cloudflare R2 or the Internet Archive) and put the full URL in `file`.

## Test locally
Run `python3 -m http.server 8000` in this folder and open http://localhost:8000. A service worker needs http, so opening index.html directly will not give offline mode.

## Takedown
If a rights holder asks for a title to be removed, delete its entry from `books.json` and its file from `books/`.

## Linking to a free copy instead of hosting the PDF
If a book is already free online (an open-access library or the publisher's site), leave out `file` and add `"link": "https://..."` instead. The card then shows an "Open free copy" button.
