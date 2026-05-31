# Use an independent summary window for the reading companion

We will move the full WeRead AI reading judgement display out of the WeRead page into an independent AI summary window. The WeRead page content script stays headless: it collects visible chapter text, observes chapter changes, handles keyboard shortcuts, and responds to background requests, but it does not inject visible controls into the reading page.

The Chrome toolbar popup becomes the control console for opening or focusing the summary window, triggering the current-chapter judgement, showing short status, opening settings, and clearing local cache. The extension action badge carries only short state: generating, complete, or failed.

## Considered Options

- In-page full panel: easiest to keep, but it overlays the reading surface and competes with the book text.
- Chrome side panel: stable and native, but it reduces the available reading width inside the same Chrome window.
- Compact in-page entry plus independent popup: lower migration cost, but it still draws attention inside the book page and duplicates control surfaces.
- Independent popup window plus toolbar popup controls: more background/message state handling, but it can live beside the book or on another display without covering or shrinking the reading page.

## Consequences

The collector remains the WeRead page content script. The AI summary window presents the latest reading state, remembers its last size and position, and does not reopen automatically after the user closes it.

The toolbar popup owns transient user commands. It is not a persistent reading surface and should not render the full judgement. `Option+Q` remains a shortcut to open or focus the summary window.
