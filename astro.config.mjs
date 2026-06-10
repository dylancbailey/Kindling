import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static site generation (Astro's default). `site` is the live domain — it feeds
// canonical URLs, the sitemap, the OG image URL, and poem JSON-LD.
export default defineConfig({
  site: 'https://kindlingwriting.app',
  integrations: [sitemap()],
  // Home IS the poem of the day, so /today is redundant — redirect it to / to
  // avoid duplicate-content. (Astro emits a static redirect page.)
  redirects: {
    '/today': '/',
  },
});
