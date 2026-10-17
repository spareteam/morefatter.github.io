# More Fatter

A dependency-free HTML/CSS/JavaScript rebuild of morefatter.band.

**[Open the website](https://spareteam.github.io/morefatter.github.io/)**

The link works once GitHub Pages is enabled and deployment has completed. No downloads, terminal commands, or local server are needed to view the hosted site.

## Publish on GitHub Pages
One-time setup: open [Pages settings](https://github.com/spareteam/morefatter.github.io/settings/pages), then choose **GitHub Actions** under **Build and deployment → Source**. The website workflow publishes changes to `master` automatically. If its first run happened before Pages was enabled, open [Publish website](https://github.com/spareteam/morefatter.github.io/actions/workflows/pages.yml), choose **Run workflow**, and select `master`.

After a successful deployment, use **Open the website** above. The workflow summary also includes the actual published URL. The workflow checks JavaScript syntax, verifies content consistency, and packages only public website files. `npm run build` generates `_site` with versioned CSS and JavaScript filenames so browsers load the matching assets after each update. The published `build-info.json` identifies the deployed commit.

For local development, run `python3 -m http.server 8000` in this folder. Run `npm run check` before publishing. The website itself has no runtime dependencies. For browser regression tests, run `npm ci`, `npx playwright install chromium`, and `npm test`. The tests use intercepted third-party requests and a tiny generated test video; they do not subscribe real email addresses, make purchases, or validate live third-party services. GitHub runs these tests before publishing.

## Migration status

GitHub Pages publishing is active. Browser checks compare the shared header, navigation, colors, and footer against the approved baseline, and cover the requested popup refinements. An exact visual match with every part of the original Webflow site is not verified. External media still depends on the services listed below; browser tests intercept those services rather than making real purchases or subscriptions.

## Contents
- Full-screen original background film and Advert wordmark
- Seven release slides with original artwork and immediate in-page streaming choices
- Ten YouTube videos with thumbnail previews; players load only after a click
- Three-second slideshow rotation, pause controls, keyboard navigation, and touch swiping
- Live Songkick tour widget
- Original Shopify collection and checkout integration (loaded on opening Shop)
- Original typography, colors, navigation, arrows, pagination, and footer styling
- Music and video carousels are vertically centered with lighter titles; the shop uses a narrower centered panel
- Carousel content fits or scrolls within the original panels on small and landscape screens
- Background video stays unloaded for reduced-motion/data-saving preferences; playback pauses while the tab is hidden or a video player is open
- Original JOIN control opens the band's real Mailchimp subscription form

## Editing
`index.html` contains content in the `site-data` JSON block; `content.json` is its readable reference copy. Update both when changing releases or videos. Styles are in `style.css`; interactions in `app.js`.

Each music release has a `services` list. Selecting its cover or title shows those links immediately inside the carousel, without an iframe or another landing page. Rotation pauses until the fan returns to the artwork, resumes the slideshow, or changes slides. Choosing a service opens that service in a new tab and keeps the band's site open.

The first three releases use direct service URLs sourced from the band's existing Feature.fm smartlinks. The four legacy releases preserve known Spotify track links and use clearly labeled, release-specific searches for services whose direct release URLs could not be verified. Replace those search URLs and remove `search: true` when exact links are available. Service searches do not guarantee catalog availability. The Amazon options sourced from Feature.fm are labeled Download because those URLs point to the MP3 store.

## Service dependencies
The original video, artwork, font and social images remain on the existing Webflow and Feature.fm CDNs. YouTube, Songkick and Shopify remain external services. Music service choices are stored locally and no longer load Feature.fm widgets. Preserve external media or migrate it before cancelling the original hosting. The Shopify Storefront token in shop.js is the public browser token used by the original site, not an admin credential.

The mailing-list button opens the band's real Mailchimp signup form at https://mailchi.mp/e55a52839a47/mf. Fans enter their email and complete any confirmation on Mailchimp; the website does not collect an address separately or claim a subscription has succeeded. No private mailing-list credentials are stored in this repository.

No custom domain is configured, so this does not change morefatter.band or its DNS.
