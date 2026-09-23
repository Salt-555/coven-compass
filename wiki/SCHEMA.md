# Wiki Schema — Coven Compass

## Domain
Business intelligence for Coven Compass: the industry, the competitors, the customers,
the pricing, the build, and the lessons. This is the company's compoundable
knowledge base.

## Conventions
- File names: lowercase, hyphens, no spaces (e.g., `competitor-acme.md`)
- Every page starts with YAML frontmatter (below)
- Use `[[wikilinks]]` — minimum 2 outbound links per page
- Bump the `updated` date on every change
- Every new page goes into index.md under its type section
- Every action appends to log.md

## Frontmatter
  ---
  title: Page Title
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  type: entity | concept | comparison | query
  tags: [from taxonomy below]
  sources: [raw/...]
  ---

## Tag Taxonomy
industry, market, competitor, customer, pricing, creative, offer, build,
launch, lesson, kill, promote, growth, mature.

Every tag on a page must appear here. Add new tags to this list BEFORE using them.

## Page Thresholds
- Create a page when an entity/concept appears in 2+ sources OR is central to one source
- Add to an existing page when new info lands on something already covered
- DON'T create pages for passing mentions
- Split a page over ~200 lines — break into sub-topics with cross-links
- Archive a superseded page to `_archive/`, remove from index

## Update Policy
When new info conflicts with existing content:
1. Check dates — newer sources generally supersede older ones
2. If genuinely contradictory, note both positions with dates and sources
3. Mark in frontmatter: `contradictions: [page-name]`
4. Flag for review in the lint report
