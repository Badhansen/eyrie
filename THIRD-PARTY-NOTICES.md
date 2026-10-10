# Third-party notices

Eyrie is licensed under [AGPL-3.0-only](LICENSE). This repository vendors no third-party code: dependencies are installed from npm by `pnpm install`, each with its own licence file under `node_modules/`.

The built web UI (`apps/web/dist`, produced by `pnpm build`) bundles some of those dependencies, and the engine loads others at run time. Their copyright notices and licences are reproduced below, and **this file must accompany any distribution of a built UI or packaged build of Eyrie**.

Type-only packages (`@types/*`, `graphology-types`, `csstype`) and install-time helpers (`node-addon-api`, `node-gyp-build`) are not part of what runs and are not listed.

## elkjs licence election

`elkjs` is offered under **EPL-2.0 OR GPL-3.0-or-later**. Eyrie uses `elkjs` under the **GPL-3.0-or-later** option, which is compatible with AGPL-3.0-only (GPL-3.0 §13 and AGPL-3.0 §13 permit combining the two). Eyrie does not rely on the EPL-2.0 option.

## Bundled into the web UI

| Package | Version | Licence | Copyright | Source |
| --- | --- | --- | --- | --- |
| `react`, `react-dom`, `scheduler`, `use-sync-external-store` | 19.3.0, 19.3.0, 0.28.0, 1.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebook/react |
| `@xyflow/react`, `@xyflow/system` | 12.12.0, 0.0.83 | MIT | Copyright (c) 2019-2025 webkid GmbH | https://github.com/xyflow/xyflow |
| `zustand` | 4.5.7 | MIT | Copyright (c) 2019 Paul Henschel | https://github.com/pmndrs/zustand |
| `classcat` | 5.0.5 | MIT | Copyright © Jorge Bucaran | https://github.com/jorgebucaran/classcat |
| `d3-color`, `d3-dispatch`, `d3-drag`, `d3-interpolate`, `d3-selection`, `d3-timer`, `d3-transition`, `d3-zoom` | 3.x | ISC | Copyright 2010-2022 Mike Bostock (d3-color); Copyright 2010-2021 Mike Bostock (others) | https://github.com/d3 |
| `d3-ease` | 3.0.1 | BSD-3-Clause | Copyright 2010-2021 Mike Bostock; Copyright 2001 Robert Penner | https://github.com/d3/d3-ease |
| `three` | 0.186.1 | MIT | Copyright © 2010-2026 three.js authors | https://github.com/mrdoob/three.js |
| `animejs` | 4.5.0 | MIT | Copyright (c) 2025 Julian Garnier | https://github.com/juliangarnier/anime |
| `elkjs` | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later (used under GPL-3.0-or-later) | Copyright (c) Kiel University and others | https://github.com/kieler/elkjs |
| `lucide-react` | 1.52.0 | ISC; icons derived from Feather are MIT | Copyright (c) 2026 Lucide Icons and Contributors; Feather icons Copyright (c) 2013-present Cole Bemis | https://github.com/lucide-icons/lucide |
| `@fontsource-variable/archivo` (Archivo font) | 5.3.0 | OFL-1.1 | Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo) | https://github.com/fontsource/font-files |
| `@fontsource/fragment-mono` (Fragment Mono font) | 5.3.0 | OFL-1.1 | Copyright 2022 The Fragment-Mono Project Authors (https://github.com/weiweihuanghuang/fragment-mono) | https://github.com/fontsource/font-files |

## Used by the engine and server at run time

| Package | Version | Licence | Copyright | Source |
| --- | --- | --- | --- | --- |
| `web-tree-sitter` | 0.27.0 | MIT | Copyright (c) 2018 Max Brunsfeld | https://github.com/tree-sitter/tree-sitter |
| `tree-sitter-javascript` | 0.25.0 | MIT | Copyright (c) 2014 Max Brunsfeld | https://github.com/tree-sitter/tree-sitter-javascript |
| `tree-sitter-typescript` | 0.23.2 | MIT | Copyright (c) 2017 Max Brunsfeld | https://github.com/tree-sitter/tree-sitter-typescript |
| `tree-sitter-python` | 0.25.0 | MIT | Copyright (c) 2016 Max Brunsfeld | https://github.com/tree-sitter/tree-sitter-python |
| `tree-sitter-go` | 0.25.0 | MIT | Copyright (c) 2014 Max Brunsfeld | https://github.com/tree-sitter/tree-sitter-go |
| `tree-sitter-java` | 0.23.5 | MIT | Copyright (c) 2017 Ayman Nadeem | https://github.com/tree-sitter/tree-sitter-java |
| `tree-sitter-c-sharp` | 0.23.5 | MIT | Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors | https://github.com/tree-sitter/tree-sitter-c-sharp |
| `tree-sitter-php` | 0.24.2 | MIT | Copyright (c) 2017 Josh Vera, GitHub | https://github.com/tree-sitter/tree-sitter-php |
| `tree-sitter-ruby` | 0.23.1 | MIT | Copyright (c) 2016 Rob Rix | https://github.com/tree-sitter/tree-sitter-ruby |
| `tree-sitter-rust` | 0.24.0 | MIT | Copyright (c) 2017 Maxim Sokolov | https://github.com/tree-sitter/tree-sitter-rust |
| `graphology` | 0.26.0 | MIT | Copyright (c) 2016-2021 Guillaume Plique (Yomguithereal) | https://github.com/graphology/graphology |
| `events` | 3.3.0 | MIT | Copyright Joyent, Inc. and other Node contributors | https://github.com/browserify/events |
| `chokidar` | 5.0.0 | MIT | Copyright (c) 2012 Paul Miller (https://paulmillr.com), Elan Shanker | https://github.com/paulmillr/chokidar |
| `readdirp` | 5.1.1 | MIT | Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com) | https://github.com/paulmillr/readdirp |
| `ignore` | 7.0.12 | MIT | Copyright (c) 2013 Kael Zhang, contributors | https://github.com/kaelzhang/node-ignore |
| `json5` | 2.2.3 | MIT | Copyright (c) 2012-2018 Aseem Kishore, and others | https://github.com/json5/json5 |
| `ws` | 8.22.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik | https://github.com/websockets/ws |

When dependencies change, regenerate the list with `pnpm licenses list --prod` and update this file in the same change.

## Licence texts

### MIT License

Applies to every package above marked MIT, with that package's copyright line.

```text
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

### ISC License

Applies to every package above marked ISC, with that package's copyright line.

```text
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

### BSD 3-Clause License

Applies to `d3-ease`.

```text
Copyright 2010-2021 Mike Bostock
Copyright 2001 Robert Penner
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### SIL Open Font License 1.1

Applies to the Archivo and Fragment Mono fonts, with the copyright lines listed above.

```text
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### GNU General Public License 3.0

`elkjs` is used under GPL-3.0-or-later. The full text is at https://www.gnu.org/licenses/gpl-3.0.txt. Eyrie's own [LICENSE](LICENSE) (AGPL-3.0) carries the same terms plus §13.
