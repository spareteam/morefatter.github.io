# Browser and device audit

## Findings and fixes

The reported pattern was Music stopping while Video still advanced on iPhone 13 Safari. The audit reproduced two concrete interruption failures in the carousel:

1. Losing pointer capture on the artwork, or releasing outside the carousel, could leave a gesture active. Auto-advance deliberately waits during a gesture, so that carousel stopped indefinitely. Release/cancel handling now works outside the viewport and on the original artwork. Blur, page hiding, and resizing also clear interrupted gestures.
2. WebKit emitted an additional click on the album image after capture was lost and the pointer was released outside it. The recorded sequence ended with `pointerup` on the background at `(2, 2)`, followed by `click` on the cover image. That opened the streaming chooser, correctly paused Music, and made the slideshow appear broken. Interrupted gestures and moved releases now suppress that accidental click; stationary taps still open streaming choices.

Normal music/video auto-advance after closing Signup already passed before these fixes. The friend's exact iOS version and interaction sequence were unavailable, so this is a verified reproduction consistent with the report rather than a claim to have tested their physical phone.

Gentle drags now need approximately 20–32 CSS pixels, depending on carousel width, instead of 35–80. Short fast flicks can advance from 12 pixels. The drag starts after 6 pixels of horizontal intent, tolerates a slight diagonal, follows the finger, and keeps the existing slide animation. Vertical gestures lock to scrolling. Rotation remains every three seconds; deliberate Pause and the pause while reading streaming choices are preserved.

No stylesheet, typography, artwork, title/footer positioning, or other visual design was changed for this audit.

## Coverage

The device audit runs in Chrome, Firefox, and WebKit: 33 browser/viewport combinations.

| Profile | Viewport (CSS pixels) |
|---|---|
| Small phone | 320 × 568 |
| Small Android-sized phone | 360 × 800 |
| iPhone 13 with Safari browser controls | 390 × 664 |
| iPhone 13 full height | 390 × 844 |
| Large phone | 430 × 932 |
| Phone landscape | 844 × 390 |
| Tablet portrait | 768 × 1024 |
| Tablet landscape | 1024 × 768 |
| Laptop | 1366 × 768 |
| Desktop | 1440 × 900 |
| Wide desktop | 2560 × 1080 |

Every combination captures Home, Music, streaming choices, Video, Tour, Shop, and Signup. Assertions cover viewport overflow, visible controls, carousel navigation, covers and square streaming choosers, close-button bounds, and signup clearance and its Mailchimp button. The regression cases additionally cover signup dismissal, timed auto-advance, actual track movement, short animated drags in both directions, lost artwork capture, releases outside the carousel, and rotation during a gesture.

The existing full Chrome suite checks native touch swipes through Chrome's touch-input API, vertical scrolling, mouse cursors, keyboard navigation, all release choosers, player/slideshow pauses, local media, signup persistence, and browser history. Native H.264 autoplay and deliberate pause have a separate WebKit gate.

These are desktop browser engines with emulated viewports and touch capabilities. They do not represent physical iOS hardware or every Safari version. The cross-engine swipe regression uses native pointer/mouse input; Chrome additionally tests native touch input. External commerce, ticketing, and signup requests are intercepted by the interaction tests; the audit does not make purchases or subscribe email addresses. Representative Chrome screenshots were visually inspected; all engines' screenshot sets are attached to their workflow run.

## Evidence and future checks

- [Original implementation audit](https://github.com/spareteam/morefatter.github.io/actions/runs/39141931063): the lost-capture and gentle-swipe regressions failed in all three engines; all 33 responsive layout combinations passed.
- [WebKit event trace](https://github.com/spareteam/morefatter.github.io/actions/runs/39142442398): isolated the additional phantom artwork click and the resulting streaming-chooser pause.
- [Fixed implementation audit](https://github.com/spareteam/morefatter.github.io/actions/runs/39142671842): all three 16-check engine audits passed, including the WebKit phantom-click regression and all 33 responsive layout combinations.
- The existing Chrome suite passed 66 checks locally; all six affected native touch/tap/streaming checks passed again after the final WebKit click fix.

The Browser and device audit is now required by the Publish website workflow. Publishing also retains the complete Chrome regression suite and native WebKit playback checks. Screenshots are uploaded as `device-audit-chromium`, `device-audit-firefox`, and `device-audit-webkit` artifacts, retained for 14 days.
