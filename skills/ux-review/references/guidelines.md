# UX guidelines

75 rules adapted from [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
(`src/ui-ux-pro-max/data/ux-guidelines.csv`, commit `56ea9cf`), MIT License,
Copyright (c) 2024 Next Level Builder. Filtered to Critical/High/Medium rules for
web and mobile; layout and responsive rules are covered by responsive-check.
Regenerate with `python3 tools/import_ux_guidelines.py <checkout> <commit>`.

Use them as a second pass after `checklist.md`: each rule says what to look
for (Do / Don't). Cite the rule name in findings so the user can look it up.

## Contents

- [Accessibility](#accessibility) (20)
- [Animation](#animation) (8)
- [Content](#content) (4)
- [Feedback](#feedback) (6)
- [Forms](#forms) (12)
- [Interaction](#interaction) (8)
- [Navigation](#navigation) (4)
- [Onboarding](#onboarding) (1)
- [Search](#search) (2)
- [Security](#security) (1)
- [Touch](#touch) (4)
- [Typography](#typography) (5)

## Accessibility

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Text Reflow and Spacing** — Text must remain available at narrow widths zoom and user spacing overrides | Critical | Web | Use fluid sizes content-driven height and unitless line height | Clip text in fixed-width or fixed-height boxes |
| **Compact Control Semantics** — Interactive chips need a native role accessible name state keyboard operation and visible focus | Critical | Web | Prefer a button and expose pressed or selected state that matches the visible label | Use a clickable div or reveal the only action on hover |
| **Color Contrast** — Text must be readable against background | High | All | Minimum 4.5:1 ratio for normal text | Low contrast text |
| **Color Only** — Don't convey information by color alone | High | All | Use icons/text in addition to color | Red/green only for error/success |
| **Alt Text** — Images need text alternatives | High | All | Descriptive alt text for meaningful images | Empty or missing alt attributes |
| **ARIA Labels** — Interactive elements need accessible names | High | All | Add aria-label for icon-only buttons | Icon buttons without labels |
| **Keyboard Navigation** — Web users need complete keyboard navigation with visible focus on every operable control | High | Web | Keep tab order aligned with visual order and test every action without a pointer | Keyboard traps or illogical tab order |
| **Form Labels** — Inputs must have associated labels | High | All | Use label with for attribute or wrap input | Placeholder-only inputs |
| **Error Messages** — Error messages must be announced | High | All | Use aria-live or role=alert for errors | Visual-only error indication |
| **Motion Sensitivity** — Parallax/Scroll-jacking causes nausea | High | All | Honor prefers-reduced-motion and present the final readable state without parallax or scroll-jacking | Force scroll effects |
| **Focus Not Obscured (Minimum)** — WCAG 2.2 AA requires keyboard focus to remain at least partially visible | High | Web | Offset sticky UI with scroll-padding and dismiss or move persistent overlays | Let headers footers banners or chat widgets fully cover focus |
| **Dragging Movements** — WCAG 2.2 AA requires a single-pointer alternative for author-controlled drag operations | High | All | Add buttons menus or tap-to-move controls and retain keyboard operation | Make dragging the only way to reorder resize or select |
| **Target Size (Minimum)** — WCAG 2.2 AA requires 24 CSS px pointer targets or an applicable exception | High | Web | Use at least 24 by 24 CSS px or verify spacing equivalent inline user-agent or essential exceptions | Assume native 44pt or 48dp guidance defines web conformance |
| **Contextual Live Badge Updates** — Async badge and count changes should announce a meaningful contextual status without moving focus | High | Web | Use one appropriate atomic status message such as 3 items in cart | Announce a bare number or make every badge a competing live region |
| **Heading Hierarchy** — Screen readers use headings for navigation | Medium | Web | Use sequential heading levels h1-h6 | Skip heading levels or misuse for styling |
| **Screen Reader** — Content should make sense when read aloud | Medium | All | Use semantic HTML and ARIA properly | Div soup with no semantics |
| **Skip Links** — Allow keyboard users to skip navigation | Medium | Web | Provide skip to main content link | No skip link on nav-heavy pages |
| **Focus Not Obscured (Enhanced)** — WCAG 2.2 AAA requires keyboard focus to remain fully visible | Medium | Web | Keep the entire focused component unobscured by author-created content | Present this enhanced AAA criterion as an AA requirement or allow persistent UI to hide any part of focus |
| **Focus Appearance** — WCAG 2.2 AAA defines minimum area and contrast for focus indicators | Medium | Web | Use an indicator at least as large as a 2 CSS px perimeter with 3:1 state contrast | Present this enhanced AAA criterion as an AA requirement or use a thin low-contrast outline |
| **Consistent Help** — WCAG 2.2 A requires repeated help mechanisms to stay in the same relative order | Medium | All | Keep contact self-help and automated help in consistent locations | Move help controls to different locations on each page |

## Animation

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Excessive Motion** — Too many animations cause distraction and motion sickness | High | All | Animate 1-2 key elements per view maximum | Animate everything that moves |
| **Reduced Motion** — Respect user's motion preferences | High | All | Check prefers-reduced-motion media query | Ignore accessibility motion settings |
| **Loading States** — Show feedback during async operations | High | All | Use skeleton screens or spinners | Leave UI frozen with no feedback |
| **Hover vs Tap** — Hover effects don't work on touch devices | High | All | Use click/tap for primary interactions | Rely only on hover for important actions |
| **Auto-Rotating Content Controls** — Auto-rotating content needs user control | High | All | Provide previous next and play/pause; stop on focus or hover and when reduced motion is requested | Auto-advance slides without a stop control |
| **Cancellable State Transitions** — Rapid compact-control changes can interrupt an in-flight transition | High | Web | Cancel or replace prior motion; set the final semantic state directly and handle cancellation cleanup | Depend on animationend or transitionend for required state correctness |
| **Duration Timing** — Motion duration depends on distance complexity platform and user context | Medium | All | Use shared motion tokens and test that feedback stays responsive | Present 150-300ms or any cutoff as a universal requirement |
| **Continuous Animation** — Infinite animations are distracting | Medium | All | Use for loading indicators only | Use for decorative elements |

## Content

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Essential Text Truncation** — Headings actions errors safety text and distinguishing names need complete access | Critical | All | Wrap stack resize or provide a visible full-detail path | Clamp essential meaning only to make cards uniform |
| **Compact Label Semantics** — Badges communicate state while chips or tags represent values or actions | High | All | Choose static or interactive markup from the label's meaning and ownership | Make every pill clickable or encode status with color alone |
| **Compact Label Overflow** — A badge chip or pill label should stay whole on one line when practical and disclose unavoidable truncation | High | All | Bound only unpredictable values; use nowrap with a shrinkable label; expose full text to keyboard pointer and touch users | Let one compact label wrap to a second line or use a hover-only tooltip |
| **Truncation** — Handle long content gracefully | Medium | All | Truncate with ellipsis and expand option | Overflow or broken layout |

## Feedback

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Loading Indicators** — Loading feedback should match the expected wait and avoid flashing for near-instant work | High | All | Follow platform and component guidance; preserve layout focus and accessible busy status | Apply one timing threshold to every operation or leave long waits unexplained |
| **Empty States** — Guide users when no content exists | Medium | All | Show helpful message and action | Blank empty screens |
| **Error Recovery** — Help users recover from errors | Medium | All | Provide clear next steps | Error without recovery path |
| **Progress Indicators** — Show progress for multi-step processes | Medium | All | Step indicators or progress bar | No indication of progress |
| **Toast Notifications** — Transient messages for non-critical info | Medium | All | Auto-dismiss after 3-5 seconds | Toasts that never disappear |
| **Confirmation Messages** — Confirm successful actions | Medium | All | Brief success message | Silent success |

## Forms

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Input Labels** — Every input needs a visible label | High | All | Always show label above or beside input | Placeholder as only label |
| **Error Placement** — Each invalid field needs an inline error connected to that field | High | All | Show a specific error below the input and reference it with aria-describedby | Show only a top-level error without identifying each invalid field |
| **Submit Feedback** — Confirm form submission status | High | All | Show loading then success/error state | No feedback after submit |
| **Focusable Error Summary** — An error summary for failed validation complements inline field errors and must be easy to find by keyboard and screen reader users | High | Web | Place it at the top of the form; move focus to its heading or container after failed submit; link each item to its invalid field; retain inline errors | Replace inline errors with a visual-only summary or move focus on every blur |
| **Inline Validation** — Validate as user types or on blur | Medium | All | Validate on blur for most fields | Validate only on submit |
| **Input Types** — Use appropriate input types | Medium | All | Use email tel number url etc | Text input for everything |
| **Autofill Support** — Help browsers autofill correctly | Medium | Web | Use autocomplete attribute properly | Block or ignore autofill |
| **Required Indicators** — Mark required fields clearly | Medium | All | Use asterisk or (required) text | No indication of required fields |
| **Password Visibility** — Let users see password while typing | Medium | All | Toggle to show/hide password | No visibility toggle |
| **Input Affordance** — Inputs should look interactive | Medium | All | Use distinct input styling | Inputs that look like plain text |
| **Mobile Keyboards** — Show appropriate keyboard for input type | Medium | Mobile | Use inputmode attribute | Default keyboard for all inputs |
| **Redundant Entry** — WCAG 2.2 A avoids requiring the same information twice in one process | Medium | All | Auto-populate prior values or let users select previously entered information | Ask users to retype the same address or account data without necessity |

## Interaction

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Focus States** — Keyboard focus, including controls inside a modal, needs a visible indicator | High | All | Use a visible focus ring on every interactive control, including modal controls | Remove focus outline without replacement |
| **Loading Buttons** — Prevent double submission during async actions | High | All | Disable button and show loading state | Allow multiple clicks during processing |
| **Error Feedback** — Users need to know when something fails | High | All | Show clear error messages near problem | Silent failures with no feedback |
| **Confirmation Dialogs** — Prevent accidental destructive actions | High | All | Confirm before delete/irreversible actions | Delete without confirmation |
| **Hover States** — Visual feedback on interactive elements | Medium | Web | Change cursor and add subtle visual change | No hover feedback on clickable elements |
| **Active States** — Show immediate feedback on press/click | Medium | All | Add pressed/active state visual change | No feedback during interaction |
| **Disabled States** — Clearly indicate non-interactive elements | Medium | All | Reduce opacity and change cursor | Confuse disabled with normal state |
| **Success Feedback** — Confirm successful actions to users | Medium | All | Show success message or visual change | No confirmation of completed action |

## Navigation

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Back Button** — Users expect back to work predictably | High | Mobile | Preserve navigation history properly | Break browser/app back button behavior |
| **Sticky Navigation** — Fixed nav should not obscure content | Medium | Web | Add padding-top to body equal to nav height | Let nav overlap first section content |
| **Active State** — Current page/section should be visually indicated | Medium | All | Highlight active nav item with color/underline | No visual feedback on current location |
| **Deep Linking** — URLs should reflect current state for sharing | Medium | All | Update URL on state/view changes | Static URLs for dynamic content |

## Onboarding

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **User Freedom** — Users should be able to skip tutorials | Medium | All | Provide Skip and Back buttons | Force linear unskippable tour |

## Search

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Autocomplete** — Help users find results faster | Medium | Web | Show predictions as user types | Require full type and enter |
| **No Results** — Dead ends frustrate users | Medium | Web | Show 'No results' with suggestions | Blank screen or '0 results' |

## Security

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Accessible Authentication (Minimum)** — WCAG 2.2 AA says authentication must not depend only on a cognitive function test unless an exception applies | Critical | All | Allow password managers and paste; offer passkeys OAuth or another non-cognitive method | Block paste or require manual OTP transcription with no alternative |

## Touch

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Touch Target Size** — Touch target guidance depends on platform and web context | High | Mobile | Use 44pt on iOS and 48dp on Android; for web use the separate WCAG Target Size rule | Treat one unit or minimum as universal across platforms |
| **Touch Spacing** — Adjacent touch targets need adequate spacing | Medium | Mobile | Minimum 8px gap between touch targets | Tightly packed clickable elements |
| **Gesture Conflicts** — Custom gestures can conflict with system | Medium | Mobile | Avoid horizontal swipe on main content | Override system gestures |
| **Tap Delay** — 300ms tap delay feels laggy | Medium | Mobile | Use touch-action CSS or fastclick | Default mobile tap handling |

## Typography

| Rule | Severity | Platform | Do | Don't |
|---|---|---|---|---|
| **Contrast Readability** — Body text needs good contrast | High | All | Use darker text on light backgrounds | Gray text on gray background |
| **Line Height** — Adequate line height improves readability | Medium | All | Use 1.5-1.75 for body text | Cramped or excessive line height |
| **Line Length** — Long lines are hard to read | Medium | Web | Limit to 65-75 characters per line | Full-width text on large screens |
| **Font Size Scale** — Consistent type hierarchy aids scanning | Medium | All | Use consistent modular scale | Random font sizes |
| **Heading Clarity** — Headings should stand out from body | Medium | All | Clear size/weight difference | Headings similar to body text |
