# Deploying Kindling to Cloudflare Pages

Kindling is a static Astro site — Cloudflare Pages builds it and serves the `dist/`
folder from its global CDN. Domain: **kindlingwriting.app**.

## One-time setup

### 1. Put the project in a Git repo
From the `Kindling/` folder:

```
git init
git add .
git commit -m "Kindling"
```

Create an empty repo on GitHub (e.g. `kindling`) and push:

```
git remote add origin https://github.com/<you>/kindling.git
git branch -M main
git push -u origin main
```

> `node_modules/` and `dist/` should not be committed. A `.gitignore` with those two
> lines is included.

### 2. Connect it to Cloudflare Pages
In the Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**,
pick the repo, then set:

- **Framework preset:** Astro (auto-detected)
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node version:** 20 or newer (set an env var `NODE_VERSION` = `20` if the default is older)

Deploy. You'll get a `*.pages.dev` URL to verify everything works.

### 3. Add the custom domain
Pages project → **Custom domains → Set up a domain → `kindlingwriting.app`**.

- If `kindlingwriting.app` is registered **on Cloudflare**, the DNS record is added
  automatically.
- If it's registered elsewhere, follow the CNAME instructions Cloudflare shows, or
  move the domain's nameservers to Cloudflare first.

Add `www.kindlingwriting.app` too if you want it (Pages will redirect it to the apex).

## Every update after that
Just push to `main`:

```
git add . && git commit -m "..." && git push
```

Cloudflare rebuilds and redeploys automatically (usually under a minute).

## Already wired for you
- `astro.config.mjs` → `site: https://kindlingwriting.app` (canonical URLs, sitemap, OG image)
- `public/robots.txt` → points at the sitemap
- `public/_headers` → long-cache for hashed assets + fonts
- `dist/404.html` → Cloudflare Pages serves it automatically on 404s
- LT Saeada self-hosted under the SIL OFL (`public/fonts/OFL.txt`)

## Before you flip it live — double-check
- [ ] The "get Lannair →" link points to the real Lannair URL (currently `https://lannair.app`).
- [ ] `site:` in `astro.config.mjs` matches the final domain.
- [ ] Open the `*.pages.dev` preview and type a poem, navigate, check /poems, save an image.
