# Triggerboxd public preview

Triggerboxd helps viewers check movie content warnings without revealing the story. Initial coverage is planned for Indian cinema, with worldwide expansion later. Built with Next.js App Router, React and TypeScript.

## Local use

`npm install`, then `npm run dev`. Checks: `npm run typecheck` and `npm run build`.

The build produces `out/`, suitable for Cloudflare Workers Static Assets. `wrangler.jsonc` points to that directory. Live preview: https://triggerboxd.com — hosted on Cloudflare Workers Static Assets. No Cloudflare partnership or startup-program approval is claimed.

## Configuration before publishing

- Canonicals, sitemap and metadata use `triggerboxd.com`; `www` redirects to the root domain.
- Optionally supply a real `NEXT_PUBLIC_CONTACT_URL` at build time (`https://` or `mailto:`). The default contact is info@triggerboxd.com. Do not put secrets in this public variable.
- Review copy, demo severity definitions and hosting logging/retention policies. No founder details were supplied.
- Build and serve `out/` as static assets. Public content pages are indexable; `/demo/` has `noindex, follow` and is excluded from sitemap. Robots allows crawlers to fetch its noindex metadata.

Original moon-and-lagoon artwork is used for the fictional demo. Sample ratings are not real or community-verified. Contribution state is React memory only and resets on reload.

Coverage: Indian cinema first; worldwide coverage is a future goal. The fictional Malayalam example does not limit the product scope.

## Current milestone

Landing page, fictional content-warning demo, simulated contribution flow, About/contact and Privacy pages. The demo stores choices in memory only. Real movie search, persistent submissions and moderation are future work.

## Contact

info@triggerboxd.com
