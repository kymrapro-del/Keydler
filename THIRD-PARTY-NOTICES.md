# Third-party notices

Keydler ships one dependency. Its licence requires the notice below to travel
with the code, and the code travels: `idb` is bundled into the JavaScript this
site serves, so the notice belongs here rather than only in `node_modules`.

Everything else in the served bundle is written for this project. There are no
web fonts, no CDN scripts and no external assets: the typeface is whatever the
reader's system provides, and the content security policy would refuse a request
to any other origin anyway.

## idb

[`idb`](https://github.com/jakearchibald/idb) wraps IndexedDB in promises. It is
the reason the persistence layer reads as ordinary `await` rather than as event
handlers.

```
ISC License (ISC)
Copyright (c) 2016, Jake Archibald <jaffathecake@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## Development-only

The build and test toolchain (Vite, TypeScript, Vitest, ESLint, Prettier and
their dependencies) is not part of anything served to a visitor. Their licences
live in `node_modules` and are reproduced by `npm ls --long` if you need them.
