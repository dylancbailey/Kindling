import { getCollection } from 'astro:content';

// Single, consistently-ordered source for every route. Sorting by title keeps the
// corpus index stable so a poem page can pin its own poem by index (firstIndex).
export async function getCorpus() {
  const poems = (await getCollection('poems')).sort((a, b) =>
    a.data.title.localeCompare(b.data.title)
  );
  const corpus = poems.map((p) => ({
    text: p.data.lines.join('\n'),
    attribution: p.data.author,
    title: p.data.title,
    slug: p.data.slug,
    dayOfYear: p.data.day_of_year ?? null,   // pin to a calendar day (poem of the day)
  }));
  return { poems, corpus };
}
