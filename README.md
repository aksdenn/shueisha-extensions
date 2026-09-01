# Shueisha Extensions

Paperback extensions for Shueisha properties:

- [MangaPlus](https://mangaplus.shueisha.co.jp)
- [MangaMillion](https://mangamillion.shueisha.co.jp)

## Install in Paperback

Add this repository's GitHub Pages URL as a Paperback extension repository:

<https://aksdenn.github.io/shueisha-extensions/>

The page is generated from the Paperback bundle and deployed automatically whenever `main` is updated.

## Development

```bash
npm ci
npm run conformance
npm run bundle
npm test
```

The generated files are written to `bundles/` and are intentionally ignored by git. GitHub Actions builds and publishes them to GitHub Pages.
