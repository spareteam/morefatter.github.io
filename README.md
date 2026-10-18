# More Fatter

A static HTML/CSS/JavaScript rebuild of morefatter.band.

**[Open the website](https://spareteam.github.io/morefatter.github.io/)**

The link works once GitHub Pages is enabled and deployment has completed. No downloads, terminal commands, or local server are needed to view the hosted site.

## Publish on GitHub Pages
One-time setup: open [Pages settings](https://github.com/spareteam/morefatter.github.io/settings/pages), then choose **GitHub Actions** under **Build and deployment → Source**. The website workflow publishes changes to `master` automatically. If its first run happened before Pages was enabled, open [Publish website](https://github.com/spareteam/morefatter.github.io/actions/workflows/pages.yml), choose **Run workflow**, and select `master`.

After a successful deployment, use **Open the website** above. The workflow summary also includes the actual published URL. The workflow checks JavaScript syntax, verifies content consistency, and packages only public website files. `npm run build` generates `_site` with versioned CSS and JavaScript filenames so browsers load the matching assets after each update. The published `build-info.json` identifies the deployed commit.

For local development, run `python3 -m http.server 8000` in this folder. Run `npm run check` before publishing. Serving the website needs only a static file server; its original logo animations use a locally bundled Lottie player. For browser regression tests, run `npm ci`, `npx playwright install chromium`, and `npm test`. Interaction tests use intercepted third-party requests and a tiny generated test video. A separate media check decodes the actual local images, font, and background film without external media requests. The tests do not subscribe real email addresses, make purchases, or validate live third-party services. GitHub runs these tests before publishing.

The real background film uses H.264. CI selects the runner's installed Google Chrome to test that format; a bare Playwright Chromium build may not include its decoder. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select a compatible local browser. Tour and Merch have internal scroll areas with subtle scrollbars, and their padded close buttons remain accessible while scrolling. Signup uses the same scrollbar styling.

## Migration status

GitHub Pages publishing is active. Browser checks compare the shared header, navigation, colors, and footer against the approved baseline, using the same original image and font bytes, and cover the requested popup refinements. All owned media, including the original logo animation files, is now hosted with the website. External players, ticketing, mailing lists, and checkout remain separate services; browser tests intercept those services rather than making real purchases or subscriptions.

## Contents
- Full-screen original background film, original per-letter title pulse, and original swaying bird logo
- Seven release slides with original artwork and immediate in-page streaming choices
- Ten YouTube videos with thumbnail previews; players load only after a click
- Three-second slideshow rotation, pause controls, keyboard navigation, and touch swiping
- Live Songkick tour widget
- Original Shopify collection and checkout integration (loaded on opening Shop)
- Original typography, colors, navigation, arrows, pagination, and footer styling
- Music and video carousels are vertically centered with lighter titles; the shop uses a narrower centered panel
- Carousel content fits or scrolls within the original panels on small and landscape screens
- Background film starts muted and inline from the page HTML; playback pauses while the tab is hidden or a video player is active, and continues behind signup
- Delayed mailing-list invitation with the band's note and one Continue to Mailchimp button; JOIN can reopen it

## Editing
`index.html` contains content in the `site-data` JSON block; `content.json` is its readable reference copy. Update both when changing releases or videos. Styles are in `style.css`; interactions in `app.js`.

Each music release has a `services` list. Selecting its cover or title shows those links immediately inside the carousel, without an iframe or another landing page. Rotation pauses until the fan returns to the artwork, resumes the slideshow, or changes slides. Choosing a service opens that service in a new tab and keeps the band's site open.

The chooser shares the cover's responsive square dimensions, including on resize. Its service list scrolls inside the square when space is limited. Service logos are local SVG files under `assets/services`, colored using the brand values from Simple Icons; TIDAL uses its white mark on the dark background. Icon sources and the CC0 license are included with those files.

The first three releases use direct service URLs sourced from the band's existing Feature.fm smartlinks. Older releases are checked against official distributor pages and provider catalogs; source evidence for their replacements is in `assets/music/sources.json`. A service with `search: true` remains explicitly labeled Search until its exact release destination is verified. Service searches do not guarantee catalog availability. Amazon product-store links are labeled Download; verified Amazon Music streaming destinations retain their streaming label.

Twenty of the original 21 search options now have verified exact destinations. The only remaining search is **Fat Haus EP on YouTube Music**. Its exact EP page could not be established after public album/playlist searches, the artist's complete albums/singles catalog, and individual-track checks; a separate single is not substituted for the EP. The unlinked, noindex [music-link helper](https://spareteam.github.io/morefatter.github.io/music-links.html) shows only unfinished options, accepts copied provider share links, and prepares a reply to paste into chat. It can also mark a link as not found. It does not automatically change music links or verify a release's identity from the pasted URL alone.

Run `python3 scripts/audit-music-links.py` to compare direct destinations against the band's official link sources, check provider domains and search terms, and request each destination. The report is written to `/tmp/morefatter-music-link-audit.json`; it distinguishes live source matches from recorded provider evidence. Exit status 2 means the live audit is incomplete due to network restrictions or unconfirmed service responses; it must not be reported as a successful live-link check. The manually dispatched **Audit public release catalogs** workflow can inspect public provider metadata from GitHub's runner and save a report on a review branch. It does not change published music links automatically.

## Service dependencies
The background film/poster, all seven release covers, original Advert font, social icons, and footer logos are local under `assets/media`, `assets/covers`, `assets/fonts`, and `assets/icons`. `assets/media/sources.json` records original sources, byte counts, and SHA-256 hashes; `npm run check` verifies the files and hashes. Images and font are unchanged originals. The background film retains its resolution, frame rate, duration, and color settings, with a 26.3% smaller H.264 encoding and fast-start playback. The core media is about 7.02 MB rather than 8.99 MB, with the original title/bird animations and their local player added separately. The manual **Import original cover artwork** workflow can recover the three original Feature.fm cover files onto a review branch without altering the published site.

The original title and bird Lottie JSON files are preserved unchanged, with static SVG fallbacks rendered from the original vector artwork. The title repeats its original 2-second staggered letter pulse; the bird repeats its original 1⅓-second rotation and path flutter. They stop with reduced-motion preferences, the motion control, hidden tabs, active video players, or signup. The MIT-licensed Lottie 5.13.0 light player is local under `assets/vendor`; its npm tarball integrity and bundled-file checksum are recorded there. The approved baseline fixture includes these specifically requested original logo restorations.

The mobile title sits slightly higher and smaller; larger layouts retain their original title placement. The green footer Spotify badge is removed, while the white Spotify icon remains. The matching white TikTok icon links to @morefatterband, provided by the band owner as the current account; its source, license, and evidence are recorded in `assets/icons/tiktok-sources.json`. The background film has its source, muted, autoplay, and inline attributes in the initial HTML, so its first load does not depend on JavaScript. The band explicitly requested autoplay even when reduced-motion or data-saving preferences are present; reduced motion still suppresses interface and logo animations. A short, finite retry sequence handles temporary autoplay rejection, with fresh attempts after page restoration or an ordinary user gesture. The silent film continues behind signup, including the automatic invitation on a first visit. An intentional pause remains in effect through navigation, signup, visibility changes, and late media readiness events. Browser-enforced policies, such as iOS Low Power Mode or an in-app browser's media settings, can still prohibit playback without a gesture; JavaScript cannot override those policies. The CI deployment gates publication on real H.264 playback and startup/recovery checks in both Chrome and WebKit with mobile viewports.

YouTube thumbnails/players, Songkick, Mailchimp, Shopify product images/checkout, and streaming platforms remain external services. Music choices are stored locally and do not load Feature.fm widgets. Webflow is no longer needed to serve the band's owned media. The Shopify Storefront token in shop.js is the public browser token used by the original site, not an admin credential.

The mailing-list invitation appears after 12 seconds on the first or second visit, when the visitor is on the home screen and the tab is visible. It defers while any site panel is open. A new visit begins after a gap of 30 minutes; reloading during the same visit does not count as another visit. An automatic invitation is shown at most once per visit. Dismissal or continuing to Mailchimp suppresses future automatic prompts in that browser. JOIN always opens the dialog manually, and `?signup=1` provides an immediate review link. Modal focus, Escape dismissal, paused carousels and logo animations, and a scrollable note with a visible Mailchimp button work on desktop and small screens. Only visit/dismissal/handoff flags are saved in local storage; email addresses are not stored there.

The Continue to Mailchimp button opens https://mailchi.mp/e55a52839a47/mf in a new tab. Visitors enter their email once, on Mailchimp; the site does not request or pass an email address. Mailchimp handles validation, CAPTCHA, and confirmation. Opening the page is not a confirmed subscription. No private mailing-list credentials are stored in this repository.

No custom domain is configured, so this does not change morefatter.band or its DNS.
