# More Fatter

A dependency-free HTML/CSS/JavaScript rebuild of morefatter.band.

**[Open the website](https://spareteam.github.io/morefatter.github.io/)**

The link works once GitHub Pages is enabled and deployment has completed. No downloads, terminal commands, or local server are needed to view the hosted site.

## Publish on GitHub Pages
One-time setup: open [Pages settings](https://github.com/spareteam/morefatter.github.io/settings/pages), then choose **GitHub Actions** under **Build and deployment → Source**. The website workflow publishes changes to `master` automatically. If its first run happened before Pages was enabled, open [Publish website](https://github.com/spareteam/morefatter.github.io/actions/workflows/pages.yml), choose **Run workflow**, and select `master`.

After a successful deployment, use **Open the website** above. The workflow summary also includes the actual published URL. The workflow checks JavaScript syntax, verifies content consistency, and packages only public website files.

For local development, run `python3 -m http.server 8000` in this folder. Run `node --check app.js`, `node --check shop.js`, and `node scripts/check-site.mjs` before publishing.

## Migration status

The current rebuild has not yet been visually compared with the live original, so an exact match is not verified. During the migration task, the cloud network proxy denied access to the original site, its media CDN, and the GitHub Pages API. The deployment workflow is prepared, but its remote outcome must be checked on GitHub.

## Contents
- Full-screen original background film and Advert wordmark
- Eight release slides with Feature.fm players and original artwork
- Ten YouTube videos, keyboard/swipe controls and pagination
- Live Songkick tour widget
- Original Shopify collection and checkout integration (loaded on opening Shop)
- Responsive navigation, social links, reduced-motion support and background pause control

## Editing
`index.html` contains content in the `site-data` JSON block; `content.json` is its readable reference copy. Update both when changing releases or videos. Styles are in `style.css`; interactions in `app.js`.

## Service dependencies
The original video, artwork, font and social images remain on the existing Webflow CDN. Feature.fm, YouTube, Songkick and Shopify remain external services. Preserve those services or migrate the media before cancelling the original hosting. The Shopify Storefront token in shop.js is the public browser token used by the original site, not an admin credential.

Email collection cannot be migrated from public page code: the original form uses Webflow hosting. The rebuilt form explicitly tells visitors that no email has been submitted and links to the original signup. Connect a mailing-list provider before retiring Webflow. No false success messages are shown.

No custom domain is configured, so this does not change morefatter.band or its DNS.
