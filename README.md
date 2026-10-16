# More Fatter

A dependency-free HTML/CSS/JavaScript rebuild of morefatter.band.

**[Open the website](https://spareteam.github.io/morefatter.github.io/)**

The link works once GitHub Pages is enabled and deployment has completed. No downloads, terminal commands, or local server are needed to view the hosted site.

## Publish on GitHub Pages
One-time setup: open [Pages settings](https://github.com/spareteam/morefatter.github.io/settings/pages), then choose **GitHub Actions** under **Build and deployment → Source**. The website workflow publishes changes to `master` automatically. If its first run happened before Pages was enabled, open [Publish website](https://github.com/spareteam/morefatter.github.io/actions/workflows/pages.yml), choose **Run workflow**, and select `master`.

After a successful deployment, use **Open the website** above. The workflow summary also includes the actual published URL. The workflow checks JavaScript syntax, verifies content consistency, and packages only public website files. `npm run build` generates `_site` with versioned CSS and JavaScript filenames so browsers load the matching assets after each update. The published `build-info.json` identifies the deployed commit.

For local development, run `python3 -m http.server 8000` in this folder. Run `npm run check` before publishing. The website itself has no runtime dependencies. For browser regression tests, run `npm ci`, `npx playwright install chromium`, and `npm test`. The tests use intercepted third-party requests and a tiny generated test video; they do not subscribe real email addresses, make purchases, or validate live third-party services. GitHub runs these tests before publishing.

## Migration status

The current rebuild has not yet been visually compared with the live original, so an exact match is not verified. During the migration task, the cloud network proxy denied access to the original site, its media CDN, and the GitHub Pages API. The deployment workflow is prepared, but its remote outcome must be checked on GitHub.

## Contents
- Full-screen original background film and Advert wordmark
- Eight release slides with click-to-load Feature.fm players and original artwork
- Ten YouTube videos with thumbnail previews; players load only after a click
- Eight-second slideshow rotation, pause controls, keyboard navigation, and touch swiping
- Live Songkick tour widget
- Original Shopify collection and checkout integration (loaded on opening Shop)
- Original typography, colors, navigation, arrows, pagination, and footer styling
- Carousel content fits or scrolls within the original panels on small and landscape screens
- Background video stays unloaded for reduced-motion/data-saving preferences; playback pauses while the tab is hidden or a music/video player is open
- Original JOIN control opens the band's real Mailchimp subscription form

## Editing
`index.html` contains content in the `site-data` JSON block; `content.json` is its readable reference copy. Update both when changing releases or videos. Styles are in `style.css`; interactions in `app.js`.

## Service dependencies
The original video, artwork, font and social images remain on the existing Webflow CDN. Feature.fm, YouTube, Songkick and Shopify remain external services. Preserve those services or migrate the media before cancelling the original hosting. The Shopify Storefront token in shop.js is the public browser token used by the original site, not an admin credential.

The mailing-list button opens the band's real Mailchimp signup form at https://mailchi.mp/e55a52839a47/mf. Fans enter their email and complete any confirmation on Mailchimp; the website does not collect an address separately or claim a subscription has succeeded. No private mailing-list credentials are stored in this repository.

No custom domain is configured, so this does not change morefatter.band or its DNS.
