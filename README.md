# African History

A free reading app for African history, starting with Kenya. Books open and are read inside the app, in chapters, with adjustable text size and a night mode. Every book can be downloaded as a PDF.

## Add a book
1. Put the book's text in `books/<name>.json`:

```json
{
  "title": "Book title",
  "author": "Author",
  "rights": "Who gave permission, and the terms",
  "chapters": [
    { "title": "Chapter one", "paragraphs": ["First paragraph.", "## A subheading", "Next paragraph."] }
  ]
}
```

2. Add an entry to `books.json`:

```json
{
  "id": "short-name",
  "title": "Book title",
  "author": "Author",
  "description": "One or two sentences.",
  "topics": ["Colonial era"],
  "text": "books/<name>.json",
  "permission_from": "Who gave permission",
  "license": "The terms"
}
```

Entries without `text`, `permission_from` and `license` are not shown. Every book is read and downloaded inside the app; the app never sends readers to another website.

## Logo
Put a square image named `logo.png` in the repo root and it replaces the default emblem in the header.

## Offline
A book opened once stays available without internet.

## PDF
The PDF is plain text in a serif font. Letters outside Western European alphabets (for example the Kikuyu ĩ and ũ) lose their accent marks.

## Takedown
Delete the book's entry from `books.json` and its file from `books/`.
