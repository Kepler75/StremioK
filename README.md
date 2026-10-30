# StremioK for Samsung Tizen TVs (Tizen 3.0+)

StremioK is a from-scratch Stremio-addon streaming client for Samsung Tizen TVs.
It was originally built for a 2017 UN50MU6100 running Tizen 3.0
(~Chromium 47) and is also tested on a 2021 QN55Q80AAG running Tizen 6.0.

Old Samsung Tizen TVs run web applications rather than Android APKs. StremioK is
therefore written in old-Chromium-compatible HTML, JavaScript (ES5) and CSS, and plays
video through Samsung's AVPlay API.

- **[Installation guide](docs/INSTALL.md)**: the three ways to put it on your TV.
- **[User guide](docs/USER-GUIDE.md)**: how to use it, task by task.
- **[Troubleshooting](docs/TROUBLESHOOTING.md)**: when something doesn't work.
- **[Privacy and data](docs/PRIVACY.md)**: what's kept on the TV, and what's sent where.
- **[Settings reference](docs/SETTINGS.md)**: every setting, its choices and default.
- **[Changelog](CHANGELOG.md)**: what changed in each version.
- **[Developer guide](docs/DEVELOPER-GUIDE.md)**: how it's put together, and running it in a
  browser.
- **[Security policy](docs/SECURITY.md)**: reporting a vulnerability, privately.

## Highlights

- **Your addons:** catalogs, details, sources and subtitles from the Stremio addons you add
  (Cinemeta and OpenSubtitles to start with), in the order you choose.
- **Home** with Watching (Continue Watching, synced with **Trakt** if you connect it), Movies,
  Series, IPTV, Guide, Radio, Sports, YouTube and Local tabs; **Discover** to browse any catalog in full;
  **Search** across every addon that can search, and people by name.
- **Title pages:** ranked sources with **▶ Play best**, trailers, ratings (IMDb, Rotten
  Tomatoes, Metacritic… with your own API keys), seasons and episodes with their own pages,
  *Cast & more*, *More like this* and collections.
- **The player:** resume where you stopped, skip intros, recaps and credits, next episode,
  subtitles (addons', the file's own, and your own files on a USB drive) with your choice of look, audio
  tracks remembered, switching source mid-playback, private viewing.
- **IPTV and radio** from your M3U playlists, Xtream accounts (with their films and series) and
  Stalker portals, with CH+ / CH−.
- **YouTube:** live channels, trailers, and your own YouTube channels, playlists and searches,
  with SponsorBlock, DeArrow, chapters and captions.
- **Local:** the videos on a USB drive, matched to their titles.
- **Torrents**, through Stremio's streaming server or a TorrServer you run on your network.
- **Made for the remote:** D-pad navigation throughout; hold OK where an item has more to
  offer (*Hold OK for more* says so); zoom up to 140% for reading from further away.

## Install

Three ways, all covered step by step in the **[installation guide](docs/INSTALL.md)**:

- **TizenBrew** (Tizen 3.0 to 6.0): add the NPM module `stremiok`. No certificate needed;
  StremioK's storage is shared with other TizenBrew modules.
- **Apps2Samsung:** installs a [release](https://github.com/Kepler75/StremioK/releases)'s
  `.wgt`, signing it with your own Samsung certificate. No Tizen Studio needed.
- **Tizen Studio:** build the `.wgt` from this repository and sideload it.

## First steps

1. **Addons:** add the addons you use, by link, or bring them in from your Stremio account,
   AIOManager or a configuration file. A stream addon that gives HTTP(S) links (for example
   through a debrid service), or a torrent addon with a streaming server you run, is what makes
   titles playable.
2. **API keys**, optional: your own TMDB, OMDb and MDBList keys add ratings, *Cast & more*,
   *where to watch* and episode trailers.
3. **Trakt**, optional: connect your account to share watched marks and Continue Watching.
4. **IPTV**, optional: your M3U playlist links, an Xtream account (its server, username and
   password) or a Stalker portal (its address and MAC address).
5. **A USB drive**, optional: plug it in and the Local tab appears.

[Getting started](docs/USER-GUIDE.md#getting-started) in the user guide walks through each.

## Content / legal note

This app hosts **no** media. It is a client for the open Stremio addon protocol: catalogs and
metadata come from the addons you install (**Cinemeta**, the official one, by default), and
playable sources come from whatever **stream addons you add yourself** in Settings. Streams
that only expose a torrent `infoHash` play only through a streaming server you run (Stremio's
or TorrServer): this app embeds no torrent or debrid engine.
> **Note on WatchHub:** StremioK doesn't install it. Its answers say it's only for clients
> Stremio authorizes in writing, and StremioK isn't one; "where to watch" comes from TMDB
> instead (with a TMDB key). You can still add it yourself as a third-party addon (Settings
> shows that notice on it); its results are rent/buy/subscription *links to external
> services*, not video URLs. Add stream addons that return HTTP/HLS URLs for actual playback.

The **IPTV** feature likewise hosts no content: you supply your own M3U playlist URLs, Xtream
accounts or Stalker portals. For YouTube entries, the bundled service finds the video's stream; the video itself
comes straight from YouTube. No video or audio is kept: everything plays straight from its
source, unless you download it to your own USB drive. What StremioK does keep, on the TV, is
your progress, settings and copies that let it start faster (see
[Privacy and data](docs/PRIVACY.md#what-stays-on-the-tv)).

## Known limitations

- AVPlay behavior varies by TV generation, codec and HLS provider.
- Torrents play only through a streaming server you run on your network.
- Home rows show up to 200 titles of a catalog (30 unless you change it; ★ Favorites shows all
  yours); Discover pages through the rest.
- No StremioK account and no profiles: settings, addons and progress stay on the TV. The
  only sync is optional: Trakt (watched marks, Continue Watching, ratings).
- Subtitles use an HTML overlay; gzipped (`.gz`) subtitle files aren't decoded.
- No playback speed control (the TV's player mutes audio at other speeds), and no
  HDR / frame-rate mode switching (not available to web apps on Tizen 3).
- Search and text fields use the TV's own on-screen keyboard, or **your phone**: a QR code
  opens a one-time page StremioK serves on your home network. It's plain HTTP (unencrypted),
  so use it only on a network you trust, since addon and playlist links often carry tokens.
- "Where to watch" sources open the app on its home screen, or on the title only where an
  addon you added gives the app's own link and the app takes it. Opening apps under TizenBrew
  depends on what TizenBrew allows its modules; the `.wgt` has the permission.
- YouTube channels and trailers depend on the bundled service and on YouTube's
  undocumented behavior, so YouTube changes may need resolver updates.

## License

MIT: see [LICENSE](LICENSE).

Skip timestamps come partly from [SkipDB](https://skipdb.tv), whose data is published under
the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (see its
[DATA-LICENSE](https://github.com/SkipDB-TV/skipdb/blob/main/DATA-LICENSE)). StremioK only
reads it through SkipDB's public API and keeps none of it.

`js/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by
Kazuhiko Arase (MIT), unchanged; it draws the TV's QR codes (Trakt sign-in, entering text from
your phone, Continue on phone, an addon's Share and Configure).
