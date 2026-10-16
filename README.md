# More Fatter

A fresh, dependency-free HTML/CSS/JavaScript rebuild of morefatter.band.

## Publish on GitHub Pages
Settings → Pages → Deploy from a branch → master → /(root) → Save. No build required.

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
