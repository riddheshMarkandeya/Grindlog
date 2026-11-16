# Third-party notices

Grindlog is MIT-licensed (see `LICENSE`). It ships the third-party software below. This list covers only what is
installed; build tools that never reach your machine (Vite's build tooling, ESLint, rcedit, Inno Setup) aren't in it.

## In `grindlog.exe`

### Bun 1.4.3

- Licence: MIT
- <https://bun.com>

`grindlog.exe` is a Bun single-file executable, so it contains the Bun runtime. Bun itself is MIT-licensed. Bun
statically links JavaScriptCore and WebKit, which are licensed under the LGPL-2; Bun's patched WebKit source is at
<https://github.com/oven-sh/webkit>. Bun also statically links other libraries under their own licences, among them
SQLite (public domain), BoringSSL, mimalloc, zlib-ng, libuv, c-ares, simdutf, uSockets and ICU. The full list, each
licence, and how to relink Bun against a modified JavaScriptCore are at <https://bun.com/docs/project/licensing>.

### zod 4.6.7

- Licence: MIT
- Copyright (c) 2025 Colin McDonnell

zod is also in the dashboard files below.

## In the dashboard (`web` folder)

### react 19.3.0, react-dom 19.3.0, scheduler 0.28.0

- Licence: MIT
- Copyright (c) Meta Platforms, Inc. and affiliates.

### react-router 8.4.0

- Licence: MIT
- Copyright (c) React Training LLC 2015-2019
- Copyright (c) Remix Software Inc. 2020-2021
- Copyright (c) Shopify Inc. 2022-2023

### @remix-run/route-pattern 0.22.1 (a react-router dependency)

- Licence: MIT
- Copyright (c) 2025 Shopify Inc.

### cookie-es 3.1.1 (a react-router dependency)

- Licence: MIT
- Cookie-es copyright (c) Pooya Parsa <pooya@pi0.io>
- Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
- Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/)

### @tanstack/react-query 5.104.1, @tanstack/query-core 5.104.1

- Licence: MIT
- Copyright (c) 2021-present Tanner Linsley

### html-to-image 1.11.11

- Licence: MIT
- Copyright (c) 2017-2023 W.Y.

### Vite 8.3.3 runtime helpers (the modulepreload polyfill)

- Licence: MIT
- Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

### Phosphor Icons 2.1.10 (the goal icon)

- Licence: MIT
- Copyright (c) 2020 Phosphor Icons

### Lucide 1.72.0 (every other dashboard icon, bar two drawn for Grindlog)

- Licence: ISC, text at the end of this file
- Copyright (c) 2026 Lucide Icons and Contributors
- Some Lucide icons are derived from Feather, under MIT: Copyright (c) 2013-present Cole Bemis. Of those used
  here: arrow-left, clock, crosshair, download, hash, percent, plus-circle, power and target.

## MIT License

The text below applies to every entry above except Lucide itself, which is ISC (below); Lucide's Feather-derived
icons are MIT and covered here. Each entry keeps its own copyright lines. For Bun, it covers Bun's own code
only; the libraries Bun links keep the licences listed on Bun's licensing page.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## ISC License

The text below applies to Lucide.

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
