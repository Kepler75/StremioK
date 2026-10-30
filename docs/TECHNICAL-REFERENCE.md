# StremioK technical reference

How StremioK works inside: what it keeps, what it asks for and when, and the TV quirks it works
around. For using it, see the [user guide](USER-GUIDE.md); for what's sent where, [privacy and
data](PRIVACY.md); for working on the code, the [developer guide](DEVELOPER-GUIDE.md).

- [Starting up and Home rows](#starting-up-and-home-rows)
- [Calendar](#calendar)
- [Discover and Search](#discover-and-search)
- [Title pages](#title-pages)
- [Sources](#sources)
- [Playback](#playback)
- [Subtitles](#subtitles)
- [Audio](#audio)
- [Formats](#formats)
- [IPTV](#iptv)
- [Addons](#addons)
- [Trakt](#trakt)
- [USB drives](#usb-drives)
- [Storage](#storage)
- [Home bar preview](#home-bar-preview)
- [YouTube](#youtube)
- [Limits on what's downloaded](#limits-on-whats-downloaded)
- [The service](#the-service)

## Starting up and Home rows

- **Which tab a row is on** goes by its catalog: movies, series, sports (`sport` / `sports`)
  and radio to their tabs; StremioK's own YouTube catalogs, and other addons' YouTube or
  channel catalogs (YouTubio's), to **YouTube**; live ones (`tv`, `events`, `live`, `iptv`, your
  playlists) to **IPTV**; `anime` (films and series mixed) only to Discover. Another type (a debrid library's, `other`) goes by what it
  lists: mostly films or series (60% of its items), there; title ids (IMDb, TMDB, TVDB, Kitsu,
  MAL, AniList) and "anime", "series" or "show" in its name or type: Series ("movie" or
  "film": Movies). Anything still unclear isn't on Home, only in Discover.
- **Painting:** each row is its own GPU layer (`translateZ(0)`): on the 2017 TV a D-pad move
  reached the screen a quarter or more sooner, more than any other change measured.
- **Long rows:** a row builds its first 30 cards, then 30 more when focus is within 8 of the end.
  Pictures load for the cards on screen and near it; the others when focus is within 10 of them,
  or one at a time, nearest first, once no key has been pressed for 3 seconds (not while playing).
- **A row's length:** a catalog that pages (`skip`) is asked for more pages (skip = titles so
  far, 10 at most) until the row is full or a page brings nothing new.
- The last Home rows and addon manifests are saved on the TV, so a launch shows them at once
  and refreshes them in the background.
- **Nothing waits on something unrelated:** your addons load without waiting for the IPTV
  playlists (a big one takes a while to read); the IPTV rows join Home once they're read. On a
  first load, each row shows as soon as its catalog answers, in its own place: a slower row above
  it keeps its place with *Loading…* until it comes.
- **Saved only when it changed:** playback progress is saved once a minute while it moves (not
  while paused; always on stopping or leaving), the downloads list only when something in it changed, and a second subtitle's
  style only when its settings change.
- The rows are saved twice: a small snapshot (40 rows of 20 cards, just poster and name) in the
  settings storage, read at once, and the whole (up to 60 rows, about 1.5 MB) in the TV's
  database, written without holding up the remote. The whole replaces the snapshot a moment
  later, unless fresh rows came first.
- If the stylesheet doesn't apply on a cold start, it's asked for again (through one extra
  stylesheet link, at once and after 1, 2, 4 and 8 s). StremioK starts as soon as it applies,
  or after that anyway (noted in Diagnostics).
- Rows also refresh after 15 minutes. The tab on screen is only redrawn if what it shows
  changed (Continue Watching never is: its cards don't come from the catalogs), so a refresh
  doesn't flicker.
- Posters are requested at card size and loaded through a throttled queue that favors the
  focused card, so the D-pad stays responsive; one that has loaded shows at once when its card
  is rebuilt. Title-page backdrops, logos and cast photos go through the same queue, sized for
  where they show. An image already on its way isn't downloaded twice, and one that failed
  isn't tried again for 10 minutes (its card shows its title instead).

## Calendar

- *Coming up* comes from the shows' details StremioK keeps for the NEW badges, refreshed every
  12 hours; the tab is drawn again when they change.
- In *Watched*, a title known only by its id (Trakt's history) shows its poster at once and its
  name once its details arrive.

## Discover and Search

- **Genres left out:** a genre an addon lists but returns nothing for twice in a row
  (MediaFusion's Live TV offers every TV genre it knows) is left out of the genre list for a
  day. Once isn't enough, since a busy addon can answer nothing now and then.
- **Genre names** an addon took from a web page's title are shown without the site's ending
  (*Wit Studio*, not *Wit Studio - Companies - MyAnimeList.net*); the addon still gets the name
  it listed.
- **Long catalogs:** however long the catalog (a MediaFusion Live TV has ~16,000 channels), at
  most 600 cards are on the page. Scrolling on drops rows at the top, scrolling back rebuilds
  them from what's loaded, and the remote moves between cards by their place in the grid, so
  it stays quick.
- **Reopening Discover** shows it as you left it, unless the addons changed meanwhile (one
  added, removed or refreshed, its link changed, a playlist turned on or off): then it shows
  the current catalogs.
- **Empty answers:** some addons answer an empty list when they fail (YouTubio does). A catalog
  or search that had titles earlier this session is asked once more after 2 seconds; if it's
  still empty, the titles from earlier come back, marked *from earlier: the addon sent nothing
  just now* (in Discover and on Search rows).
- **Search inside Discover** for a catalog that can't search uses the same addon's search
  catalog for that type (for Cinemeta's Popular, its movie search).
- **Search rows** are named like their Home feeds ("Library · TorBox · AIOStreams"); a catalog
  just called "Search" goes by its type and addon. A search waits up to 25 seconds for an
  addon and a catalog page 12 (longer with *Wait for addons*).
- **People** in Discover come 20 at a time as you scroll; each card has their photo and
  department (Acting, Directing…), and the strip above names what they're known for. Browse's
  titles open through their IMDb id, like Cast & more's.

## Title pages

- **Which cards open a title page:** a card opens its title page when the item is a movie or
  series itself, or has a title's id (`tt…`, `tmdb:`, `tvdb:`, `mal:`, `kitsu:`, `anilist:`,
  `anidb:`, `tvmaze:`), whatever its catalog's type: AIOMetadata's *anime* catalogs (MAL By
  Studio…) list films and shows, and its "anime.movie" / "anime.series" are taken as movie /
  series. Only the rest of a catalog of another type (an IPTV or sports addon's) is taken for
  live channels, played straight away; "No playable source for this channel" is noted in
  Diagnostics (which, and why).
- **Anime ids and IMDb ids:** a movie known by an anime database's id (`mal:32281`) whose
  details also give its IMDb id (AIOMetadata's do) has its sources asked for by both: addons
  that gather from others (AIOStreams) ask only their anime sources by the anime id (Your Name.:
  3 sources) and all of them by the IMDb id (31); the same file from both is shown once.
- **BACK through pages:** the last 6 title and person pages are kept as they were; older ones
  open again when you reach them, so a long chain doesn't fill the TV's memory.
- **An addon's error in place of details** (AIOStreams' ids starting `aiostreamserror.`,
  AIOMetadata's `aiom.error.`, the error as the title's name) isn't taken for the title: the next
  addon is asked, and Diagnostics notes the addon and its message.
- **Episodes listed more than once:** an episode an addon lists once per file is shown once, by
  its best entry (the show's own episode id, a real title rather than a file name).
- **Trailers:** TMDB's trailers join the addon's in your languages (the audio's and the
  subtitles') and in English, each video once, and name the ones the addon left unnamed. The
  best: one in your language first, then official trailers, then teasers, and ticket ads, TV
  spots and clips last. One YouTube won't give out to StremioK (it refuses some studio uploads
  to the kind of player StremioK uses) is passed over for the next, and you're told. An
  episode's trailer is a YouTube video only, official ones first, and never a clip (a scene
  from the episode).
- **People:** a person's titles are ordered by what they're best known for: the titles most
  rated on TMDB (TMDB's own order is roughly when credits were added, and its "popularity" would
  put talk shows they guested on first). Titles open through their IMDb id. Without a TMDB key,
  or when TMDB has no people for the title, the addon's cast, directors and writers are shown,
  and the title's genres and IMDb rating are the addon's when the details have none of their
  own.

## Sources

- **Through a streaming server:** a torrent source (`infoHash`, `fileIdx`) becomes a link on it:
  Stremio's `/{infoHash}/{fileIdx}` (−1: the largest file) with its trackers as `tr`;
  TorrServer's `/stream/play?link={magnet}&index={fileIdx + 1}&play`, its trackers in the magnet.
  Without a `fileIdx`, TorrServer's file list (`&stat`) is read first: the episode's file (none:
  the next source), a film's largest video. Saved sources and Continue Watching keep the torrent, not the link: it's
  made again from your current server, or isn't playable with none. Converting asks Stremio's
  `/hlsv2/{id}/master.m3u8` for the failed link (H.264, HEVC; AAC, AC-3, E-AC-3, MP3, 6
  channels); what plays converted isn't learned in Formats.
- **Request headers:** a source an addon says needs its own player settings (`proxyHeaders`)
  plays with its User-Agent and Referer, as an IPTV channel's: the only two the TV's player
  takes. Any other header it asks for isn't sent.
- **Played before** counts a source that played for a couple of seconds at least. One that fails
  to start later is dropped from it.
- **Ranking within a group:** sources not yet cached by the debrid service last; then release
  type (remux > Blu-ray > web > unknown > TV rip, CAM far below); then HDR before SDR; then your
  addon order; then each addon's own order. Moved down or turned off, resolution ranks like the
  other criteria and the list is one group, **Sources**.
- **Not suitable** marks follow the file (the same file from another addon counts) and are kept
  for up to 200 titles.
- **Sizes** are the ones the addon gives, in its hints or written in a source's name or
  description.
- **The next source** is the best ranked one not yet tried for this playback: never the same
  file again (from another addon), nor one marked not suitable, with your words, outside your
  size limits or not working. It starts at the same place to resume.
- **Notices:** when a source doesn't start, StremioK reads the first few bytes of where its link
  leads. A debrid notice video (Torrentio's *failed_access*, *limits_exceeded*,
  *failed_infringement*, *downloading*…) is recognized by its name, and the service by the
  source's tag (*[TB⚡]*, *[RD⚡]*…).
- **The filter** lists what the title's sources have, within the other button's choice, with
  how many each (*Torrentio · 12*, *1080p · 9*; addons in your order, resolutions high to low).
  A file two addons offer counts for both. It's gone when you open another title.
- **Ranked again** on coming back: changes in Settings (Source ranking, Formats) apply on BACK,
  with nothing fetched again.
- **Caching:** a title's sources are kept for 10 minutes; "no sources" isn't kept, so opening it
  again asks again. When every source addon answers with nothing (one that gathers from others,
  like AIOStreams, can while those are slow), or none answers in time (such an addon keeps
  gathering after StremioK stops waiting), they're asked once more after 3 seconds, still
  showing as loading.
- **From earlier:** the sources you played are kept (the last 3 for each movie or episode, 150 in
  all), not while viewing privately and not one that failed to play.
- Long lists are drawn in batches as you scroll.
- **Characters the TV's font can't draw** (emoji newer than the TV, like some in AIOStreams'
  source names) are left out of source names and descriptions, or swapped for one it has:
  MediaFusion's 🧲 (Unicode 2018) shows as 🔌. Diagnostics notes each one by its code (U+…).
- **Where to watch** sources are recognized by the address they link to or the addon's label,
  never by the file name. An app opens if it's the app the link names, else your listed
  streaming app for it (matched by name across spellings; a service's Amazon or Apple TV channel
  opens that app), else the one visible installed app for it. An addon can't pick any other app:
  the app a link names is used only if it's one of your streaming apps or a visible app for that
  same service, never a hidden or system app. A where-to-watch addon's app link for the title (a
  `tizenUrl`) is handed to the app the way the TV's Smart Hub does.

## Playback

- **Select source** plays as a playback of its own: its quality list, subtitles and captions,
  SponsorBlock sections, request headers and file details are its own, and what's learned
  (Formats, Played before) is about it; the title, its episodes and Private viewing stay.

### Starting and recovering

- **Started means playing:** a source counts as started once its position has moved for a
  second; being opened isn't enough. A failure before that goes to the next source.
- **Nothing playing after 45 seconds:** the next source, or, with none left, it stops and says
  so (not while you've paused it).
- **Jumps after pauses:** after pauses, the TV's player sometimes jumps ahead at the next
  buffering, to where it would be had it never paused. A jump ahead you didn't ask for (more than
  the time that has passed) is taken back to where you were and noted in Diagnostics; the same
  jump twice in a row (a real gap in the file) is let through.
- **In the background**, the TV's player is suspended and restored when you come back; if it
  can't be restored, the stream opens again where it was.
- **A live channel whose stream ends** is counted like a stall: if it keeps ending, it stops and
  says so.
- **An HLS quality that won't start** steps down, then falls back to Auto.

### Video quality

- Read from an HLS stream's quality list only, capped at 512 KB and only if it's a real
  playlist; a debrid MKV / MP4 or any other direct file is never downloaded "to look".
- A stream that needs its own User-Agent or Referer has its list read through StremioK's
  service, with them (a web page can't send those).
- When the list can't be read, the menu says so, rather than looking like a stream with one
  quality.

### Skip times

- **Where they come from:** TheIntroDB (its v4 API), with SkipDB and then IntroDB filling in when
  TheIntroDB doesn't answer or lacks a kind of segment (an episode it only has the intro for gets
  the credits from one of the others; an empty one, ending where it starts or before, counts as
  missing).
- **When:** asked for once the video's length is known (TheIntroDB and SkipDB match it), and
  taken only by the playback that asked (another one started meanwhile: dropped, so one video's
  credits can't end another).
- **Checked against that length:** inside it, in order, credits and preview in its second half,
  intro and recap in its first. Credits or a preview timed on a longer copy (another release,
  running past this one's end) are cut at its end rather than dropped. A preview counts only
  with an end, before the credits (one running to the end comes with the credits).
- **In Diagnostics:** each lookup, with what each source answered (*nothing* when it has none
  for it, *no answer* and why when it failed: in that line, not one of its own), and anything
  cut or dropped and why.
- **On screen:** the 10-second credits stand-in isn't shown on the progress bar.
- **Watched:** reaching the credits marks a title watched only once 80% of it has played;
  choosing *Skip Credits → Next* does at once.

### Anime

- A title opened by a MyAnimeList or Kitsu id (`mal:…`, `kitsu:…`) gets openings, endings and
  recaps from AniSkip, the times submitted for a copy closest in length to yours.
- Whatever AniSkip doesn't give comes from TheIntroDB, SkipDB and IntroDB, asked by the show's
  IMDb id, season and episode. Those ids come from the title's own details when its addon gives
  them (AIOMetadata's do), else from [ARM](https://arm.haglund.dev), which matches anime ids
  across sites.
- A Tizen 3 TV can't reach AniSkip or ARM (both only take newer secure connections than Tizen
  3's browser makes), so there it's the title's own ids and those three sources.

### The next episode

- **Its source:** the addon's binge group first, then the same addon, resolution and release
  group; remembered per series. One with no air date counts as out.
- **Not-ready notices:** a movie or episode source shorter than 2 minutes isn't marked watched
  (nor sent to Trakt), put in Continue Watching, followed by the next episode or counted as the
  format working.

## Subtitles

- **Made for your file:** subtitle addons are told the playing file's name, size and
  fingerprint (when the source gives them), as Stremio does. This is kept with Continue
  Watching, so resuming asks the same way. For a matched USB video the fingerprint is the
  OpenSubtitles hash of the file.
- **Languages:** every language OpenSubtitles uses is known by its 2- and 3-letter codes and its
  names. A file's own tracks are read whichever way the TV reports their language (`language` or
  `track_lang`, even when its track details aren't clean JSON).
- **The order your language is looked for in:** an addon's, a subtitle file next to a USB video,
  a YouTube caption, or a track built into the video; only when none has it is the second
  choice looked for, in the same order (a track to download first, then a built-in one). A
  choice you made for a title wins over both. The second subtitle is the first addon subtitle in
  its language, and isn't shown when it's the language already at the bottom; *Off* in the
  subtitle languages turns both off for that title.
- **WebVTT:** comments (`NOTE` blocks: some subtitle addons put the line their own banner
  overlaps there), `STYLE` and `REGION` blocks aren't shown; codes such as `&amp;` show as the
  characters they stand for.
- **Built-in tracks' timing:** the TV's player hands each line over at its time, so StremioK can
  hold it back (shown when playback gets there; a jump in between drops it) but not show it
  sooner. A built-in track picked on its own at the start is picked once more after a few
  seconds of playback: the TV can take the first pick without showing its lines.
- **Subtitle files on a USB drive:** SRT and WebVTT as they are, ASS / SSA turned into SRT, old
  Windows-1252 and UTF-16 files read correctly. Those next to a playing USB video are there as
  soon as playback starts (one that's your choice or language shows at once; the addons' join
  later without replacing it). For streams, a drive's subtitles come from its saved index (its
  files aren't read again), with a drive plugged in only; one already on the drive isn't offered
  for *⬇ Download*.
- **YouTube's automatic captions** show one line at a time.
- **A subtitle file** gets 20 seconds to arrive (some subtitle servers build the file when it's
  asked for); the video plays on meanwhile. Picked again while it comes, it isn't asked for
  again; another pick (or *Off*) stops it. The last 8 downloaded are kept while StremioK runs.

## Audio

- **Quick (no wait):** the track is picked as soon as the stream is ready, before it plays, and
  the opening seek (the resume one, or to the start) loads that track's audio, so it starts in
  your language with no extra buffering; a track you switch to later reloads at once.
- **Safe, waits 3 / 6 / 10 seconds:** the track is picked once playback runs, then its audio is
  reloaded 6 seconds back (a moment of buffering; the player restarts at the next keyframe, so
  reloading at the same point skipped a few seconds). That reload never comes sooner than the
  time chosen after the stream starts (or resumes) or after a jump, for every switch: the 2017
  TV's player can crash on a jump made right after another (*10 seconds* is what it needed; a
  newer TV may do with less). The track itself switches at once.
- Live streams always switch the Safe way (they can't seek).
- A track already playing in your language is kept, even where the file has another track in it
  first (English, then English commentary).
- Switching in the menu also reloads 6 seconds back, so nothing is skipped (with *Safe*, in its
  first seconds after a start or a jump the track switches at once and the reload follows when
  they're up; a jump of yours meanwhile does that reload itself).
- A series' episode without a choice of its own takes the one made last in that series, by its
  language, the same channel count preferred.

## Formats

A start that fails because of the format (not a dead link or the network) is blamed on the video
profile, audio and file type not yet known to work, never on a codec or HDR on its own, so a 4K
HEVC file that won't play doesn't condemn 1080p HEVC. Something becomes *Not working* after
failing with two different files, at least once as the only suspect. Everything in a source is
*Working* once it has played for a couple of seconds (opening isn't enough). What's playing, in
short (next to the duration), is the TV player's report for resolution, video, audio and
channels where it gives one; the rest is read from the source's name and file.

## IPTV

### Playlists

- **Names:** after its file (`…/sports.m3u8`: *sports*; *sports (2)* when another playlist
  already has that name). A link without a file name (an Xtream `get.php` one), or a name
  cleared with *Rename*, takes the playlist's own `#PLAYLIST:` / `playlist-name="…"`, else its
  server.
- **Radio** is recognized by `radio="true"`, `tvg-type="radio"`, a `group-title` containing
  "radio", or an audio file extension (`.mp3`, `.aac`, `.ogg`, `.flac`, `.m4a`).
- **Sports** counts only `tvg-type="sport"` / `"sports"`, not a group's name.
- **Guide only** (`tvg-type="guide"`): an `#EXTINF` with or without a link, kept for its guide
  (in no row, no sources). OK on a program: the guide's original title and year (a `<category>`
  like `The Book ThiefDrama / 2013 / 7.6`), else its title, looked up on TMDB (with your key,
  Spanish titles too), else Cinemeta (original titles only). One sure match (the same name, and
  the year when known) opens its page; anything else, a show included, opens Search.
- **Size:** each playlist is downloaded up to 20 MB and keeps its first 30,000 channels. Big ones
  are read in chunks, with a count ("Reading playlists… 12,000 channels"), so the remote stays
  responsive. Copies are saved in the TV's database.
- **Duplicates:** a channel listed twice is shown once only when it's exactly the same (link,
  name, group and headers).
- **Auto-refresh:** checked every minute, counted from the oldest playlist's download (a saved
  copy's too, so an old one is read again soon after StremioK starts) and from the last try (a
  server that's down isn't asked every minute). It waits while something plays, or StremioK is
  in the background; its guides are read again at once (`&force=1`).
- **Headers:** a channel's User-Agent and Referer (`#EXTVLCOPT:http-user-agent=` /
  `http-referrer=` or `http-referer=`, the same `#EXTINF` attributes, `#EXTHTTP:{…}`, or after
  a `|` in its link: `…m3u8|Referer=…`) are applied where the TV allows it (these two only,
  printable, within a sane length) and follow the channel when you switch sources.

### Xtream, Stalker and YouTube links

- **Xtream accounts:** checked with `player_api.php` (its `user_info.auth`), then saved as the
  account's `get.php` link (`type=m3u_plus`, `output=ts`: servers' own HLS tends to stall
  minutes in; *Format* switches to `m3u8`). A server without `http(s)://` is `http://`; a
  pasted Xtream link fills in the login.
- **Stalker portals:** read by the service as a MAG box asks (the MAC in a cookie, a MAG
  User-Agent, a `handshake` token) at `portal.php`, else `server/load.php`. Channels
  (`get_all_channels`, else `get_ordered_list` pages) become an M3U playlist, genres as groups;
  a channel's link comes from `create_link` each time it plays, with the MAG User-Agent.
- **A channel's own format:** the player's *Format* swaps one channel's `/live/…/123.ts` and
  `.m3u8`, kept by channel (the last 300).
- **YouTube behind a link:** an Xtream channel's link (`…/live/user/pass/id.ext`) is looked at
  first (redirects followed, the answer not read; where it led is kept 5 minutes, or until the
  playlists reload, as a server can renumber its channels); one ending on YouTube plays through
  StremioK's YouTube.
- **A YouTube channel's page** (`@handle`, `/channel/`, `/c/`, `/user/`, any tab) plays as
  given; with no live stream there, its `/live` page, then its Featured tab.

### Xtream films and series

- **Browsing,** from the TV (`player_api.php`): categories (kept a day) as Discover's genres, a
  category's titles 100 at a time, a title's `get_vod_info` / `get_series_info` for its page;
  it plays `…/movie/user/pass/<id>.<ext>` or `…/series/user/pass/<episode id>.<ext>`.
- **The index,** by the service (`/xtvod/…`): `get_vod_streams` and `get_series` whole, read a
  piece at a time (150 MB, 6 minutes, 100,000 titles each at most) into id, name, year, TMDB
  id and date added; saved in the app's folder a title a line, read and written in small pieces
  so YouTube, guides and the live relay aren't held up. Unused for 30 minutes it leaves memory
  (but for the newest row), and comes back from the file when asked. A list not refreshed for 3
  days is deleted when a guide or list is next asked for; *Clear saved copies* deletes them all.
  While one is being read Home shows *Loading…* and looks again, then redraws. Read again after a day (*Reload* on the
  account: at once, its categories too). It answers the newest row (200), Search and matching.
- **Its playlist:** the `/movie/` and `/series/` lines of an account whose server lists films or
  series are left out of IPTV (shown through the API instead); the IPTV rows are made again,
  from the saved copy, once its categories say whether it has any.
- **Matching** a title from your addons: its TMDB id, else its name and year, both without a
  language tag (`EN - `, `|EN|`), brackets, quality words or accents. An episode: its show,
  then the season and number in `get_series_info`.

### TV guide

- **Where it comes from:** a playlist's typed *Guide link*, else its `url-tvg` / `x-tvg-url`,
  else an Xtream `get.php` link's `xmltv.php` (also in place of a guide the playlist names on its
  own server without the login).
- **Read by the service:** gzipped or not; up to 60 MB, 200 MB unpacked, 5 minutes.
- **Only your channels:** the app sends their keys (`tvg-id`, else the name, plain) as a bitset,
  in a POST's body (a newer TV's service reads 8 KB of a request's address and headers:
  thousands of channels' keys don't fit there).
- **What's kept:** programs from 2 hours ago to 30 hours ahead, 150 a channel (held to that as
  it's read), 60,000 in all, each with its picture (`<icon>`). A channel's `<icon>` stands in
  for a missing `tvg-logo` (none into your home network from a guide on the internet).
- **Answers:** kept to 2 MB; the Guide tab asks 20 channels at a time. A channel whose programs
  don't come (no answer, or past the 2 MB) stays on the Guide tab and is asked again 30 seconds
  later.
- **Saved guides:** on the sideloaded app they're saved in its folder (written whole, then
  swapped in) and read again after 6 hours (a playlist's *Reload*: its guide at once,
  `&force=1`); under TizenBrew, kept in memory.
- **How many:** four guides are kept: a fifth's arrival deletes the oldest's file, a file older
  than 2 days is deleted, one over 32 MB isn't read. *Clear saved copies* (Storage) deletes the
  saved guides too.
- **The Guide tab** draws 10 channels at a time, reading their programs (and the next 10's) as
  you come to them. Back from a channel played from it, it moves to the time now, on the channel
  you ended on.

### Live channels

- **CH+ / CH−:** only the latest choice counts: a slower lookup for one you passed doesn't
  replace it, and the spinner and any error are for the channel chosen last. A channel number
  waits a second and a half for a second digit.
- **Choppy sound:** some servers cut a channel's sound (AAC) into pieces that don't start at a
  whole frame. Once an HLS channel plays, StremioK's service looks at the start of one of its
  segments; when its sound is cut that way, the channel restarts through the service, which
  repacks the sound (whole frames, each with its own time) and passes the picture as it is.
  Remembered per channel link for two weeks. Not for encrypted streams or sound it can't read.
  A look still under way stops when you switch channel or close the player, its downloads in the
  service with it (zapping doesn't pile them up).
- **Closed captions:** the same look says which caption channels (CC1–CC4) have text, and their
  language (English, Spanish, Portuguese) from its words; none yet: asked next time. On,
  the channel plays through the [relay](#live-relay), as subtitle tracks. HLS only: a plain
  MPEG-TS stream (Xtream's default) has no playlist to add it to.
- Live addons without a `meta` resource still open, using the catalog entry.

## Addons

### Local-network links

With *Local-network links from internet addons* blocked, home-network addresses are loopback,
private, link-local (incl. cloud metadata), carrier-grade NAT, documentation, benchmarking,
multicast and reserved IPv4 ranges, their IPv6 counterparts (unique- and link-local,
IPv4-mapped, NAT64, 6to4), and `localhost`, `*.local`, `*.lan`, `*.home.arpa`, `*.internal`;
`localhost.` counts as localhost, and IP addresses in unusual forms (`127.1`, `2130706433`,
`0x7f.0.0.1`, `0177.0.0.1`) are refused everywhere. Host names are read as the browser reads them
first: `%`-escapes decoded, fullwidth characters and the ideographic full stop folded
(`127。0。0。1` is `127.0.0.1`), invisible characters dropped. It applies at any depth of what an
addon sends (an episode's own sources too). A public link StremioK downloads itself (addon
answers, subtitles, playlists) that redirects into your network is refused too, though only once
it's there: the TV's browser engine follows a redirect before StremioK sees where it led, so the
request into your network has been made, but its answer isn't used. A public name that resolves
to a local address (DNS, incl. rebinding) isn't caught, nor a redirect followed by the TV's
player or an image: the web engine gives apps no way to look up an address or stop a redirect.

### What an addon sends is checked

Rebuilt from its JSON as plain data, the fields StremioK names for itself left out (an addon
can't set them), the usual fields only of their usual kind (a title is text, a season a number,
episodes a list), long text and lists cut short, and names every object already has
(`hasOwnProperty`, `__proto__`…) dropped; a manifest's resources, types, catalogs and their
extras the same.

### Changing addons

Adding, removing, moving, refreshing or turning off an addon or a playlist (or allowing local-network links)
clears what came from the old set (title details, sources, the catalog pages kept for an addon's
empty answers), and a load still under way for the old set keeps nothing: a removed addon can't
come back. Adding, refreshing or removing one only touches that addon: its manifest and its Home
rows are fetched (or dropped), and every other row keeps what it has. The same goes for an IPTV
playlist, and reordering or hiding Home feeds fetches nothing at all.

### Waiting

*Normal* is 12 seconds for a manifest, a catalog page or a title's details, 15 for its subtitles
and sources and 25 for a search; 20, 30, 45 or 60 seconds wait at least that long for all of
them.

## Trakt

### Sign-in

- **Client ID:** StremioK is the Trakt app, so its Client ID is built in: a public id, not a
  secret (Trakt gives apps installed on people's devices no secret; signing in always takes the
  account owner's approval).
- **The QR library** is loaded the first time the sign-in opens, not at launch.
- **Tokens:** an expired token is never used. Disconnecting stops everything still under way for
  that sign-in (a token renewal, a refresh, a change being sent: their answers are ignored).

### Progress

- **Sent** once past the first minute.
- **Stopped past 85%** (before the credits) is sent as finished, so Trakt marks it watched, and
  here it leaves Continue Watching with the next episode queued.
- **Stopped between 80% and 85%** is sent as 79.9% (Trakt takes no later place for something
  paused) while StremioK keeps your exact place.
- **Played to the credits:** sent as finished too, which also clears a place Trakt kept for it.
- **A show Trakt has a paused episode of** isn't added again on its next episode, unless you've
  since watched that episode or a later one (on any device): that paused place, and one this TV
  kept, is then left out.

### Reading Trakt

- **Your history:** Trakt sends watched lists a page at a time, and shows with their episodes
  only when asked. StremioK asks for them, 250 movies or 100 shows a page, and reads every page
  up to the count Trakt gives (100 pages at most).
- **Weighing marks:** a mark made here is weighed against Trakt's history by time: marked not
  watched here, then watched on another device later: watched. Once Trakt confirms a "not
  watched", the mark here is dropped and Trakt decides again.
- **Limits:** Trakt's answers are limited to 8 MB and checked (IMDb ids, season and episode
  numbers, lengths) before anything is kept; the watched history is kept in the TV's database.
- **Refreshes** run one at a time and wait longer after a failure, and not during playback.
- **Up next** lists the 15 shows you watched most recently, the latest first; finished shows are
  left out.

### Sending changes

- **The outbox:** changes are sent at once and kept until Trakt confirms them, retried after
  30 s, 1 min, 2 min… (up to an hour apart, 8 tries; Trakt's Retry-After when it's busy), 100
  titles / episodes a request. At most 200 changes wait. A refresh sends what's waiting first,
  then reads Trakt.
- **One place a title:** of several places for one title waiting, only the latest is sent.
- **In the order you made them:** changes to the same title or episode wait for an older one
  still being retried, and a newer watched / not watched (or a finish) takes back the older ones
  for it that haven't gone yet, so an old change can't undo a newer one.
- **Confirmed means sent:** a change counts as sent only when Trakt's answer confirms it (a reply
  that isn't Trakt's JSON is retried); a finish Trakt already has (409) counts as sent.
- **Shows Trakt splits in two:** an addon may number an episode as season 17 where Trakt has it
  as season 10 of another show, and Trakt answers 404. StremioK then sends it again by the
  episode's TheTVDB number when the addon gives it (its `tvdb_id`, or TheTVDB's picture of the
  episode).

## USB drives

- **When drives are read:** nothing is read at launch. Drives are read when the Local tab (or
  Settings › Content › USB drive) opens, or when a title page asks for its sources with a drive
  plugged in (then only the drive's saved index, not its files: a few seconds at most). From then
  on plugging one in or out updates it. A title's sources always show the drive's matches as they
  are now, even when its addons' answers are kept from a moment ago.
- **Matching:** your installed search addons are asked once per title (the first two search
  catalogs of that type, in your order), and only a close match is taken (the same name, and year
  when the file has one). A camera's file (`IMG_0042.MOV`, `VID_…`, `GOPR…`) isn't asked about.
  A show's files are asked about once, not per file.
- **Plain files** go in Continue Watching by their place on the drive and their size (so the same
  path on two drives isn't taken for one file; found again on whichever drive has that file).
  Your own matches are kept per file the same way.
- **The index** lists up to 5,000 folders / 20,000 files, 12 levels deep. Stopped while listing,
  nothing new is kept; while matching, the listing and the matches so far stay. *Clear the USB
  index* while one runs stops it too. Matching runs 300 titles at a time, two at once, waiting
  while StremioK is in the background.
- **Big files on the 2017 TV:** its player can't read past 2 GB of a file played straight from
  the drive (it plays from the start, but every jump stalls), so a file over 2 GB plays through
  StremioK's service (a link on the TV itself) instead. Smaller files, and files on newer TVs,
  play from the drive.
- **Folder listings:** where the TV's own listing can't read something in a folder (the 2017 TV
  can't read a file over 2 GB that StremioK's service wrote), the folder is listed by the service.
  Tizen 3's listing fails a whole folder when it can't read one entry's details (a name it can't
  convert…): such an entry is still listed (its details worked out from its name), and a folder
  the TV can't list at all is listed through the service. Tizen 3's file API also refuses any
  path with an apostrophe (`Ender's Game.mkv`), another case the service covers.
- **What the service reads:** USB drives only (`/opt/media/…`): folder listings, subtitle files
  and a video's first and last 64 KB for its hash, never a path elsewhere (links pointing off the
  drive are refused).
- **File links are raw** (`file:///opt/media/USBDriveA1/Share/El Pájaro Loco.mkv`), as the TV's
  own are: its player refuses %-escaped ones (`PLAYER_ERROR_INVALID_URI`, checked on the 2017 TV
  with accents, apostrophes, `+` and brackets).
- **Downloads:** StremioK's service downloads into a `….part` file renamed when it's complete; a
  dropped connection is picked up where it stopped (when the server allows it, as debrid servers
  do), up to 5 times. A download is matched to the title it was downloaded for (nothing guessed
  from its name, no indexing again). Downloads use their own up-to-date list of trusted
  certificates (the 2017 TV's own is too old for many servers).

## Storage

- **Two stores:** the settings storage (about 5 MB, shared by progress, watched marks and
  settings) and the TV's database (IndexedDB) for big copies: Home's saved rows, IPTV playlist
  copies, USB drive indexes, the Trakt history. Saving to the database doesn't hold StremioK up.
- **When the settings storage is full,** what matters wins: saving progress, watched marks,
  settings, addons or playlists clears regenerable caches (saved Home rows, playlist copies, show
  info, saved manifests) until it fits; if it still can't be saved, you're told and it's in
  Diagnostics.
- **When the database is full:** when something large compared with what the TV allows doesn't
  fit, Home's saved rows are given up first, then a USB drive's index, then playlist copies, one
  kind at a time until it fits. A refusal for something small isn't that (the TV refuses even a
  few KB at times, for a while: right after an install, or while its database catches up on
  space it hasn't reclaimed yet): nothing is given up, and it's tried again a minute later, up
  to three times (meanwhile the Trakt history is kept in the settings storage). Each refusal is
  noted in Diagnostics with the item's size, what the TV allows and uses, and its free disk
  space. The Trakt history is only saved again when it changed.
- **TV storage** (Diagnostics › Storage) shows how much the TV says the database uses of what it
  allows, how much of that is StremioK's own data and how much the database's own (old versions
  of items saved again), each item with its size, how many times it was saved since StremioK
  started, and whether it's no longer used or also in the settings storage; then the settings
  storage's largest items and the TV's free disk space. What the TV allows StremioK follows that
  space: roughly a fifteenth of it.
- **Tidying up** deletes the database and writes StremioK's data back into a new one. The 2017
  TV's database doesn't always clear old versions out itself (seen full, with 0.6 MB of
  StremioK's own in 16 MB, refusing every save), so StremioK also does it on its own when they
  take more than half of what the TV allows: half a minute after launch, or when a save is
  refused.

## Home bar preview

A small service in the app (`service/preview.js`) gives the TV's Smart Hub its tiles; TizenBrew
has no such service. Only movies and series you can play now get a tile: one you stopped
part-way, or a next episode that has aired (not YouTube, IPTV, sports, radio or USB files). The
tiles are sent when StremioK opens and when you leave it, at most once every 10 minutes (as
Samsung asks); the TV also asks for them now and then. They count as sent only once the preview
service confirms the TV took them; a failure is tried again after 1, 5 and 15 minutes. *Off* empties the row. The 2017 TV shows
no preview for it, so it isn't offered there.

## YouTube

- **StremioK's own YouTube** asks YouTube's InnerTube API from the TV, as the YouTube website does
  (no key, no account). A YouTube channel or playlist opens as a series; without dates (YouTubio's
  are all 1970) its videos are one list in the channel's order (YouTubio's "Channel Options" entry
  left out). Episodes go by their titles, not S1E12.
- **YouTube cards** (YouTubio's "YouTube" type, Stremio's "channel") open their page, never the
  live-channel path. A single YouTube video (a YouTubio video: nothing to choose) plays as soon as
  it's opened, and stopping goes back where you opened it from; if it doesn't play, its source
  list is next.
- **Copy from YouTubio** reads its catalogs from its link (YouTubio keeps its settings in it):
  channels, playlists, search links (with their words, what they list and their order), catalog
  names and types. Its search is left out (YouTube in Search is that), and one you have already
  isn't copied twice.
- **Original titles:** YouTube's answers carry a title only in the language they're asked in, so
  for *Original* each list is asked a second time in a language it doesn't translate titles into,
  and only the titles are taken from that (one more small request per page; if it fails, the
  English titles). A video's own page has its original title.
- **SponsorBlock:** a whole-video label ("Exclusive access") is a note when the video starts.
- **DeArrow:** a thumbnail that isn't made yet shows YouTube's.
- **Chapters** are the video's own, as YouTube shows them: the uploader's from the description,
  else YouTube's automatic ones. Scrubbing lands on a chapter start within half a step (5 s with
  LEFT / RIGHT, 15 s with FF / REW and when holding a direction); the next press goes on from it.
- **Dubbed audio:** picking a language reopens the video in it (about a second, like a quality
  change), since switching tracks inside such a stream hangs the 2017 TV's player.
- **End screens and cards:** links to channels, playlists and websites aren't shown.

## Limits on what's downloaded
Anything from an addon, a playlist or an API is size-limited as it arrives, so a single answer
from a broken or hostile server can't fill the TV's memory (many answers kept together still
add up: the session caches are bounded by how many entries they keep, not by size): JSON answers (manifests, catalogs, streams, API
answers) 2 MB, a title's details 4 MB (One Piece's episode list is 1.4 MB), subtitles and
other text 5 MB, IPTV playlists 20 MB, HLS quality lists 512 KB, the configuration import
256 KB. Answers are checked before use (a list must be a list; junk items are dropped) and
capped: 1,000 titles a catalog page, 500 sources an addon, 300 subtitle tracks, 5,000
episodes, 200 catalogs an addon, 30,000 channels a playlist. An addon that doesn't load says
why in Settings › Content › Addons ("too large (over 2 MB)", "not an addon manifest", "timed out"…),
with what the addon itself said when it refused (for example AIOStreams' "Invalid stream
expression … Expected :" for a configuration it can't read); *Refresh* says it too.

A screen left for good (BACK out of a title page, Discover or Search, or Home from the menu)
stops what it was still downloading — its details, ratings, cast, episode information, where
to watch, catalog pages or search rows — the transfers themselves, not just their answers.
Sources aren't stopped (they're shared, and the next episode's are fetched ahead). A download
several screens share (TMDB's answers) is stopped only once every screen waiting on it has gone.
What still comes back for a screen that's gone changes nothing: a title page's sources or
details (no playback, no BACK, no "couldn't load"; a canceled request isn't an error), the
YouTube service starting for a trailer or a video, a search's rows still waiting their turn
(not even asked) and a link's video, a configuration file's import (it's imported, but the
screen you're on stays). After a failure the player closes a moment later only if nothing
else has started meanwhile (another title, another source, a retry), and a seek retried on
its own is for the same playback only. Choosing subtitles (a track, Off, a built-in one)
drops a download still on its way for an earlier choice, without a word. While
StremioK is in the background (the TV's Home, another app), artwork, Trakt's periodic
refresh and matching a USB drive's titles wait until it's back.

Artwork loads three pictures at a time. One that neither arrives nor fails within 12 s is
given up on (the card shows its name, and it's noted in Diagnostics), so a stalled image
host can't hold up every poster after it; a download for a screen you've left is stopped.
Pictures that failed aren't asked for again for 10 minutes (the last 300 are remembered).

URLs you type or import (addons, playlists, the configuration file), and subtitle and artwork
links from addons, go through one parser: http(s) only, a real host and port, no
`user:password@` in the address. Addon URLs keep a query after `manifest.json`, and
`stremio://` install links work. An addon's logo (its manifest's `logo`, else `icon`) follows
the artwork rules, or is a base64 `data:` PNG, JPEG, GIF, WebP or SVG under 50,000 characters;
from an internet addon, never a link into your home network. It loads through the artwork
queue, and its initial shows until it does.

## The service

StremioK's service (`service/index.js`) does on the TV what a web page can't do on its own:
YouTube, USB drive listings, subtitle files and downloads, the phone page, AIOManager, and
repacking a live channel's choppy sound.

### Runtime and ports

- One file, Node core modules only, ES5 (the 2017 TV's Node is 4.x).
- **Sideloaded app:** a bundled `<tizen:service>` on `127.0.0.1:8099`, which the app
  (`js/ytplay.js`) starts when it needs it.
- **TizenBrew:** TizenBrew runs the same file inside its own Node service, on `127.0.0.1:8098`,
  and starts it when it launches StremioK. Since it then shares TizenBrew's process, every
  request is fenced off: a failure ends that one request, never the service. Separate ports let
  both installs live on one TV.
- **The phone page** listens on a second port, the service's plus 10 (8109, or 8108 under
  TizenBrew), on the TV's home-network address only, and only while a page is open.
- The home bar preview is a separate small service, `service/preview.js` (the sideloaded app
  only; see [Home bar preview](#home-bar-preview)).

### Who it answers

These checks keep web pages out (any page running in the TV's browser engine can reach a local
port). They are restrictions on requests, not proof of who is calling.

- **Every endpoint but `/health`:** the request must name the service by its local address
  (`127.0.0.1` or `localhost` with its port, so a page reaching it through a DNS-rebound name is
  refused) and carry no `Origin` header. StremioK's pages and the TV's player send none, while a
  web page's request always does. Under TizenBrew, TizenBrew's own pages
  (`http://127.0.0.1:8081`) may send theirs, and every TizenBrew module shares that address.
  A browser's pre-check (preflight) carries an `Origin`, so it's refused too. GET only.
- **USB, files and downloads** (`/fs…`, `/fsdl/…`) also need a token. The service keeps it in
  StremioK's private folder (`wgt-private`), and the app reads it and sends it. Where the app
  can't read it (on Tizen 6 the service keeps it in a folder of its own), an `X-StremioK`
  header is accepted instead, which a web page can't add without a pre-check. Under TizenBrew
  there's no private folder and so no token: these endpoints stay closed. Their answers carry
  no CORS header.
- **The phone page's controls, AIOManager and opening a live relay** (`/entry/…`,
  `/aiom/addons`, `/live/open`) need the token or the `X-StremioK` header. Under TizenBrew,
  where there's no token, the header is what's sent. The app sends the header only when it
  has no token: on the 2017 TV's engine an extra header might make it send an `Origin`.

### Endpoints

Each endpoint's parameters are described at the top of `service/index.js`.

| Family | Endpoints | What it does | Needs |
|--------|-----------|--------------|-------|
| Health | `/health` | "ok": the app waits for it before playing | nothing |
| YouTube | `/yt`, `/ytinfo`, `/ytsubs`, `/ytsb`, `/ytlist` | A video's HLS master; its audio languages, end screen, cards and chapters; its captions as WebVTT; SponsorBlock sections and DeArrow; searches, channels and playlists | local address, no `Origin` |
| USB drives | `/fslist`, `/fswalk`, `/fssub`, `/fshash`, `/fsfile` | A folder's listing; every video and subtitle file under a folder (the index); a subtitle file as UTF-8; a video's OpenSubtitles hash; a file served with ranges | + token or header |
| Downloads | `/fsdl/add`, `list`, `cancel`, `clear`, `space` | Downloads to a USB drive, and a drive's free space | + token or header |
| Phone page | `/entry/open`, `poll`, `close` | Opens, polls and closes the one-time page | + token or header |
| AIOManager | `/aiom/addons` | Reads an account's addons | + token or header |
| Xtream films and series | `/xtvod/list`, `/xtvod/find` | An account's newest titles and Search; a title's copies | + token or header |
| Stalker | `/stalker/list`, `/stalker/link` | A portal's channels as an M3U playlist; a channel's link to play | + token or header |
| TV guide | `/epg/load`, `/epg/get` | Reads a playlist's guide for your channels; their programs | + token or header |
| Live relay | `/live/open`, then `/live/<id>/…` | Checks a channel's sound and captions; relays it repacked, captions as subtitles | open: + token or header |

### YouTube

- **Resolving:** a YouTube page is resolved through YouTube's InnerTube API, from the TV, as the
  YouTube website does (no key, no account), and its HLS master served at `/yt`.
- **Quality:** playback first asks for 1080p when that resolution is available (in a wider
  picture, like a 2:1 trailer's 1920×960, the rung at or below it). The complete master is
  loaded separately to fill the **Video quality** menu, each quality named by its class, wide
  pictures too (1920×960 is *1080p*, 3840×1920 *2160p*). Picking a quality reopens the stream
  with a fresh YouTube session and a single-resolution master; **Auto** restores the full
  ladder. The player is stopped and given a moment before it reopens, since the TV's player
  often fails an open straight after closing a playing stream; if that first open still fails,
  it's retried once quietly ("Switching to 720p…"), then steps down a rung, then goes to Auto.
- **Tizen 6 headers:** YouTube's watch page often comes with more headers than a Tizen 6 TV's
  Node reads (an experiment's 7 KB header, 12 KB in all, over its 8 KB). The service then reads
  that answer itself, straight off the connection, and asks again for anything else it can't
  read (twice at most). That reader accepts only a complete answer: every chunk and its
  end, or its declared length.
- **Audio:** many videos carry AI-dubbed audio (every dub listed, none marked default, a dub
  often first), and switching tracks on such a stream right after it starts hangs the 2017 TV's
  player. The service keeps only the **original** audio, as the default (a stream with no track
  marked original is passed on as it is), and the app doesn't switch a YouTube video's audio on
  its own. Another language is another stream: `&lang=<code>` keeps that dub instead.
- **`/ytinfo`** gives the video's audio languages, the links on its end screen and cards (links
  to videos only) and its chapters, all read from the page already fetched. **`/ytsubs`** gives
  a caption track as WebVTT.
- **`/ytlist`** lists a search (`src=search:<words>`, `{term}` filled from `q`; `kind` videos /
  channels / auto / live, `sort` relevance / date / views / rating), a channel (`@handle`, link
  or `UC…` ID) or a playlist (link or `PL…` ID), about 20–30 items a page, with a `next` token
  for `page=`. Shorts are left out. `meta=1` adds the channel's or playlist's name, description
  and picture (and, for a channel, what it's streaming now) and joins up to 4 pages (120
  videos). `orig=1` gives titles in their own language: the same request is made again in Zulu
  (YouTube doesn't translate titles into it) and only the titles are taken from it.
  `brand=1` adds DeArrow's titles, asked per listed video, in parallel, waiting at most 4
  seconds (the rest come next time).
- **`/ytsb`** asks `sponsor.ajay.app` for a video's SponsorBlock sections and DeArrow title and
  thumbnail time by the first 4 characters of its id's SHA-256, as SponsorBlock's own
  extensions do: the answer covers every video sharing them, so the server isn't told which
  one.
- **Hosts:** YouTube's pages and API and `googlevideo.com` (the masters), over HTTPS, with every
  redirect checked against those hosts; `sponsor.ajay.app` for SponsorBlock and DeArrow. An
  answer other than 200 is an error.
- **Limits:** these YouTube and SponsorBlock requests go through one gate: 6 at a time, 40
  waiting (more are told it's busy), at most 600 started a minute, identical ones sharing one
  download (up to 16 waiting on it), each given 30 seconds from start to finish (and 15 s of
  silence). Answers are capped both downloaded (8 MB) and unpacked (10 MB), so a small gzip
  can't expand into gigabytes. Resolving a page: at most 2 at a time, a few waiting, 30 fresh
  a minute, kept 4 minutes. Lists: 60 fresh a minute, kept 10 minutes. SponsorBlock: 300 a
  minute, kept an hour. A request StremioK gives up on (its screen left, the player closed)
  drops the work still waiting for it, and a shared download nobody waits for any more is
  stopped; a lookup already running finishes and is kept for the next ask.

### USB drives and files

- Only folders under `/opt/media/<drive>/`: a path is resolved to where it really is and must
  stay inside the drive it was asked under. Links in a folder are listed as links and never
  followed or walked, and subtitle files, hashes and `/fsfile`'s files are read only through
  that check (a file is opened once, and served only if it's a regular file).
- A drive must be mounted (listed in `/proc/mounts`). Its free space is read with `df`, run
  directly with the drive as its argument, never through a shell, and without holding up the
  service.
- `/fssub` reads subtitle files up to 5 MB: SRT and WebVTT as they are, ASS / SSA turned into
  SRT, Windows-1252 and UTF-16 converted. `/fshash` reads a video's size and its first and last
  64 KB. `/fsfile` serves a file with ranges, for the 2017 TV's player, which can't read past
  2 GB of a file straight from the drive.
- Bounded: 12 file lookups at a time for the whole service, 4 listings at once, and one drive
  walk at a time (the same drive asked again shares it; another is told the service is busy).
  A walk covers up to 5,000 folders and 20,000 files, 12 levels deep, and starts nothing new
  after 90 s.

### Downloads

- One at a time, up to 50 in the list, into a `….part` file renamed when complete.
- A dropped connection (or 60 s of silence) is picked up where it stopped, with a range request
  where the server allows it, up to 5 times, waiting 5 s, 15 s, 30 s, 1 min, then 2 min.
- A resumed answer must start exactly where the partial file ends (its `Content-Range`), for the
  same file (`If-Range`, with the ETag or date the download began with); otherwise it starts
  over. The finished file must be the declared size.
- That ETag or date is kept in StremioK's own folder (the last 64 downloads), never on the
  drive, where a prepared file could lead elsewhere. The partial file's size is read only from a
  regular file, not through a link.
- Checked before it starts: the drive's free space (with 50 MB to spare) and, on a FAT32 drive,
  the 4 GB file limit. The partial file and the finished one must be regular files, not links.
- A streamed playlist (HLS or DASH, by its type or its first bytes) isn't a file: refused.
- Links over HTTP(S) only, never to the TV itself: loopback, unspecified and link-local addresses
  however they're written (`localhost`, `127.…`, `2130706433`, `0x7f…`, `::1`,
  `::ffff:127.0.0.1`, `169.254.…`), checked again on the address a name resolves to when
  connecting. Home-network addresses (a NAS) are allowed. HTTPS checked against the bundled
  `service/cacert.pem`.
- The list is kept in the service's memory; the app keeps its own copy and adds again what the
  service no longer knows after a restart. One that had already finished (its file on the drive
  at its size, no partial file left) is taken as done, not downloaded a second time.

### The phone page

The TV asks the service to open a page (`/entry/open?what=…`), polls it (`/entry/poll?t=…`) and
closes it (`/entry/close?t=…`). At most 2 pages are open at a time (another closes the oldest)
and 12 opened a minute. Each page has a random 128-bit code in its address, takes one entry (8 KB
at most), and closes after 5 minutes, or 30 seconds without the TV polling it. Its port takes at
most 8 connections, and each visit is given 20 seconds (10 s of silence). See
[Typing, or sending from your phone](USER-GUIDE.md#typing-or-sending-from-your-phone).

### AIOManager

`/aiom/addons` reads an account's addons with AIOManager's Hydra API (`GET <address>/hydra/addons`,
the API key sent as `X-API-Key`), up to 2 MB, within 20 seconds in all, and keeps at most 500.
It follows up to 4 redirects on the same server only (HTTP to HTTPS allowed, never the other
way): the key never goes anywhere else. One cancel stops the whole chain. It then registers StremioK (`POST <address>/hydra/register`, best effort),
which is its card in AIOManager's Connections. Nothing else is written to AIOManager. It's done
in the service because an instance only answers the web addresses it's set to. The same host
rule as downloads applies.

### Live relay

`/live/open` looks at the start of one of a channel's segments (up to 1.5 MB) to see whether its
AAC sound is cut mid-frame. If it is, it returns a relay link that passes the picture as it is
and repacks the sound into whole frames, each with its own time. At most 4 relays at a time,
each dropped after 5 minutes unused; playlists up to 1 MB and segments up to 32 MB, 20 seconds
each. The channel's User-Agent and Referer are passed on, and the same host rule as downloads
applies.

Closed captions (CEA-608 in H.264, HEVC or MPEG-2 pictures) at a segment's start: the look reads
the whole segment, up to 8 MB. Asked for (`&cc=CC1-en`; `&fix=0`: sound as it is), the relay adds
a WebVTT subtitle track per channel; a plain playlist goes under a quality list of its own.

- **One download** per segment for picture and captions (kept 30 s for the other, two at a time,
  up to 8 MB); captions kept for the latest 30 segments.
- **Cues** in showing order: a pop-on caption from when it shows; roll-up, one per finished line
  with the lines above; one still on at a segment's end goes on in the next.
- **Timing:** the picture's own clock (`X-TIMESTAMP-MAP`).

### Every request

- An answer within 60 seconds (504 otherwise), except the USB and download endpoints, which
  have bounds of their own.
- At most 64 connections at once.
- A request line up to 2 KB (8 KB for adding a download, whose link can be long).
- Answers say `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
