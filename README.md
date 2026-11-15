# FreeTrace

**Live app: https://hcientist.github.io/freetrace/**

FreeTrace makes your iPad a lightbox. It's a static web app: no build step, no server, and your images never leave the device.

1. **Pick an image.** Choose a file or photo, paste an image URL, paste an image from the clipboard, or drop one onto the screen.
   You can also link straight to an image: `https://hcientist.github.io/freetrace/?src=https://example.com/pic.png`
2. **Position it** in *Move* mode. Drag with one finger. Pinch with two fingers to zoom and twist them to rotate.
   The buttons rotate by 90°, flip horizontally or vertically, and fit the image to the screen.
   Opacity and B/W (grayscale) help you see your lines.
3. **Lock.** The screen stays awake (Screen Wake Lock), the toolbar goes away, and every touch is ignored.
   That means paper and your hand can rest on the glass. To unlock, **press and hold** the faint button in the bottom-right corner for about a second.
4. **Draw (optional).** *Draw* mode puts a drawing layer above the image.
   It's pressure-sensitive with Apple Pencil, and also works with a finger or mouse.
   It has pen and eraser, colour, size, undo/redo, and **Pencil only**, which ignores fingers so your palm can't draw.
   Use **Image shown/hidden** to see only your drawing. **Save…** exports a PNG: the drawing alone (transparent or on white), or the drawing plus the image, optionally cropped to the drawing.

The image, its position and your drawing are kept on the device in localStorage and IndexedDB, so they survive a reload.

## iPad tips

- **Add to Home Screen** from Safari's Share menu. The app then runs full-screen and works offline.
- Screen Wake Lock needs iPadOS 16.4 or later in Safari, or iPadOS 18.4 or later for the Home Screen app.
  On older versions, set *Settings → Display & Brightness → Auto-Lock → Never* while you trace.
- A web page can't block the system's edge gestures (Home swipe, Control Center) or the hardware buttons.
  For a fully locked iPad, use **Guided Access** (*Settings → Accessibility → Guided Access*) and triple-click the side or top button.
- Turn the brightness all the way up. Consider turning off True Tone and Night Shift so the backlight is white.

## Keyboard (iPad Magic Keyboard or desktop)

| Key | Action |
| --- | --- |
| Arrow keys (Shift = ×10) | nudge image |
| `+` / `-` | zoom |
| `[` / `]` | rotate ±90° |
| `,` / `.` | rotate ±1° |
| `H` / `V` | flip horizontally / vertically |
| `F` | fit to screen |
| `M` / `D` | Move / Draw mode |
| `P` / `E` | pen / eraser |
| `I` | show / hide image |
| `L` | lock |
| `Tab` | hide / show toolbar |
| ⌘Z / ⇧⌘Z | undo / redo |

On a desktop, the mouse wheel zooms and Shift + wheel rotates.

## Development

These are plain static files (`index.html`, `style.css`, `app.js`, `sw.js`). Serve the folder with any static server, for example `python3 -m http.server`.
GitHub Pages deploys from `main`. Bump `VERSION` in `sw.js` when you ship changes.
