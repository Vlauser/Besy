# Besy

## Installed skills

`.claude/skills/` holds 15 skills vendored from four upstream repositories, plus
`.claude/tools/` (161 reference files: 107 tool integrations, 66 CLI wrappers)
that the marketing skills link to. The tool files cost no context — they load
only when a skill links to one.

| Area | Skills | Upstream |
|---|---|---|
| Writing | humanizer | blader/humanizer |
| Design | frontend-design | anthropics/claude-code |
| Security | owasp-security | agamm/claude-code-owasp |
| SEO | seo, seo-audit, seo-technical, seo-page, seo-content | AgriciDaniel/claude-seo |
| Marketing | cro, ab-testing, copywriting, emails, analytics, content-strategy, ai-seo | coreyhaines31/marketingskills |

All are MIT-licensed and vendored unmodified, so they can be refreshed from
upstream without resolving conflicts.

## Constraints these skills do not know about

**The claude-seo Python runtime is not installed.** `seo`, `seo-audit` and
`seo-technical` between them call `claude-seo run` 18 times — `run google`,
`render`, `drift`, `backlinks`, `sitemap`, `pagespeed`, `gsc`, `crux`, `agent`.
None of these resolve. Do not attempt them, and do not present their output as
if a crawl had run. Use the skills' checklists and criteria directly, fetch
pages with WebFetch when a page's own markup is needed, and say plainly when
something needs a real crawl, a Core Web Vitals measurement, or a Google API
credential that this setup cannot produce.

**Only part of each upstream pack is installed** — 5 of 25 skills from
claude-seo, 7 of 50 from marketingskills. Both packs cross-reference siblings
throughout their prose: "see seo-schema", "see offers", "see popups", "see
attribution". Those skills are not here. Treat such a pointer as a topic hint
and handle the request directly rather than announcing a skill you cannot load.

**`seo-geo` was removed** in favour of `ai-seo`; the two claimed the same
triggers. Five files still mention `seo-geo` in prose — `ai-seo` covers that
ground.

**`seo-audit` does not delegate.** Its text describes handing work to up to 15
subagents; none are installed. It runs as a single pass.

## Adding to this set

Vendor into `.claude/skills/<name>/` and commit — `~/.claude/skills/` is
ephemeral in remote sessions, and its `synced/` subdirectory is overwritten by
claude.ai. Read an installer script before running it; the published install
commands for several of these packs pointed at paths that do not exist, or
fetched a SKILL.md while skipping the `references/` it links to.

Names must not collide with the skills synced from claude.ai — `docx`, `pdf`,
`pptx`, `xlsx` and `seo-audit` are already taken.
