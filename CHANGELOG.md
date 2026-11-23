# Changelog

What changed in each version of StremioK, newest first. How everything works is in the
[user guide](docs/USER-GUIDE.md).

## 2.4.9 — 2026-11-23
New:
- **Episodes in the player:** on the quick bar for a series, a strip of the season's episodes
  with pictures and watched marks. OK resumes an episode, and hold OK gives *Play from the
  start* or *Mark watched / unwatched*.
- **Channel browser with a preview:** a third IPTV tab choice. Rest on a channel and it plays,
  with sound, in a box under its details; OK watches it full screen.
- **Your addons' live TV in the channel browser:** each catalog is a group after your
  playlists' groups, if it's on in Home feeds.
- **Find in your addons on the IPTV tab:** hold OK on a channel to look up what's on now, as
  the Guide already does.

Fixed:
- **IPTV links to a YouTube channel page:** they play only what's live now, never an old upload
  or a past stream's recording.
- **Addons whose channels are named `iptv:...`:** they play now.
- **Channel browser at 110% or more:** it no longer scrolls as a whole and cuts off the
  right-hand pane.
- **Channel browser menu:** closing it goes back to the channel you held, not the top menu.
- **Quick bar at 110% or more:** it scrolls, so ← Back is reachable.
- **Remembered built-in subtitles:** they no longer pick the wrong track on another source.

## 2.4.8 — 2026-11-22
- **Episode pictures without a TMDB key:** where the addon has none, or its picture doesn't
  load, Cinemeta's are shown (shows with IMDb ids, episodes already out).
- **Fixed: a paused video could jump to the next source** ("Didn't start: trying the next
  source") when paused just as it started, or reload when paused while buffering.
- **Fixed: a title could lose its place in Continue Watching** when resumed on a source that
  never started moving. Such a source now gets one reload, then the next source is tried at
  the same place (a torrent gets 3 reloads).
- **Fixed: every built-in subtitle could disappear after a jump** in an MKV with many, when no
  subtitle language was set or the file had none of yours. Now they all stay. Set a language
  the file has to have the others left out (#26).
- **Fixed: the player's Cast & more with Zoom on** (110% to 140%) didn't scroll to its last
  people.
- **Fixed:** Stream info said "the sound repacked" for anything played through StremioK's
  service (#26); a video reopened at 4× didn't count as started.

## 2.4.7 — 2026-11-21
More of ediziks' IPTV work (#29), ported: thank you again!
- **IPTV:** a live channel with no sound or picture recovers (its first audio track, the next
  copy, its sound repacked); copies ranked by what the TV measured; **⟲ Recent** on the IPTV
  tab; favorites survive a renumbered playlist; "EU | UK" groups keep countries apart.
- **Fixed:** on 2024 TVs StremioK's service kept nothing (guides and playlists read again each time).

Also:
- **Speed** in the player's menu (#27): 1×, or 2× and 4× without sound (under TizenBrew 0.5× to 2×).
- **Settings › Playback › Player screen** (#27): *BACK while a video plays* (at once, or press
  twice) and *Time shown* (when it ends, what's left, or both).
- **The remote's INFO key** opens the stream info, which now shows the bitrate (#27).
- **Home rows still loading** show gray cards the shape of their posters (#28).
- **The player's Cast & more:** a person's titles show the character they played, or their job.
- **Fixed:** Nuvio plugins saying "its code isn't on the TV" (#31); CH+ / CH− onto a channel
  that leads to YouTube; channels whose server refuses the TV's player.

## 2.4.6 — 2026-11-20
- **Fixed:** on newer TVs (such as 2021’s, Tizen 6) StremioK’s service was failing to store
  information, causing guides and playlists to be read again each time, and USB drives stayed
  closed to it. It now uses StremioK’s own folder on those TVs.

## 2.4.5 — 2026-11-20
Much of this release comes from ediziks' IPTV work (#29), ported and made configurable. Thank you!
- **Big playlists:** StremioK's service reads an M3U up to 250 MB, or an Xtream account's live
  channels from its API, and the TV gets only the *Channel groups* you pick: on the TV, or
  ticked on your phone (*▣ From phone*). Xtream: *Live TV only*.
- **Tidier channel lists** (Settings › Content › IPTV › *Channel list*): *Merge duplicate
  channels*, *Countries first*, *Hide channels with these words*. Divider lines no longer show.
- **TV guides matched by country** ("TR: FOX" takes the Turkish guide), bigger guides read whole,
  *Extra TV guides* (epgshare01's or any link) and *TV guide names* (Settings › Content › IPTV ›
  *TV guide*), and *TV guide matches* in Diagnostics.
- **Catch-up:** past programs marked ↺ on the Guide and in a channel's schedule play as
  recordings; *⏮ From the start* for what's on. Xtream accounts, playlists with catch-up
  attributes and Stalker portals. A recording the provider refuses says so.
- **The channel list in the player:** LEFT on a live channel, with what's on now and next; CH+ /
  CH− then go through that group.
- ***Live TV behind the menus*** (Settings › Playback › *Live TV*, off by default): BACK keeps a
  channel playing behind Home.
- ***IPTV tab › Channel browser*** (Settings › Home): groups, channels and what's on, in three
  panes. *Start on* can also play the last IPTV or Guide channel.
- **↻ on an addon's or a playlist's row** reads it again. Lists to tick have their buttons on top.
- **Fixed:** *Skip intro* sometimes jumped back after a pause; the Guide tab could stay on
  *Loading…*; changing *Channel groups* showed the old ones for minutes.

## 2.4.4 — 2026-11-18
- **Profile pictures** (Settings › Profiles › a profile › *Picture*): a photo from your phone or
  an image link, made small and kept with the profile, in place of its initial (#25).

## 2.4.3 — 2026-11-17
- **Through StremioK's service, your languages come first:** your preferred audio and subtitle
  tracks listed first, no need to 'safely switch'.
- **Subtitles in your language: the file's own first,** then an addon's (in your addon order), a
  USB drive's, a YouTube caption; then your second choice the same way. A built-in one comes on
  as soon as the video plays.
- **When it ends:** under the time at the top right of the player, *Ends 21:47* (not on live
  channels).
- **Fixed: built-in subtitles back in English** after the audio switched, on 2017 TVs.

## 2.4.2 — 2026-11-16
- **Built-in audio and subtitle tracks named from the file** more often: also when the TV lists
  fewer tracks than the file. The subtitle list says each language in full, and of your
  language's subtitles a plain one is picked before SDH.
- **Files with dozens of subtitle tracks jump cleanly:** after a forward jump the picture could
  stutter and lose frames, subtitles on or off. Such an MKV now plays through StremioK's service
  with only your languages' subtitle tracks (*Leave out other subtitle tracks*, Settings ›
  Playback › Seeking & buffering).

## 2.4.1 — 2026-11-15
- **When StremioK opens** (Settings › Profiles, with 2 or more): ask who's watching, the last
  profile used, or always one of them.
- **Fixed: switching profile asked "Who's watching?" again**, so it seemed not to have switched.
- **Fixed: a blank Watching tab:** one saved title without an id stopped the whole tab drawing
  (#20).

## 2.4.0 — 2026-11-14
- **Profiles** (Settings › Profiles): up to 5, each with its own addons, settings, progress,
  watched marks and sign-ins; playlists, drives, folders, plugins and API keys stay the TV's.
  "Who's watching?" as StremioK opens; the badge in the top menu switches (#23).
- **A new profile from a Stremio or Nuvio account**, kept in sync with it (Nuvio: where you
  stopped, watched marks and its Library), or from a configuration file. *Import profiles from
  Nuvio* copies its profiles once, offering their plugins too.
- **Import addons from Nuvio** (Settings › Content › Addons), as from a Stremio account. Nuvio
  features use Nuvio's published backend; StremioK isn't affiliated with Nuvio.
- **YouTube playlist links:** a playlist's page in *▶ Play a link*, or a YouTube page pasted into
  Search, opens as its videos.
- **Largest playlist** (Settings › Content › IPTV): 20 MB and 30,000 channels by default; up to
  100 MB and 150,000 channels for a bigger playlist, at a risk on older TVs.

## 2.3.8 — 2026-11-13
- **Catalan** (Settings › Appearance › *Language*), contributed by deivids84 (#22).
- **Fixed: Nuvio plugins finding nothing on some TVs:** every request a plugin made was refused
  by StremioK's own service ("not allowed (origin)" in Diagnostics › Logs) (#21).

## 2.3.7 — 2026-11-13
- **Windows / NAS shares (SMB) and DLNA media servers** as network folders (Settings › Content ›
  Network folders): a share's server, sign-in (or a guest) and one of its shares; or a media
  server found on your network. WebDAV folders with Digest sign-in work too.
- **What's in the file:** Stream info shows its codec, HDR, what its Dolby Vision plays as on
  your TV, and each audio and subtitle track with its own name (also in the colored keys' lists).
  USB drives' by default (*Read the file's details*).
- **Subtitle styling:** italics, bold, underline and the file's colors (SRT, ASS / SSA; colors
  with *The file's colors*), lines that overlap shown together; SAMI, MicroDVD, MPL2 and TMPlayer
  files; Central European and Cyrillic encodings; USB subtitles in a `Subs` folder or by episode.
- **Backup and logs:** Export configuration can include your history and progress, and saves to
  a USB drive too; *Restore from a USB drive*. Diagnostics › Logs › *Send to your phone* or *Save
  to a USB drive*, oldest first, with the TV's model; Troubleshooting says how to report a problem.
- **Nuvio plugins** no longer hold up a title: they get the time addons do, and *No sources
  found* names each that failed.
- **Fixed: playback jumping ahead after a pause**, by as long as it was paused.

## 2.3.6 — 2026-11-11
- **Nuvio plugins** (Settings › Content › Nuvio plugins; 2017 and newer TVs, sideloaded
  app): add a repository made for the Nuvio apps and turn on its plugins; their sources show on
  title pages with your addons'. Off by default, with a warning first: a plugin is someone
  else's code, kept apart from your settings and files ([Nuvio plugins](docs/PLUGINS.md)) (#21).
- **Sources that need their own headers play:** a file whose host wants headers the TV's player
  can't send (Origin, Accept, Accept-Language; under TizenBrew, any) plays through StremioK's
  service, seeking included. Hold OK on a source › *Play through StremioK's service* works for
  files too.

## 2.3.5 — 2026-11-11
- **StremioK in 16 languages** (Settings › Appearance › *Language*): English, Spanish,
  Portuguese (Brazil), French, German, Italian, Polish, Russian, Hindi, Japanese, Korean, Hebrew,
  Arabic, Chinese (Simplified), Turkish and Finnish. Automatic follows the TV's language, and
  StremioK restarts in the one picked. Titles and synopses still come from your addons.
- **Translations anyone can edit:** each language is a plain file in `translations/`, corrected
  or added from GitHub ([Translating StremioK](docs/TRANSLATING.md)); one at least 90% translated
  appears in Settings by itself.

## 2.3.4 — 2026-11-09
- **Your Stremio account, kept in step** (Settings › Content › Integrations › *Stremio account*):
  Continue Watching, watched marks and your Library sync with it, both ways; the latest change to
  a title wins. Your Library is a *Stremio Library* row; *+ Stremio Library* on a title page adds
  to it.
- **Importing addons** uses the connected account, without signing in again.
- **Large media server libraries:** Jellyfin, Emby and Plex lists of titles are read 2,000 at a
  time, so a big library's copies show on title pages; one too big or slow is searched by name
  (the same IMDb or TMDB id), now on Plex too.

## 2.3.3 — 2026-11-08
- **After a lot of debugging & troubleshooting: TizenBrew has no TV player** (#17): the TV gives
  its own player only to installed apps, so under TizenBrew a file with several audio tracks only
  plays its first one. The audio menu, Settings › Playback › Audio and the installation guide now
  say so; Diagnostics names the player in use.
- **Network folders (WebDAV)** (Settings › Content › Network folders): a folder a NAS, Nextcloud
  or a computer running rclone shares, in the Local tab beside USB drives: browsed, matched,
  indexed, its videos sources (*On your network folder*), with their subtitle files.
- **A network folder's sign-in** is kept on the TV and sent only to that folder.
- **Large Jellyfin catalogs:** when a server's list of titles doesn't come (too big or slow), a
  title is searched for by name and taken only with the same IMDb or TMDB id; a film or episode
  listed without its files gets them from the server.
- **A live channel's choppy sound** is repaired on raw MPEG-TS channels too (an Xtream account's
  default), not only HLS ones; and it's your choice (Red): *straight from the server* or
  *repacked by StremioK's service*, kept for that channel.
- **Fixed:** a cast or crew card cut off the role under a two-line name; under TizenBrew, a closed
  player's video stayed loaded and could play behind the menus.

## 2.3.2 — 2026-11-07
- **TizenBrew runs one version at a time:** a TV could keep an old version, or a mix of two, for
  hours after a release (2.3.0 with 2.3.1 listed, #17). TizenBrew now opens a start page that
  loads one version's own copy.
- **Your media server's watched marks:** what Jellyfin, Emby or Plex has played is ticked here
  too, a show once all of it is; read at launch and every 30 minutes. A mark made here since wins.
- **Watched titles** (Settings › Appearance): their cards ticked (Show), dimmed too (Dim), or left
  out of Home's and Discover's rows (Hide).
- **Emby's seek pictures** above the marker as ◀ ▶ move it, where the library's thumbnail
  extraction made them.
- **A media server turned off and on** (Settings › Content › Media servers, OK on it): off, its
  rows, sources and watched marks are set aside, still signed in; *Turn on* brings them back.
- **Wait for a server** (Settings › Content › Media servers): 45, 90 or 180 seconds instead of 20,
  for a slow one whose rows or Discover pages timed out.

## 2.3.1 — 2026-11-07
- **An audio track chosen while paused, or during a jump,** now plays: the TV refuses a switch
  then, and the menu ticked the track all the same. It's made once the video plays on (#17).
- **Diagnostics › Logs on an audio switch:** the tracks the TV lists, the one asked for, whether
  the TV refused it, and the one it played next.

## 2.3.0 — 2026-11-07
- **Jellyfin, Emby and Plex** (Settings › Content › Media servers): your server's Movies and Shows
  libraries, *Continue watching* and *Next up* as Home rows, and its copy of a film or episode first
  on its title page (*On your … server*). Played as it is, with its subtitle files.
- **Signing in:** Jellyfin with Quick Connect or a password, Emby with a password, Plex with a code
  entered at plex.tv/link.
- **In step with your server:** where you stop and what you finish go back to it, and a film or
  episode carries on from where any of its apps left it. Its intro and credits markers bring Skip
  Intro and Skip Credits.
- **Chapters and seek pictures** for your server's files: their named chapters, as YouTube videos
  have, and pictures above the marker as ◀ ▶ move it, where the server made them.

## 2.2.9 — 2026-11-05
- **A Modern look** (Settings › Appearance › *Look*): the focused title's backdrop behind Home and
  its page, large logos, rounder posters, a centered menu, with any background. *Effects*: blur and
  motion where the TV handles them (Auto: Tizen 6 and later), Light, or Full. Classic stays as it
  was.
- **ClearKey channels with a key server** whose stream names only Widevine or PlayReady now ask
  that server (they stopped with Shaka's error 6012) (#11).
- **HLS through StremioK's service** (Settings › Playback › Seeking & buffering), for hosts that want
  a Referer, User-Agent or Cookie on every piece, which the TV's player can't always send: for the
  sources that need it, or all HLS. Hold OK on a source › *Play through StremioK's service* for just
  that one (#13).
- **Anime and "other" catalogs:** their shows open on their seasons and episodes from Discover and
  Search too, not on sources, and a debrid download on its files (#13).
- **Episode pictures:** one that doesn't load (Cinemeta's for long shows past their first seasons)
  gives way to TMDB's, with a TMDB key (#13).
- **Stalker films and series** (Settings › Content › IPTV): what's read of a portal is kept 10
  minutes, 5, or not at all.
- **YouTube backdrops** in 1280×720 where the video has them.
- **Fixed:** a row's title cut off scrolling back up at high zooms; Discover's bar too wide at 140%;
  LEFT / RIGHT on a single line of Discover titles; the Guide unreadable on Light Gray and White.

## 2.2.8 — 2026-11-04
- **DRM channels** (a playlist's `#KODIPROP` lines): Widevine and PlayReady play in the TV's player
  with the license server the playlist names; ClearKey with its keys or key server, through Shaka
  Player (included, and used only for those). Only with streams you're entitled to: see the
  README's legal note (#11).
- **Films in a playlist** behind a DASH or HLS link can be scrubbed through, as their manifest says
  they're films, not live channels (#11).
- **Export configuration** (Settings › Content): your addons, playlists, Stalker portals, API keys and
  settings as a file for your phone, to bring everything back after a reinstall. *Import
  configuration file* takes it from your phone: its link, the file itself, or pasted (#12).
- **A stream's Cookie** (from a playlist or an addon) is sent with it, for providers whose servers
  need one.
- **Stalker films and series:** a row, category or search shown again within 10 minutes isn't read
  from the portal again.
- **Anime series from other addons:** a show whose card or row calls it a film, *anime* or *other*
  opens on its seasons and episodes when its details say it's a series, not on sources.

## 2.2.7 — 2026-11-03
- **A Stalker portal's films and series:** in the Movies and Series tabs, Discover by the
  portal's categories, and Search; on titles from your addons, the portal's copy is a source
  (*Stalker*). Experimental, like its channels.
- **Settings › Home**, a new group: *Start on*, *Titles in a Home row*, *Home bar preview*, *Menu*,
  *Home feeds* and *Search results* moved there from Appearance, which keeps how StremioK looks.

## 2.2.6 — 2026-11-02
- **Watching:** a title saved without a poster, or whose poster no longer loads, shows its usual
  poster instead of only its name, for titles already there too (#6). One still without a
  poster: see [Troubleshooting](docs/TROUBLESHOOTING.md#home).
- **Start on** (Settings › Appearance): the tab StremioK opens on, any Home tab. Until you choose
  one, Watching. The Guide opens once its TV guide is read.
- **Guide tab:** opened as StremioK starts, its channels no longer stay on *Loading…* until you
  change tabs. OK on a channel still loading plays it.

## 2.2.5 — 2026-11-01
- **A Stalker portal's Channel groups** (OK on it, in Settings › Content › IPTV): tick the genres you
  want and only those are read, however big the portal is.
- **Whole portal** waits longer when a portal stops answering, slows down after that, and keeps what
  it read instead of losing it all at the time limit.

## 2.2.4 — 2026-10-31
- **The remote's ▶ Play key:** on a movie, an episode or a channel (its card, its row, its sources,
  its row in the Guide), plays the top source at once, whatever *Skip the source list* says.
- **Titles in a Home row** has *Unlimited*, for catalogs and IPTV groups.
- **Stalker channels** (Settings › Content › IPTV): *Whole portal* reads past the first 100 pages
  (about 1,400 channels), with a warning; a portal read that stopped short says so.
- **TV guide:** a guide read again (*Reload*, *Auto-refresh*) reaches the Guide tab at once; its grid
  could keep the old titles for up to 2 hours.

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
