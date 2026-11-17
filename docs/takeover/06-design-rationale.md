# Design rationale: LMS for Dempo College (Task 6)

**Name and positioning.** The product is called **LMS**, shown next to the college's name: *LMS | Dempo College*. One-line positioning: ***Coursework, quizzes and marks for Dempo College, built to keep working on campus WiFi.*** The name, institution, crest and sign-in copy live in one file (`artifacts/dempo/src/lib/brand.ts`). Renaming the product means changing that file.

**Who it is for.** The main reader is an 18–24-year-old student at Srinivassa Sinai Dempo College, Goa. They are usually on a phone, on patchy WiFi, and sometimes in the middle of a timed quiz. Faculty and the college office come second. They use it for hours at a laptop.

## Why this palette
The colours come from **the college's own crest** (`artifacts/dempo/public/logo.png`), not from a template.

| Token | Value | Comes from | Contrast |
|---|---|---|---|
| Primary: Dempo indigo | `#28358F` | The river and boat in the crest | 10.5:1 on white |
| Brand accent: laterite | `#8C3B2E` | The pillar in the crest; also the red stone Goa builds with | 7.6:1 (used in the brand mark only) |
| Ink | `#1A1F33` | Neutral with an indigo tint | 16.3:1 |
| Muted text | `#555D73` | | 6.6:1 on white, 6.0:1 on the sidebar |
| Success / warning / danger | `#1D7044` / `#8A5300` / `#B42318` | | 6.1 / 6.3 / 6.6:1 |
| Dark mode | canvas `#11142A`, ink `#E8EAF2`, primary `#A9B4F5` | Night indigo, not black | 15.1 / 9.1:1 |

The ratios were computed with `scripts/check-contrast.py` (WCAG 2.x formula), and every pair above passes AA (4.5:1). **The old tokens failed in several places:** warning text was **3.3:1**, success text **4.1:1**, and muted text on the sidebar **4.4:1** (old `artifacts/dempo/src/index.css`). Colour is never the only signal. Status chips always carry a word ("Needs fixing", "Awaiting grade"). The exam countdown changes colour and is also announced to screen readers at 5 minutes and 1 minute. A roster row with an error shows the reason as text.

## Why these typefaces
**Anek Latin** for headings, semi-condensed, weight 600. **Mukta** for body text, 16px, line-height 1.55. Both come from **Ek Type in Mumbai**, and both have Devanagari companions. That matters for a Goan college: Konkani and Marathi announcements, and the crest's own motto, व्यापारे वसते लक्ष्मी. Headings use a 1.2 (minor-third) scale. The condensed headings give long course titles room on a 360px screen.

**The fonts are bundled with the app** (`@fontsource`), not loaded from Google Fonts as before. That means no third-party request carrying every student's IP address, which fits the DPDP data-residency argument. It also means one less DNS lookup and download on bad WiFi.

## What changed, all at the token or shared-component level
- **Tokens** (`src/index.css`): the palette, fonts, a smaller radius (6px; 4px on controls), near-zero shadows (hierarchy comes from borders and spacing), one global `:focus-visible` outline, and `prefers-reduced-motion` support. All 40 `font-serif` headings switched to the new display face without touching a single screen.
- **Shared components:** `BrandMark` (crest, wordmark, laterite rule, institution) is used in the sidebar, the mobile header, the sign-in page and the landing page. Error messages are fixed once, in `lib/api-client-react/src/custom-fetch.ts`. Before, students saw `HTTP 500 Internal Server Error: Internal server error` or `Failed to fetch` in **72 toast call sites**. Now they read "We couldn't reach the server. Check your WiFi or mobile data and try again." or "Something failed on our side. Please try again in a minute…".
- **Microcopy:** "Welcome back, Dr." is now "Welcome back, Asha", because honorifics are skipped. The 404 page tells you why the page may be gone. The not-invited screen tells you what to do. The landing page no longer promises "AI drafts grades", since AI grading ships **off** (`AI_GRADING_ENABLED=false`). It also no longer shows a made-up dashboard with a "Class rank #2".
- **Accessibility:** `maximum-scale=1` is removed from `index.html`, because it blocked pinch-zoom (WCAG 1.4.4). Quiz options are now real `radio` elements. Search and file inputs have labels.
- **Mobile (360px):** the student dashboard's three full-width stat cards (about 360px tall) are now one compact row, so the course list appears above the fold. Exam and roster screens were checked to have no horizontal scroll.
- **Housekeeping:** `index.html` pointed `og:url` at somebody else's Replit deployment (`learning-hub-christyphilipd9.replit.app`). That is removed, and `robots` is set to `noindex`, since this is a private college tool.

## What we deliberately left alone
- **Layout and navigation.** The information architecture works, and staff are already familiar with it. A redesign would cost retraining and add nothing for the four commercial reasons to buy.
- **The crest itself.** We use it exactly as it is. We did not redraw or simplify it; that is the college's decision to make.
- **Dark mode.** It was already scaffolded (`next-themes`, the `.dark` tokens, the theme toggle), so we re-tuned it rather than removing or extending it.
- **Motion.** `framer-motion` is installed. We added no new animation and turned existing animation off under reduced motion.
- **The leaderboard.** Ranking students publicly is a policy question for the college, not a design one. We flagged it in the memo instead of restyling it.

Before/after screenshots (desktop at 1366px, mobile at 360px) are in `docs/takeover/screenshots/before` and `docs/takeover/screenshots/after`. They cover the landing page, sign-in, student dashboard, course view, assignment, quiz, faculty dashboard and admin invites, plus dark mode.
