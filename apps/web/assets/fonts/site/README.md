# Bundled site fonts

Source: https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl

These fonts are loaded with `next/font/local` so production builds do not fetch Google Fonts CSS or font URLs. Each family includes its original SIL Open Font License. Variable fonts preserve the original UI weight ranges and italic styles.

The checked-in WOFF files retain Latin/Latin Extended glyphs, punctuation and symbols, matching the previous Latin font selection. They were subset and losslessly compressed with fontTools.
