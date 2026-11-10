# Google Noto Emoji

Artwork by Google, downloaded on 2026-11-09 from the official Noto Emoji CDN.

- Animated WebP: [Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-files/?view=docs), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `LICENSE-CC-BY-4.0.txt`.
- Static SVG: [Noto Emoji](https://github.com/googlefonts/noto-emoji), licensed under Apache-2.0. See `LICENSE-APACHE-2.0.txt`.

Artwork is unmodified, with two exceptions: trailing whitespace in SVG source has
been removed, and `1f440.webp` is not Google's animation. It is derived from the
Apache-2.0 `1f440.svg` by sliding the pupils sideways (centre, left, right, centre;
about 3.8s per loop) and encoding the rendered frames, because the original blink
was too fast and distracting. It is a derivative of the Noto Emoji SVG, not of the
CC BY 4.0 WebP.
Each filename is its Unicode code point. Source URLs:

```text
https://fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/512.webp
https://fonts.gstatic.com/s/e/notoemoji/latest/{codepoint}/emoji.svg
```

The coding activity uses the animated laptop (`1f4bb`). Recovery uses the static
arrows (`1f504`) with a CSS rotation. Reduced-motion and hidden states use the
static artwork.
