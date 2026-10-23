# StremioK developer guide

How StremioK is put together and how to run it on a computer. For what it does, see the
[user guide](USER-GUIDE.md); for installing it, the [installation guide](INSTALL.md); for how
things work inside, the [technical reference](TECHNICAL-REFERENCE.md).

- [Run it on a computer](#run-it-on-a-computer)
- [Architecture](#architecture)
- [Documentation](#documentation)

## Run it on a computer

### In a browser
Everything is plain web tech, so the UI runs in any browser. AVPlay is absent there, so it
uses the `<video>` fallback, which is good for trying navigation, addon loading and
playable HTTP streams:

```bash
python3 -m http.server 8080
# open http://localhost:8080 — arrow keys + Enter; Backspace = RETURN / back
```
> Browser CORS may block some addon hosts on a computer; on the TV the widget's
> `<access origin="*">` (and TizenBrew's environment) allow the cross-origin calls.

### As a TizenBrew module
`package.json` is already set up as a TizenBrew application module (`packageType: "app"`,
`appPath: "index.html"`, the service as its `serviceFile`), and its `files` list keeps the
docs out of the published module. To try changes under TizenBrew, serve this folder
locally, use a wrapper package, or use the
[`@tizenbrew-kit/cli`](https://github.com/thichcode/tizenbrew-kit) development server.

## Architecture

| File | Responsibility |
|------|----------------|
| `index.html` | Layout, video planes (`<object avplayer>` + `<video>` fallback), OSD, overlays |
| `js/polyfills.js` | Feature-guarded shims for Chromium 47 (`Array.find`, `Object.assign`, …) |
| `js/qrcode.js` | qrcode-generator (Kazuhiko Arase, MIT), unchanged: every QR code the TV draws (Trakt and Stremio sign-in, From your phone, Continue on phone, an addon's Share and Configure) |
| `js/util.js` | DOM helpers, XHR (text / JSON), bounded caches, `localStorage`, toast / spinner, image queue, appearance themes, QR codes drawn on a canvas |
| `js/iptv.js` | M3U parsing, TV / radio classification, the synthetic IPTV addon |
| `js/epg.js` | The TV guide: which guide a playlist has, its channels' keys for the service, the programs cards, the player, schedules and the Guide tab ask for |
| `js/youtube.js` | StremioK's own YouTube: your YouTube catalogs (Settings › Content › YouTube), YouTube in Search, the built-in YouTube addon (catalogs, channel / playlist / video pages, streams), SponsorBlock and DeArrow settings and lookups |
| `js/stremio.js` | Addon client (manifests, catalog / meta / stream / subtitles), source cache and de-duplication, source details (resolution, codec, HDR, audio…), Formats (learning, allowed resolutions), TMDB / OMDb / MDBList / TheIntroDB / SkipDB / IntroDB |
| `js/stremio-account.js` | Importing addons from your Stremio account: the link.stremio.com sign-in code, reading the account's addons, signing out at once |
| `js/trakt.js` | Trakt: device-code sign-in (StremioK's built-in Client ID, no secret), watched marks and Continue Watching from Trakt, progress and watched sent to it |
| `js/keys.js` | Registers TV media and channel keys; maps key codes to actions |
| `js/focus.js` | Geometry-based spatial (D-pad) focus engine |
| `js/tvapps.js` | Other apps on the TV: the installed list, your streaming apps, matching a "where to watch" source to its app, opening it (on the title where the link allows) |
| `js/player-core.js` | The playback session: AVPlay lifecycle + HTML5 fallback, progress bar, seeking, credits / next episode, stall recovery, stopping |
| `js/player-store.js` | Saved player state: watched marks, Continue Watching progress, subtitle look, audio and picture settings, per-title subtitle / audio memory |
| `js/player-lang.js` | Track languages: spellings and aliases, display names, reading a track's details |
| `js/player-quality.js` | Video quality (HLS ladder, caps, retries and fallbacks after a failed start) and switching source |
| `js/player-subs.js` | Subtitles: addon tracks (download, parse, draw, timing), the file's own tracks, subtitle menus |
| `js/player-audio.js` | Audio tracks: remembered / preferred pick (before playback starts, or once it runs), switching, the audio menu |
| `js/player-controls.js` | Remote keys, scrubbing, quick-action bar, in-player menu, skip prompt, stream info, picture mode |
| `js/player.js` | Assembles the public `Player` API from the player parts (which share the `PlayerParts` namespace) |
| `js/local.js` | Local: USB drives, folder listings (the TV's, or the service's), file names to titles, the drive index, local sources and their subtitle files |
| `js/downloads.js` | Downloads to a USB drive: the list kept on the TV, starting, cancelling and retrying through the service's `/fsdl` endpoints, the Local tab's Downloads row |
| `js/ytplay.js` | Detects how StremioK was installed (TizenBrew / sideloaded), starts or waits for the YouTube service, builds its URLs |
| `js/hubpreview.js` | Continue Watching on the TV's home bar: sends the tiles to `service/preview.js` (the sideloaded app, Tizen 4 and later) |
| `js/view-core.js` | Shared view pieces: dialogs, pick lists, the top menu (Home, Discover, Search, Settings and title pages), poster cards, Add to Continue Watching, poster long-press actions |
| `js/view-home.js` | Home: tabs, catalog rows (loading, saved copy, refresh), details strip, Continue Watching, NEW badges |
| `js/view-guide.js` | The Guide tab: the TV guide as a grid (channels by hours), its D-pad moves |
| `js/view-detail.js` | Title pages: ranked sources (Play best, Played before), seasons / episodes, Cast & more, person pages, ratings grid, trailers, bulk watched, playback launch, CH+/CH−, next-episode matching |
| `js/view-search.js` | Search: one row per searchable catalog (loads more as you scroll right), a People row (TMDB), recent searches |
| `js/view-settings.js` | Settings sections (incl. Formats) and the text-entry pages (add addon / playlist) |
| `js/view-discover.js` | Discover: browse a catalog in full by type, catalog and genre / year, page by page; People (TMDB) by name |
| `js/views.js` | Assembles the public `Views` API from the view parts (which share the `ViewParts` namespace) |
| `js/app.js` | Bootstrap, navigation history, key routing |
| `service/index.js` | StremioK's service: YouTube, USB drives, downloads, the phone page, AIOManager, live relays, TV guides (see [the service](TECHNICAL-REFERENCE.md#the-service)) |
| `service/preview.js` | The home bar preview service: sets the tiles `js/hubpreview.js` sends, and sets them again when the TV asks (the sideloaded app only) |
| `service/cacert.pem` | The trusted certificates downloads use (the 2017 TV's own list is too old for many servers) |

The views are split into seven parts (`view-core`, `view-home`, `view-guide`, `view-detail`,
`view-search`, `view-settings`, `view-discover`) that share one namespace, `ViewParts`: each publishes the
functions the others use and reaches theirs through small forwarders, resolved when called,
so the parts can load in any order. `views.js` loads after them (see `index.html`) and
assembles the public `Views` API that `app.js` calls.

The player is split the same way into seven parts sharing `PlayerParts`. What they all need
about the current playback (what's playing, position, duration, live or not, buffering and
seek state, the page elements) is one object, `PlayerParts.S`, set up by `player-core.js`,
which loads first. Everything else stays private to its part: another part asks through a
function (`resetSubs`, `menuOpen`, `qualityHeight`…), never by reaching into its variables.
`player.js` loads last and assembles the public `Player` API.

### JavaScript rules (Tizen 3.0 ≈ Chromium 47)
The app code in `js/` and `service/` is **ES5 only**: no `let` / `const`, arrow functions,
template literals, classes, destructuring, default parameters, spread or `async` / `await`.
`Promise` is available, and `polyfills.js` adds the few newer array / object helpers used.
The app ships as written, not minified, so the line numbers in Diagnostics' script errors
match the source.

### The version
`package.json`'s. `config.xml` (the widget's `version`) and `index.html` (every `?v=` on the
scripts and the stylesheet, which drops the TV's cached copies) carry the same one.

### Limits on what's downloaded
Everything that arrives from an addon, a playlist or an API is size-limited and checked before
use, a screen left for good stops its own downloads, artwork is throttled, and typed or imported
URLs go through one parser. The limits and rules, which new code should follow, are in the
[technical reference](TECHNICAL-REFERENCE.md#limits-on-whats-downloaded).

## Documentation

Each change goes in the one document it belongs in; the others link to it rather than repeat
it.

| Document | What goes in it |
|----------|-----------------|
| [User guide](USER-GUIDE.md) | How to use a feature, task by task |
| [Settings reference](SETTINGS.md) | A setting: where it is, its choices, its default, its effect in a line |
| [Troubleshooting](TROUBLESHOOTING.md) | What can go wrong: what you see, why, what to do |
| [Privacy and data](PRIVACY.md) | What's kept on the TV, and what's sent where |
| [Technical reference](TECHNICAL-REFERENCE.md) | How it works inside: limits, timings, rules, TV quirks |
| [Installation guide](INSTALL.md) | Installing and updating, and what differs between installs |
| This guide | The code |
| [Changelog](../CHANGELOG.md) | One entry per version |

How to write it:

- **Write for that document's reader.** The user guide says what to do and what you'll see;
  limits, timings, sizes and how something works inside go in the technical reference.
- **Explain once.** Anywhere else, a sentence and a link to its home.
- **Short pieces.** A paragraph or bullet makes one point; several points make a list. A table
  cell is a phrase or a sentence, with any detail right below the table.
- **A changelog entry** is one bullet per change: what someone would notice, with a link to the
  document that explains it.
- **On the TV,** a Settings hint says the effect in a sentence or two, with any warning; the
  detail belongs in the documents.
- **American spelling.**

Before a change's documentation is done, check:

- **Labels and menu paths** as the TV shows them (*Settings › Content › Addons*).
- **Defaults** as the code sets them.
- **Restrictions:** Tizen 3 or the 2017 TV, TizenBrew or the sideloaded app, a TMDB key or a
  Trakt account needed.
- **Nothing personal:** no API keys, tokens, or addon / playlist links with a personal
  configuration in them, in code, docs or examples; use made-up hosts (`addon.example`). The one
  key in the code on purpose is StremioK's Trakt Client ID (`js/trakt.js`): a public app id,
  not a secret.
- **Links and anchors** resolve.
- **ES5:** nothing newer than ES5 under `js/` or `service/` (see
  [JavaScript rules](#javascript-rules-tizen-30--chromium-47)).

Packaging for the TV is in the [installation guide](INSTALL.md#tizen-studio-build-and-sideload).
