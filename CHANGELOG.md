# Changelog

What changed in each version of StremioK, newest first. How everything works is in the
[user guide](docs/USER-GUIDE.md).

## 2.1.0 — 2026-10-20
- **Live channels reconnect** when their connection drops, as often as *Reconnect live channels*
  says (Settings › Playback › Seeking & buffering): Off, A few times or Keep trying.
- **Trakt:** your whole watched history is read again (Trakt now sends it a page at a time, and
  shows without their episodes unless asked), and an episode you left part-way no longer hides
  the show's next one once you've watched past it, on any device.
- **Addons:** turn one off or on, as you can a playlist, each shown with its logo (Settings ›
  Content › Addons); "No sources found" says why, addon by addon; an addon's error page is no
  longer shown as a title.
- **A YouTube tab on Home:** StremioK's YouTube began as a way to watch TV channels that stream
  on YouTube rather than through an M3U playlist, so its catalogs sat in the IPTV tab. Now that
  it also covers channels, playlists, searches and other addons' YouTube catalogs, it has a tab
  of its own, between Sports and Local.
- **Reordering:** ⇈ / ⇊, beside ▲ / ▼, move an item straight to the top or bottom of any list you
  put in order: addons, playlists, YouTube catalogs, Home feeds, Search results and source
  ranking.
- **Playback:** a source counts as started only once it plays, so one that fails right after
  opening gives way to the next; video quality for streams that need their own headers; skip
  times from TheIntroDB's new API.
- **A faster start:** your addons don't wait for the IPTV playlists, and Home's rows appear as
  each is ready.
- **Security and privacy fixes:** USB drives and downloads; the TV itself off-limits to
  downloads and live relays; AIOManager's key kept to its own server, and addons you added
  yourself left alone by its sync.

## 2.0.0 — 2026-10-17
The first public version of StremioK, a Stremio-addon client for Samsung Tizen TVs (Tizen 3.0
and later). What it does is in the [README](README.md#highlights); installing it, in the
[installation guide](docs/INSTALL.md).

- **Your addons:** catalogs, title details, sources and subtitles from the Stremio addons you add
  by link, or import from your Stremio account, AIOManager or a configuration file.
- **Finding something to watch:** Home with Watching, Calendar, Movies, Series, IPTV, Radio,
  Sports and Local tabs; Discover; Search across every addon that can search, and people by
  name.
- **Title pages:** ranked sources with ▶ Play best, filters by addon and resolution, trailers,
  ratings, Cast & more, collections, episode pages and an episode ratings grid.
- **Playing:** resume, skip intros, recaps and credits, the next episode on its own, the next
  source when one doesn't start, subtitles from addons, the file, YouTube and your USB drive,
  with timing and sync by ear, audio tracks remembered, private viewing.
- **Trakt:** watched marks and viewing progress sync with Trakt; Up next and watchlist rows
  are read from your account.
- **IPTV and radio** from your M3U playlists; **YouTube** channels, playlists, searches and live
  streams, with SponsorBlock, DeArrow, chapters and captions; **a USB drive's** videos matched
  to their titles, and downloads to it.
- **Documentation** for every reader: the [user guide](docs/USER-GUIDE.md), a
  [settings reference](docs/SETTINGS.md), [troubleshooting](docs/TROUBLESHOOTING.md),
  [privacy and data](docs/PRIVACY.md), a [technical reference](docs/TECHNICAL-REFERENCE.md)
  and the [developer guide](docs/DEVELOPER-GUIDE.md). Settings' on-screen hints say the effect
  in a sentence or two.
