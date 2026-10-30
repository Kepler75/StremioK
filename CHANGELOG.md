# Changelog

What changed in each version of StremioK, newest first. How everything works is in the
[user guide](docs/USER-GUIDE.md).

## 2.2.3 — 2026-10-30
- **Xtream films and series:** an account's films and series in the Movies and Series tabs (a show
  is one tile, its episodes on its page), Discover by its categories, and Search. The IPTV tab
  keeps its live channels. Home says *Loading…* while a long list is read; *Reload* on the account
  reads them again.
- **Its copies on your titles:** a film or episode from your addons lists the account's copy among
  its sources (*Xtream*), matched by TMDB id, or by name and year.
- **Stalker portals, experimental** (Settings › Content › IPTV › *Add Stalker portal*): its address and MAC
  address; its channels are a playlist, a row per genre.
- **★ Favorites** shows all your favorites, not the last 30 picked.
- **Titles in a Home row** (Settings › Appearance): 30, 50, 100 or 200; a catalog that comes a page
  at a time is asked for more pages to fill the row.
- **Films in a playlist** (a link to a file) play as films you can scrub through, not as live TV.
- **Subtitles** within a language come in your addon order, each addon's best match first (they
  were shuffled on older TVs).
- **Smoother on older TVs:** D-pad moves reach the screen a quarter or more sooner on the 2017 TV;
  long rows build as you reach them, and pictures off screen load while you aren't pressing keys.
- **Progress** is saved once a minute while playing, and at once when you stop or leave.

## 2.2.2 — 2026-10-28
- **Torrents through a streaming server** (Settings › Content › Streaming server): with Stremio's
  streaming server or a TorrServer running on your network (a computer or a NAS), torrent-only
  sources play like any other. *Test* says whether it answers; torrents get longer to start (2
  minutes by default).
- **Seeders** in Source ranking: torrent sources with more people sharing them first.
- **Zoom** (Settings › Appearance): 100% to 140%, everything bigger to read from further away;
  subtitles keep their own size.
- **Leaving StremioK:** BACK on Home's top menu asks *Exit StremioK?* (OK exits), instead of
  pressing BACK twice (#3).
- **The top menu scrolls** when its items don't all fit, the StremioK name staying at the right.
- **IPTV Auto-refresh** (Settings › Content › IPTV, *Off* by default): every 1, 3, 6 or 12 hours,
  your playlists and their TV guides are read again; never while something plays.
- **Quicker switching:** subtitles (a track still coming isn't started over, the last 8 files
  come back at once) and channels (what StremioK checks on each one stops when you move on).
- **Diagnostics says what went wrong** (*Timed out after 20 s*, *No answer…*) instead of
  "HTTP 0"; slow subtitle servers get longer: 20 seconds for a file, 15 for an addon's list.
- **USB downloads:** a drive prepared with links can no longer make StremioK read or overwrite a
  file outside it.
- **Fixed:** your IPTV rows (and the Radio tab) missing from Home at start-up until a Reload; a
  next episode or a hold menu whose details came late opening after you'd left.

## 2.2.1 — 2026-10-24
- **Every language OpenSubtitles uses** (94, Indonesian among them, #1) for subtitles and audio:
  to pick as your default, second choice or second subtitle, listed by name, and each track
  shown by its language's name ("Pan" is Punjabi).
- **Only my languages** (Settings › Playback › Subtitles, *Off* by default): the subtitle menu
  lists just your languages, and tracks that don't say theirs; *Other languages* at its end has
  the rest.
- **Shorter settings pages:** the subtitles' size, color, background, edge, position and font are
  on a page of their own (*Appearance*); Source ranking keeps *Played before first* above its
  order, with *Filters* and *When you press Play* as pages of their own.
- **Hold OK on a program in the Guide tab:** *▶ Watch now*, *★ Add to / Remove from favorites*
  for its channel, and *Find in your addons* for that program.
- **Fixed:** back on the Guide tab after CH+ / CH− lands on the channel you ended on, at the time
  now, instead of the first channel played.

## 2.2.0 — 2026-10-23
- **A TV guide for your IPTV channels:** what's on now and next on each channel's card, in
  Home's details strip and while a channel plays, and its schedule when you hold OK on it. From
  the guide a playlist names, an Xtream account's own, or a *Guide link* you set (Settings ›
  Content › IPTV).
- **A Guide tab:** your channels as a grid across 2½ hours that follows the clock; OK on what's
  on now plays it, and CH+ / CH− then go through the Guide's channels. The remote's GUIDE key
  opens it.
- **Guide-only channels** (`tvg-type="guide"`): a channel you watch elsewhere (a cable box, say)
  on the Guide tab with its schedule; OK on a film finds it in your addons.
- **Xtream accounts:** add one with its server, username and password (checked with the server
  first). Its channels play as MPEG-TS; *Format* switches the account to HLS, or one channel
  while it plays (the player's menu), kept for that channel.
- **★ Favorite channels:** hold OK on a channel card, *Add to favorites*: a row of their own,
  first on the IPTV and Guide tabs.
- **Closed captions on live channels:** captions inside an HLS channel's picture (CC1–CC4, the
  kind VLC shows) are offered in the subtitle menu, and turn into subtitles when you pick them.
  On an Xtream channel, switch *Format* to HLS for them.
- **In the player:** picture mode kept per channel; *Reload* and a *Sleep timer* in the menu;
  the time of day at the top right.
- **More channels play:** more ways a playlist gives a channel's User-Agent and Referer, Xtream
  channels that lead to YouTube, and channel logos from the TV guide.
- **Put the top menu in your own order:** Settings › Appearance › *Menu*.
- **The IPTV tab has live TV only:** a catalog of films or series sits on Movies or Series.
- **Fixes:** USB downloads checked part by part; a broken subtitle file or TV guide can't hold
  the remote; a first playlist shows the IPTV tab at once.

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
