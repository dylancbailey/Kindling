import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

// One source of truth for the corpus. Each entry is a verified public-domain
// EDITION (first published before 1931). `id` mirrors `slug` so Phase 3 can
// build /poem/[slug] from entry.id directly.
const poems = defineCollection({
  loader: file('src/data/poems.json'),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    author: z.string(),
    year: z.number().int(),
    lines: z.array(z.string()).min(1),
    editorial_note: z.string(),
    day_of_year: z.number().int().min(1).max(366).optional(),
  }),
});

export const collections = { poems };
