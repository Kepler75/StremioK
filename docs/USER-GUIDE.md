# StremioK user guide

How to use StremioK, task by task. Also:

- [Installation guide](INSTALL.md): putting it on your TV.
- [Settings reference](SETTINGS.md): every setting, its choices and default.
- [Troubleshooting](TROUBLESHOOTING.md): when something doesn't work.
- [Privacy and data](PRIVACY.md): what's kept, and what's sent where.
- [Technical reference](TECHNICAL-REFERENCE.md): how things work inside.
- [Changelog](../CHANGELOG.md): what changed in each version.

- [Getting started](#getting-started)
- [Getting around](#getting-around)
- [Finding something to watch](#finding-something-to-watch)
- [Title pages](#title-pages)
- [Choosing a source](#choosing-a-source)
- [While it plays](#while-it-plays)
- [Subtitles and audio](#subtitles-and-audio)
- [IPTV and radio](#iptv-and-radio)
- [YouTube](#youtube)
- [Your USB drive](#your-usb-drive)
- [Trakt](#trakt)
- [Other apps (where to watch)](#other-apps-where-to-watch)

## Getting started

StremioK starts with **Cinemeta** (titles and their details) and **OpenSubtitles**
(subtitles). To stream movies and series from addon catalogs, add a **stream addon** that
provides HTTP(S) links, for example through a debrid service; torrent-only sources are listed
but don't play. IPTV playlists, StremioK's own YouTube and videos on a USB drive don't need
one.

### Play your first title

1. Add a stream addon by its link, or import your addons (see below).
2. Open **Movies**, **Series** or **Search**.
3. Select a title (and, for a series, an episode).
4. Choose **▶ Play best**.

### Add your addons

Adding by link, importing from Stremio and AIOManager are in **Settings › Content › Addons**;
importing a configuration file is in **Settings › Content › Import configuration file**. Each
way can be combined with the others.

- **By link:** *+ Add addon*, then the addon's manifest link (`https://…/manifest.json`; a
  `stremio://` install link works too), typed or sent from your phone (see
  [Typing, or sending from your phone](#typing-or-sending-from-your-phone)). Only v3 addons
  work (the usual kind today).
- **From your Stremio account:** *Import addons from your Stremio account* shows a QR code to
  scan with your phone (or a short code to enter at `link.stremio.com`). Sign in to Stremio
  there and approve, and the TV lists your account's addons, each with its name and where
  it's from. Nothing is ticked: OK on one ticks it (or unticks it), *Select all* ticks every
  one you haven't got, and *Import N addons* adds the ticked ones (*Cancel*: none). Ones you
  already have are shown as such and can't be ticked; links StremioK can't use (an addon on
  the computer Stremio runs on) are left out. StremioK signs out of your account straight
  after reading the list: no password reaches the TV, nothing of the account is kept, and
  your Stremio account isn't changed.
- **From AIOManager** (the sideloaded app or TizenBrew, through StremioK's service):
  *AIOManager* opens its own page.
  - *Address*: your AIOManager's. OK lists the public instances AIOManager names (ElfHosted,
    Midnight's, Yeb's, Kuu's: each with its address), then *Another address…* for your own
    instance (typed, or from your phone). *API key*: your account's (AIOManager › the
    account's settings), shown as `••••1234`, typed or sent from your phone. Both are kept on
    the TV (the key like your other API keys); OK on either changes it.
  - **↻ Sync with AIOManager** (with both set; it says when you last synced and how many
    addons AIOManager has): StremioK reads the account's addons and lists what it would do,
    none ticked: **↻ Refresh** the addons that came from AIOManager (their setup read again: a
    change you made in AIOManager to an addon that keeps its link), **+ Add** each one
    AIOManager has (turned on) that you haven't got, **− Remove** each one that came from
    AIOManager and is gone from it, or turned off there, now. An addon you added in StremioK
    yourself stays yours: a sync never refreshes, takes over or removes it. Tick what you want (*Select all* for
    everything) and *Apply N*; it says what it did.
  - Your addons are never sent to AIOManager, and your AIOManager setup isn't changed.
    StremioK does show in its *Connections* as a *Pull* app, with when it last read the list.
  - A key AIOManager refuses is forgotten (the address stays) and asked for again; *Forget
    AIOManager* clears the address, the key and the record of what came from it (your addons
    stay).
- **From a configuration file:** Settings › Content › *Import configuration file* reads a setup list from a text
  file at a link (up to 256 KB). Each line can be an addon link, an IPTV playlist link
  (`….m3u` / `….m3u8`, with a query after it too, or an Xtream-style
  `get.php?username=…&password=…&type=m3u_plus`), an 8-character OMDb key, a 32-character
  TMDB key or a 25-character MDBList key. Blank lines and lines starting with `#` are
  ignored. Nothing is imported at once: what the file has is listed (each addon, playlist
  and key), none ticked; tick what you want (*Select all* for everything you haven't got) and
  *Import N*. What you already have is shown as such and can't be ticked; a key replaces the
  one you have, so the list says so.

**Where an addon came from** shows as a small letter badge after its name: **S** (purple)
from your Stremio account, **A** (teal) added or kept by an AIOManager sync, **C** (gray) from
a configuration file; none for one you added yourself. The line below says it in words
("From Stremio"), and the three import rows wear the same badges. Removing an addon forgets
where it came from.

### Order and manage your addons

- Under each addon's name is what it gives StremioK: *Catalogs* (how many), *Search*,
  *Details* (title pages and episodes), *Sources*, *Subtitles*, and the kinds of titles
  (Movies, Series, Anime, TV…).
- **▲ / ▼** set the order. A title's details (its page, seasons and episodes) come from the
  highest addon that has them, and the higher addon comes first where several answer. A
  title page says which addon described it ("Details: Cinemeta"): if a library addon (one
  describing shows from your files) answers before Cinemeta, move Cinemeta above it. The
  order of the addons that give sources is set separately, in Settings › Playback ›
  [Source ranking](SETTINGS.md#source-ranking).
- OK on an addon: *Refresh*, *Remove*, *Share* (a QR code of its link, to add it elsewhere: it
  carries any personal parts of the link, your tokens, so only show it to your own devices)
  and, for an addon with a setup page, *Configure* (a QR code of that page, to change its
  settings on your phone; adding the new link it gives you replaces the old one).
- **Turn off / Turn on** (OK on an addon): an addon that's off stays in the list, dimmed, with
  its link and its place, but isn't asked for anything (rows, details, sources, subtitles,
  search) until you turn it on. Keep a backup addon off, and switch to it when your usual one
  is down.
- Remove them all and the list stays empty: Cinemeta and OpenSubtitles are added on the
  first launch only.

### Optional extras

- **API keys** (Settings › Content › Integrations; free from each site, or in a
  configuration file): **TMDB** for episode stills and ratings, *Cast & more*, collections,
  "More like this", "where to watch", episode trailers, and Browse and People in Discover;
  **OMDb** for IMDb episode ratings; **MDBList** for the ratings line (IMDb, Rotten Tomatoes,
  Metacritic, Letterboxd).
- **Trakt** (Settings › Content › Integrations › *Trakt account*): scan the QR code with your
  phone and confirm. Watched marks, Continue Watching and your watchlist then follow your Trakt
  account (see [Trakt](#trakt)).
- **IPTV playlists** (Settings › Content › IPTV): your M3U links (see
  [IPTV and radio](#iptv-and-radio)).
- **A USB drive:** plug it in and the Local tab appears (see
  [Your USB drive](#your-usb-drive)).

## Getting around

### The remote

| Key | What it does |
|-----|--------------|
| Arrows | Move. |
| OK | Select. |
| Hold OK | An item's own menu, where it has one: *Hold OK for more* shows in the bottom-right corner then. |
| BACK | Back. On a main page (Home's tabs, Discover, Search, Settings) it goes to the top menu first (DOWN comes back to where you were); from the menu, to the page before, or *Press Back again to exit* on Home. |
| 0–9 | The top menu's items (see below); in the player, the subtitles' [timing, position and size](#keys-while-it-plays); on a live channel, a [channel number](#iptv-and-radio). |
| UP / DOWN in the player | The quick bar / the menu ([While it plays](#while-it-plays)). |
| Red / Green / Yellow / Blue in the player | Audio tracks / subtitles / sources / stream info. |
| CH+ / CH− | The next / previous channel while one plays. |
| Guide | The Guide tab (instead of the TV's own guide). |

**Number keys outside the player** (not while typing) pick the top menu's items, left to right:
**1** Watching, then the rest in the menu's order (Settings › Appearance › *Menu*); **0**
Settings. With Watching, Movies, Series and IPTV showing, in the usual order, 5 is Discover and 6
Search.

### The top menu

The tabs, **Discover**, **Search** and **Settings ⚙**, then the StremioK name. UP from a page
reaches it.

### Lists you put in order

In Settings, a list you order (addons, playlists, YouTube catalogs, Home feeds, Search results,
source ranking) has **▲ / ▼** to move an item one place and **⇈ / ⇊** to move it to the top or
the bottom.

### Hold OK on a poster

On a movie or series poster anywhere (Home, Discover, Search, *More like this*, a person's
titles…): *Details*, *Add to / Remove from Continue Watching*, *Mark watched / unwatched* (a
whole series at once) and, with Trakt connected, *Rate on Trakt* (1 to 10, as Trakt words
them, *Weak Sauce* to *Totally Ninja!*; *Your rating: 8 · change* once rated, and *Remove
rating*).

A watched mark (from here, a title page or the player) ticks **every** card of that title on
screen (✓). A series is ticked once every episode out so far is watched, marked whole or
episode by episode; a new episode coming out takes the tick away.

### Typing, or sending from your phone

Text fields use the TV's on-screen keyboard. Where StremioK asks for a link or search words,
**▣ From your phone** shows a QR code instead: scan it with a phone on the same Wi-Fi as the
TV and type or paste into the page it opens. Search words are searched as soon as they
arrive; a link fills the field, for you to check and Confirm. It's offered in Search
(*▣ From phone*), *▶ Play a link*, *Add addon*, *Add playlist*, a playlist's *Edit link*,
*Import configuration file*, a YouTube catalog's source and AIOManager's address and key.

The page travels **unencrypted** (plain HTTP) over your home network, so use it only on a
network you trust: addon and playlist links often carry your tokens or passwords (the page and
the TV both say so). It exists only while the QR code is on screen, behind a one-time code,
and takes one entry (see [Privacy and data](PRIVACY.md#sending-text-from-your-phone)).

## Finding something to watch

### Home

- **Tabs:** **Watching**, **Calendar**, **Movies**, **Series**, **IPTV**, **Guide**, **Radio**,
  **Sports**, **YouTube** and **Local**, each shown when there's something for it (from your
  addons, playlists and their TV guides, YouTube catalogs or a USB drive). IPTV has live TV
  only: an addon's catalog of another kind (a debrid library) goes to Movies or Series by what
  it lists, or, when that's unclear, to Discover only. Picking a tab puts focus on its first title. Put the
  menu in your own order, or hide a tab you never use, in Settings › Appearance › *Menu*; order
  and hide the rows in *Home feeds*.
- A row shows a catalog's first page; [Discover](#discover) has the rest.
- A details strip above the rows describes the focused title: its logo (or name), year,
  runtime, rating, genres and synopsis.
- StremioK opens on the rows it showed last time and refreshes them in the background, and
  again every 15 minutes. Without saved rows, each row appears as soon as it's ready, in its
  place (*Loading…* holds the place of a slower one).
- **Anime catalogs** (movies and series mixed, like AIOMetadata's "anime" type) are in
  Discover and Search only: no Home tab fits them.

### Watching (Continue Watching)

Two parts: **Continue Watching**, a grid of what you can play now (newest first, scrolling
down however many it holds), and below it a row, **Upcoming**: the shows
whose next episode hasn't aired yet (watched up to S6E5 with S6E6 out on 20 Oct) or that
aren't out at all, the soonest first, each tagged with when ("Airs Mon 20 Oct", or "Not out
yet"). A show moves up to Continue Watching by itself once its episode is out. A row with
nothing in it isn't shown, its title neither.

- **Resuming** plays the exact source you were watching, at the saved position. The title's
  other sources load alongside and join the player's *Select source* once they're in.
- **One card per show**, at the furthest episode you've reached. A card shows the same
  artwork as in its Home row (or the pictures saved when it was played).
- **NEW** marks a show with an episode out since you last watched it.
- **New-episode alerts:** half a minute after launch, a note names the shows with a new
  episode out since you last watched them (*New episodes: The Bear S3E1 · Severance S2E5 ·
  and 1 more*), each episode once. TVs have no notifications, so this is it.
- **Hold OK on a card:** *Details*, *Play from start* (the same source from the beginning),
  *Move*, *Alerts off / on* (a show), *Mark watched* (the episode on the card, for a show; on
  Trakt too when connected; it then leaves the row) or *Remove* (only takes it off; nothing
  changes on Trakt). A title Trakt has as paused stays off after either, unless Trakt later
  has newer progress for it. Upcoming cards have the same menu, without *Move* (that row is
  in date order).
- **Move:** the arrows carry the card through the grid (UP / DOWN a line), OK leaves it there, BACK puts it back.
  From then on your order is kept: a title new to Watching comes first, the others stay where
  you put them. *Recent first* (there once you've moved one) goes back to the most recent
  first.
- **Add to Continue Watching** (a title page's button, or hold OK on a poster) puts a title
  there without playing it (a series at its next unwatched episode) until you finish or
  remove it. A title already there from Trakt counts as in it: the button says *In Continue
  Watching*, and removing it hides Trakt's card.

### Calendar

📅, after Watching, a row a day.

- **Coming up:** the episodes of the shows in Watching airing in the next 60 days, each card
  tagged with its episode (S2E5) and its title in the strip above; several of a show's
  episodes on one day are in their order. OK opens the show on that episode.
- **Watched** (below, behind *▸ Watched: the last 30 days*, so scrolling down the coming days doesn't run
  on into past ones; OK shows or hides it, and it stays open while StremioK runs): the last 30
  days, the latest first: what you marked watched here (played to the credits, or by hand),
  what Trakt has you watching on any device ("on Trakt"), and what you stopped part-way
  (tagged with how far, 34%). A show's episodes that day share one card (S2E3 +2: the latest
  and how many more). Nothing played privately is there.

### Discover

Discover (after the tabs) browses any catalog in full: pick a **type**, a **catalog** and,
where the catalog offers one, a **genre** or **year**; the next page loads as you scroll. It
reopens where you left it, unless your addons changed meanwhile.

- **Search** (the field after the pickers) searches the chosen catalog, or, when it can't, the
  same addon's search for that type (the genre doesn't apply then). Catalogs with no way to
  search show no field. *✕ Clear* goes back to the catalog. Changing the type or catalog drops
  the search. When the addon doesn't answer, it says so; the same text again retries.
- **Browse** (with a TMDB key, under Movies and Series): TMDB's *Trending this week*,
  *Popular*, and one catalog for each streaming service in your country (Netflix, Prime
  Video, Disney+…, the biggest first; the country is set in Settings › Content ›
  Integrations › *Where to watch*), each with a genre filter (Trending has none).
- **People** (a type of its own, with a TMDB key): TMDB's popular people, or the people called
  what you search (*Search a name*). OK on one opens their page: their movies and series, best
  known first.
- A genre that came back empty twice in a row is left out of the genre list for a day; *Show
  N left out* at the end of the list brings them back.
- When an addon sends an empty list for a catalog that had titles earlier, those titles come
  back marked *from earlier: the addon sent nothing just now*; with nothing to fall back on,
  **↻ Try again** asks again.

### Search

Search (top menu) asks every addon catalog that can search.

- **One row per catalog**, named like its Home feed ("Series · Popular · Cinemeta"), each in
  its addon's order (best match first); IPTV groups share one row per type. Order and hide
  the rows in Settings › Appearance › *Search results*.
- Rows appear as their catalogs answer, and can be browsed meanwhile; a line above them says
  how many have answered ("Searching “fast”… 2 of 5 sources answered"), then names any that
  didn't. A row loads more as you move right.
- A search waits up to 25 seconds for an addon (Cinemeta's often takes 8 or more); *Wait for
  addons* (Settings › Content › Addons) waits longer.
- With a TMDB key, a **People** row: first when the best match is called what you typed
  ("michael j fox" = Michael J. Fox; a single word only when it's someone's whole name), last
  otherwise.
- Your last 5 searches are listed on the right (hold OK on one to remove it).
- **▶ Play a link** (next to the field) plays a video's direct link (`https://…/film.mkv`, an
  HLS `….m3u8`, a YouTube video's page), typed or sent from your phone. It plays as it is,
  and nothing about it is recorded (no progress, no Continue Watching).

## Title pages

A movie opens on its sources. A series opens on its seasons and episodes. Each page has the
title's **logo** when it has one, a **ratings line** (IMDb, Rotten Tomatoes, audience score,
Metacritic, Letterboxd) with an MDBList key, and its synopsis. BACK returns through the title
and person pages you came by.

### Seasons and episodes

- Episodes have thumbnails and ratings, a progress stripe when part-watched and a ✓ when
  watched. Episodes not out yet are dimmed, with when they air (*Airs tomorrow*, *Airs Thu 2
  Oct*).
- **Resume / Play** plays the episode you're on. When that episode isn't out yet (a show that
  hasn't started, or you've watched all that's out), there's no button, just when it airs
  (*S1E1 airs Thu 8 Oct*). **Hold OK on *Resume*** for *Resume at 12:34* or *Play S1E2 from the
  start*: its saved source from 0:00, or, with no source saved (a place Trakt brought from
  another device), the episode's page, where *▶ Play best from the start* and every source
  then play from the beginning.
- **Hold OK on a season** to mark that season, seasons 1 to N, or the whole series watched or
  unwatched, or (with Trakt connected) to *Rate Season N on Trakt*.
- **Hold OK on an episode** for its *Details*, to mark it, to mark everything up to it, or
  *Mark unwatched from SxEx on* (it and every episode after it; offered when one of them is
  watched).
- **An episode's page** (OK on an episode, or *Details*): the show's name or logo, the
  episode's code and title, when it aired, its rating and synopsis; **▶ Play best**,
  **▶ Trailer**, **ⓘ Cast & more** and its sources below. BACK returns to the episode list, on
  that episode. Its **▶ Trailer** (with a TMDB key) is the episode's own trailer or teaser,
  else its season's (*▶ Season 2 trailer*); no button when TMDB has neither. Stopping it comes
  back to the episode's page.
- **★ Episode ratings:** a color-coded grid of every episode, seasons across and episodes down,
  from IMDb (through OMDb), else TMDB. Selecting a rating opens that episode.
- **Hide spoilers** (Settings › Appearance) blurs the stills of episodes you haven't watched,
  and can hide their synopses too.

### Trailers

**▶ Trailer** plays the title's YouTube trailer. The title's details addon gives its trailers;
with a TMDB key, TMDB's join them (in your audio and subtitle languages, and in English). With
more than one, the button says how many (*▶ Trailer (4)*) and plays the best: one in your
language first, then official trailers, then teasers, with ads, TV spots and clips last.
**Hold OK on the button** for the list, to pick one yourself: each with its language, when it
came out and whether it's official (*La isla olvidada - Tráiler español · Spanish · Mar 2026 ·
unofficial*). Subtitles turn on as for anything else, from the trailer's own captions; one you
pick by hand on a trailer isn't remembered.

### Cast & more

**ⓘ Cast & more** (with a TMDB key) shows the people (cast and crew, directors or creators
first), the collection a film belongs to (in release order) and "More like this". On an
episode's page: its director and writers, its cast and guest stars, then the show's creators.
Without a TMDB key, the people the title's addon names are shown by name (no photos), and OK
on one searches for them.

Selecting a person opens their page: their films and series, best known first, up to 60 each,
without appearances as themselves (talk shows, documentaries, archive footage). **Hold OK on a
title** there, in *More like this* or in a collection for the usual poster menu.

### Collections

A "movie" an addon describes as a list of films (AIOMetadata's TVDB collections: *Marvel
Cinematic Universe*) lists its films in the collection's order, with their years and watched
marks. OK on one (or *▶ Open*, the first you haven't watched) opens that film's page. Hold OK
on a film for *Mark watched* / *unwatched*, *Mark watched up to* it, or its page.

## Choosing a source

A title page lists the sources of every stream addon you have, each with its size and the
addon's description (languages, seeders…). They appear as each addon answers ("N more addons
still loading…"), and a slow addon doesn't hold up the others. The same file from several
addons is shown once ("also on …").

### How they're ordered

1. **Played before:** the sources that played for this title, newest first (for a series,
   sources like the ones used for its recent episodes).
2. Then, by default, by resolution: **4K**, **1440p**, **1080p**, **720p**, **SD**, **Other**;
   within each, cached sources first, better release types, HDR, your addon order. All of
   this is yours to change in Settings › Playback ›
   [Source ranking](SETTINGS.md#source-ranking).
3. At the bottom, in their own groups: sources you marked **not suitable**, ones with your
   **words to hide**, ones **outside your size limits**, ones with a format marked **Not
   working** or a resolution you don't allow (see [Formats](SETTINGS.md#formats)), then links
   that don't play here (torrents). ▶ Play best and the next episode never pick these.

### Playing one

- **▶ Play best** (focused when the page opens) plays the top source. When you've a place to
  resume, **hold OK on it** for *Play best, resuming at 12:34* or *Play best from the start*.
- **Filter:** next to ▶ Play best, **Addon: All ▾** and **Resolution: All ▾** (where there's a
  choice). Pick one to show only those sources ("Showing 9 of 40 sources"); ▶ Play best then
  plays the best of them. The filter stays while you're on the title and its episodes.
- **Hold OK on a source** to mark it *not suitable* for this title (wrong language, poor
  quality, a fake…): it moves to the bottom and is never picked by ▶ Play best or for the next
  episode; hold OK again to put it back. The mark follows the file, from any addon. The same
  menu has *Play from the start* when you've a place to resume, and *⬇ Download to USB drive*
  with a drive plugged in (see [Downloads](#downloads)).
- **When a source doesn't start**, the next one is tried ("Didn't start: trying the next
  source (2 of 4)…") at the same place, up to 3 more; when none starts, you're back on the
  list. When a debrid service sends a notice instead of the video, StremioK says what it means
  (see [Troubleshooting](TROUBLESHOOTING.md#a-source-doesnt-start)).
- **Skip the source list** (Settings › Playback › Source ranking) plays the top source as soon
  as the addons have answered. The list is still a press away: hold OK on an episode ›
  *Details*, or *Select source* while it plays.
- The list is ranked again when you come back to it: a source that just played moves to
  *Played before*, one that just failed drops, and changed settings apply.

### When addons are slow

- A title's sources are kept for 10 minutes. **↻ Re-scan** asks the addons again (also on a "No
  sources found" page, where it's focused).
- **🕘 From earlier:** when an addon doesn't answer in time, the sources you played from it
  (the last 3 for each movie or episode) are listed anyway, marked with when you played them.
  A link it gave a while ago may no longer play.
- The "No sources found" page says, addon by addon, why there's nothing: *no sources for this*,
  *refused* (with the server's answer: *HTTP 429 · rate_limited*), *didn't answer in time*,
  *couldn't be reached*, or what the addon said instead (AIOStreams' filters: "AIOStreams ·
  📅 Digital Release Filter: 'Other Mommy' releases in 2 days"). A live channel with nothing to
  play says the same in its note ("No playable source for this channel: PenguPlay refused…").

## While it plays

### The quick bar (UP)

Play/Pause · Restart · Previous · Next · Cast & more · Phone · Download · Private · Back, each
where it applies. It goes round (past the last is the first) and closes after 5 seconds
without a key.

- **▣ Phone** (continue on phone): a QR code of what's playing, to open on a phone in **VLC**
  (the default) or **Infuse** (they play MKV, HEVC and surround sound a phone's browser would
  only download), or as the **Direct link**; your pick is remembered. A YouTube video's is its
  page, at the minute you're at. It's shown only when you ask, since anyone who scans it can
  play what you're watching (see [Privacy](PRIVACY.md#links-that-carry-your-tokens)). Not for files on a USB drive; a
  channel that needs its own user agent or referrer may not open elsewhere.
- **⬇ Download** (the sideloaded app, a USB drive plugged in, a source that's a link): saves
  what's playing to the drive, with the subtitle that's on (see [Downloads](#downloads)). The
  video keeps playing.
- **◐ Private: Off / On** (not for trailers or live channels): private viewing for what's
  playing, from that moment (see [Private viewing](PRIVACY.md#private-viewing)).
- **Cast & more** (with a TMDB key): who's in it, with photos and roles, on a see-through strip
  over the video, which keeps playing. LEFT / RIGHT look through it; OK on a person shows
  their movies and series, OK on one of those its Cast & more, and so on. BACK goes up a level
  at a time; UP or DOWN close it. **Hold OK on a title** there for the poster menu: *Add to /
  Remove from Continue Watching* and *Mark watched / unwatched* happen right away; *Details*
  stops playing (your place kept) and opens its page.

### The menu (DOWN)

- *Subtitles* and *Audio track*.
- *Select source*: another source, at the same point, with its own quality list, subtitles and
  file details; the title and Private viewing stay.
- *Video quality* (HLS streams: YouTube, and links to an `.m3u8`); it says so when a stream's
  qualities can't be read.
- *Playback* (restart, rewind / forward).
- *Picture*: Fit, Zoom or Stretch, remembered (a live channel keeps its own).
- *Format* (an Xtream channel): MPEG-TS or HLS, kept for that channel.
- *Stream info*.
- *Reload*: opened again (a live channel at the live edge, a video where it is).
- *Sleep timer*: Off, 30, 60 or 90 minutes, then playback stops (the menu shows what's left).

The time of day shows at the top right of the screen, while the progress bar is on screen.

### Keys while it plays

| Key | What it does |
|-----|--------------|
| LEFT / RIGHT | Move a marker along the progress bar, faster the longer you hold; playback jumps once you stop. The step is set in Settings › Playback › Seeking & buffering. |
| Play / Pause / Stop / FF / REW | As labeled, even with the menu open. |
| ⏮ / ⏭ | The previous / next episode (a live channel: the previous / next one). |
| Red | The audio tracks (a YouTube video's: its audio languages). |
| Green | The subtitle languages. |
| Yellow | The sources (*Select source*). |
| Blue | The stream info (see below). |
| 1 / 2 / 3 | Subtitles 0.1 s earlier / back to the file's timing / 0.1 s later (kept for the title). |
| 4 / 5 / 6 | Subtitle position: Lower / Bottom / Raised. |
| 7 / 8 / 9 | Subtitle size: Medium / Large / Extra Large. |

On a live channel the number keys pick a channel instead (see [IPTV and radio](#iptv-and-radio)).
A colored key's list closes with BACK or the same key again.

**The stream info** (blue) shows the source (its addon, name, file name and size, the addon's
description), what it is in short (4K · HEVC · HDR10 · Atmos · MKV), the video and audio as the
player has them, the subtitles, quality, bandwidth, server (its name only), how it plays
(straight from the server, through StremioK's service, or YouTube's service), the buffer and
the position.

While the progress bar shows, the right side sums up what's playing: resolution, video format,
bit depth, HDR / Dolby Vision, audio, channels and file type (`4K · HEVC · 10-bit · HDR10 ·
Atmos · 5.1 · MKV`).

### Skipping intros, recaps and credits

- **Skip Intro**, **Skip Recap** and **Skip Preview** appear when StremioK knows where they are
  (from [TheIntroDB](https://theintrodb.org), [SkipDB](https://skipdb.tv) and
  [IntroDB](https://introdb.app); for anime, also [AniSkip](https://aniskip.com)). OK skips.
  With *Skipping* set to a countdown (Settings › Playback › Skipping), it skips on its own
  (*Skip Intro · 5*), with **Cancel** to keep watching; the countdown waits while you're paused.
- **Skip Credits → Next** appears at the credits; without known credits, in the last 10
  seconds. With *Next episode* set to a countdown, *Next episode · 10* plays it at zero, with
  **Watch Credits** to stay.
- The known sections are colored on the progress bar: intro cyan, recap and preview blue,
  credits light blue.

### Next episode

- Previous / Next and the episode queued at the credits skip episodes that haven't aired yet.
- The next episode plays a source like the one you were watching (the same addon, resolution
  and release group). Its sources are fetched shortly before the credits, so it starts at once.
- Reaching the credits marks the episode or movie watched (once 80% of it has played) and
  queues the next episode in Continue Watching.

### Also good to know

- Progress is saved as you watch, and the TV's screensaver stays off.
- **In the background** (the TV's Home button, another app): a movie or episode pauses and its
  place is saved (sent to Trakt too); coming back, it waits paused (OK plays on). A live
  channel plays on.
- A stalled stream reloads at the same position; a live channel that drops reconnects (see
  *Reconnect live channels* in [Settings](SETTINGS.md#seeking--buffering)).
  See [Troubleshooting](TROUBLESHOOTING.md#playback) when it keeps happening.

## Subtitles and audio

### Where subtitles come from

- **Your subtitle addons** (SRT / VTT), told which file is playing, so OpenSubtitles can put
  the ones timed for that exact release first.
- **The source's own:** some stream addons send subtitle files with each source; they're listed
  first, "with this source".
- **Tracks built into the file** (MKV and the like), and a live channel's
  [closed captions](#iptv-and-radio).
- **A YouTube video's captions:** the uploader's ("YouTube"), then YouTube's automatic ones.
- **Your USB drive:** subtitle files on a plugged-in drive for this movie or episode, for any
  source (*Your USB drive · Film.es.srt*), after the addons': those next to a matched video, and
  ones matched when the drive was indexed (see [Your USB drive](#your-usb-drive)). One made for
  another release may need [Timing](#timing).

### Choosing

- Tracks are grouped by language ("en", "eng" and "English" are one), with regional tags such
  as `es-419` kept.
- Your **default language** (Settings › Playback › Subtitles) turns one on by itself, from
  wherever it is. When nothing is in it, your **second choice** is looked for the same way.
- **Green** (or *Subtitles* in the DOWN menu) picks a language, then a track. Your choice for a
  title, its timing included, is remembered (the last 50 titles).
- **A second subtitle** (Settings › Playback › Subtitles; *Off* by default): a second language at
  the top of the screen (English below, Spanish above, say), with the same style and timing. Green › *Second subtitle* changes it while something plays.
- **Skip lines with** (Settings › Playback › Subtitles): lines with one of your words aren't
  shown, from any track: `OPENSUBTITLES` (the site's ads), `.SRT` (a line that's just a file
  name).

### Timing

- Shift subtitles earlier or later by 0.1 s, 0.5 s, 1 s or 5 s (*Timing* in the subtitle menu,
  or keys 1–3); each press says where it is ("Subtitles: +5.5 s (later)").
- **Sync by ear**, for a subtitle file: *Press when you hear it* shows the next line coming up;
  press OK the moment it's said. *Pick the line being said* lists the lines around now; choose
  the one you're hearing. Either way it's remembered, and the steps fine-tune it.
- Tracks built into the file can only be made later, not earlier.

### Look

Size, color, background, edge, position and font are in Settings › Playback › Subtitles (keys
4–9 change position and size while playing). While the progress bar is on screen, the line
moves up above it.

### Audio

- A **preferred** and a **second-choice language** (Settings › Playback › Audio) pick the track.
  A track already playing in your language is kept.
- **Switching to it:** *Quick* (the default) picks the track before the video starts; *Safe*
  waits a few seconds and reloads, for files where Quick names your language but you hear
  another (see [Troubleshooting](TROUBLESHOOTING.md#audio-and-subtitles)).
- **Red** (or *Audio track* in the DOWN menu) lists the tracks by language, with channels and
  codec. Choosing the ticked track again re-applies it if the TV didn't follow a switch.
- Your choice is remembered per title; a series' next episode takes the one made last in that
  series.

## IPTV and radio

### Your playlists

Settings › Content › **IPTV** › *Add playlist*, or a configuration file. A playlist is named
after its file (`…/sports.m3u8`: *sports*) or its own name. **An Xtream account** (*Add Xtream
account*): its server, username and password, a page each; once the server accepts them, its
channels are a playlist (*Xtream · server*), with its TV guide. Each shows its channel and group
counts, when it was last downloaded, and what went wrong (a failed refresh keeps the saved copy).

- **▲ / ▼** set the order: a channel in two playlists comes from the first, and rows follow
  the order.
- OK on one: *Rename*, *Turn off* / *Turn on* (off: its channels hidden, its copy kept), *Edit
  link*, *Guide link*, *Reload*, *Remove*.

### Watching

- **★ Favorites:** hold OK on a channel card, then *Add to favorites*. Your favorites are a
  row of their own, first on the IPTV tab, and come first on the Guide tab.
- **IPTV** and **Radio** rows, a row per group; a channel's details name its playlist.
- **Sports:** channels marked `tvg-type="sport"` (or `"sports"`) go to the **Sports** tab instead.
  StremioK's own mark: other players ignore it.
- **Guide only:** channels marked `tvg-type="guide"` (no link needed) show on the Guide tab
  alone; OK on a program finds that film in your addons (else Search).
- **CH+ / CH−** switch through the row a channel came from; the channel you stop on starts after
  a short pause, and BACK lands on its card.
- **A channel's number:** type its position in that row (7, or 1 then 2 for 12); it says
  "Channel 1_" while it waits for a second digit.
- Live streams show **● LIVE**, with no seeking or resume.
- **YouTube live** channels (`youtube.com`, `youtu.be` links) play too, and so does an Xtream
  channel whose link leads to YouTube.
- **Choppy sound** on some channels is fixed on its own: the channel restarts ("Fixing this
  channel's sound…"), remembered for two weeks.
- **Closed captions** in a channel's picture (CC1–CC4, as VLC shows them): Green lists *Closed
  captions (CC1)*; picking one restarts the channel with them (next time too). Ones in your
  default subtitle language turn on by themselves. HLS only: on Xtream, switch *Format* to HLS.

### TV guide

- **Where it comes from:** the guide link a playlist names (`url-tvg`), or an Xtream
  playlist's (`get.php`) own guide. *Guide link* (OK on a playlist) sets another, or puts back
  the automatic one. The sideloaded app or TizenBrew reads it, again every 6 hours, or at once
  with the playlist's *Reload*.
- A channel is matched by its `tvg-id`, else by its name. One without a logo in its playlist
  gets the guide's.
- **Channel cards** show what's on now and how far along it is; Home's details strip adds its
  description and what's next.
- **While a channel plays,** the bar at the bottom shows Now and Next, with their times.
- **Hold OK on a channel card** for its schedule, from 2 hours ago to tomorrow: *▶ Watch now*
  plays it, *★ Add to / Remove from favorites*, and OK on a program shows its description.
- A guide's **program pictures** show in the details strip (a channel's card, the Guide tab).
- **The Guide tab** (once a guide is read): your channels with a guide, a row each, across 2½
  hours from the current half hour, with a line at the time now. ← / → go from program to
  program (the hours move along past the edge), ↑ / ↓ to the channel above or below at the same
  time. The details strip describes the focused program; OK on what's on now plays the channel
  (CH+ / CH− then go through the Guide's channels), on a later one shows its description.

## YouTube

StremioK has its own YouTube, through its bundled service: nothing to install, no account.

### Your YouTube catalogs

Settings › Content › **YouTube** (see the [settings reference](SETTINGS.md#youtube)):

- **+ Add catalog:** a channel (`@handle`, channel link or `UC…` ID), a playlist (link or `PL…`
  ID), or words to search for. Your catalogs (up to 40) are rows on Home's **YouTube** tab, and
  Discover catalogs like an addon's. OK on one to rename it, change its source, search type, sort order or type,
  turn it off or remove it; ▲▼ reorder.
- **YouTube in Search** (On by default) adds **YouTube · Videos**, **YouTube · Channels** and
  **YouTube · Live now** rows to Search.
- **Hold OK on a YouTube channel or playlist card** (in Search, or an addon's) to add it.
- **+ Copy from YouTubio** (with a YouTubio addon installed): its catalogs become yours, then
  it offers to remove the YouTubio addon. Its own feeds that need its sign-in (subscriptions,
  watch later) aren't copied.

### Channels and videos

- A **channel or playlist** opens as a series: its videos are the episodes, by year when every
  video has a date (newest first), else one list, *Videos*. OK on one plays it; next episode,
  progress and Continue Watching work as for any series.
- A channel streaming now has those streams first on its page, and live videos are marked
  **● LIVE**.
- **DeArrow** (On by default) shows titles and thumbnails other viewers rewrote to say what a
  video is; YouTube's title stays in the description. **Video titles: Original** shows titles in
  the language they were uploaded in; *English* as YouTube translates them.
- **YouTube videos from addons** (YouTubio's *Stremio Player* sources) play the same way, as
  the title they are: progress, Continue Watching, Played before and the next episode work as
  for any source.

### While a YouTube video plays

- **SponsorBlock** (On by default): sections other viewers marked
  ([sponsor.ajay.app](https://sponsor.ajay.app)) are colored on the progress bar (green sponsor,
  yellow self-promotion, purple reminders…). One set to *Skip* is skipped ("Skipped: Sponsor
  (01:00)"); *Ask* shows a *Skip … ▸* button. Each is skipped once a playback; scrubbing into
  one doesn't skip it. The highlight is *◆ Highlight* on the UP bar. Not for trailers.
- **Chapters:** gaps in the progress bar where each starts, the current one above the bar
  ("3/12 · Title"). Scrubbing lands on a chapter start nearby. *≡ Chapters* (UP bar, or the DOWN
  menu) lists them; OK goes to one.
- **Audio language** (DOWN menu, or red): a video YouTube has dubbed lists its languages (the
  original first; the others "AI-dubbed by YouTube"). Picking one reopens the video in it, where
  you were, and it's remembered for that video. It starts in the original.
- **End screen:** when the creator's end screen starts, a strip shows the videos it links to
  ("Up next on YouTube"); UP chooses, BACK hides it. **Cards** linking to a video show as a note
  for 8 seconds; UP plays it. A video opened from either plays in place of this one (your place
  saved), and stopping it comes back.
- **Video quality** (DOWN menu): it starts at 1080p where there is one; *Auto* restores the full
  range.

## Your USB drive

Home's **Local** tab shows the USB drives plugged into the TV.

### Browsing

- A grid of the folder's folders, then its videos. OK opens a folder; BACK, or the **⬆ Back**
  card first in every folder, goes up one. At the drive's top, BACK goes to the top menu.
  Coming back to the tab, you're where you left off.
- Hidden files (a Mac's `._…` copies, `.DS_Store`, `$RECYCLE.BIN`, `System Volume Information`)
  are left out; *Show hidden files* in Settings › Content › USB drive lists them.

### Matched to titles

- Each video is matched to a movie or an episode by its name, and its folders' when the name
  says too little (`Dune.Part.Two.2024.2160p.mkv`, `The.Bear.S01E02.mkv`, `Severance
  (2022)/Season 3/S03E05.mkv`). Only a close match is taken: better unmatched than wrong. A
  matched video shows its title's poster.
- **Only once you've said yes:** the first folder with videos to match asks first (*Match* /
  *Don't match*), since your search addons see the titles worked out from the names. *Don't
  match* means Local just browses; *Match videos to titles* in Settings › Content › USB drive
  changes it.
- **A matched video plays as that title:** OK opens its title page and plays the file, so
  progress, watched marks, Continue Watching, *Next episode* and Trakt are that title's. On the
  title page the file is a source of its own, **On your USB drive**, above the addons' (and
  ▶ Play best picks it).
- **Any other video plays as a plain file:** where you stopped is remembered and it goes in
  Continue Watching, but there are no addon subtitles and nothing goes to Trakt.
- **Hold OK on a video:** *Play*, *Title page*, *Mark watched / not watched*, *Match to a title…*
  (movie or series, the name to search, then one of the results; a show's episodes all follow),
  *Not a movie or episode*, *Back to the automatic match*.

### Indexing a drive

*Index this drive* (the first card at a drive's top, or *Index again* in Settings › Content ›
USB drive) lists the drive's videos and subtitle files and matches them, so title pages offer
them. It's kept for the next launch. While it runs, the card shows how far it is ("Matching 120
/ 300"); OK on it offers to stop. Matching runs 300 titles at a time; the card then offers
*Continue matching (N left)*. Settings › Content › USB drive shows each drive's counts, *Clear
the USB index* and *Forget matches*. The sideloaded app only.

### Subtitle files

- Subtitle files next to a video are first in its subtitle menu: named like it (`Film.srt`,
  `Film.en.srt`, `Film.forced.eng.srt`, the language from the name), or any in the folder when
  it's the only video there. SRT, WebVTT, ASS / SSA.
- **Subtitle files of their own** (no video next to them: a season's `.srt` files) are matched
  to a movie or an episode by their names when the drive is indexed. Their language is the one
  their name says when StremioK knows it (`.en.srt`, `.spanish.srt`); otherwise *Unknown
  language*. In the Local tab they're listed with the videos; hold OK on one to *Match to a
  title…*, mark it *Not a movie or episode*, go *Back to the automatic match*, or open its
  *Title page*.
- Either kind is offered for any source of that title (see [Subtitles and audio](#where-subtitles-come-from)).

### Downloads

The sideloaded app can save a source to a USB drive: hold OK on a source › *⬇ Download to USB
drive*, or UP › *⬇ Download* while it plays.

- With more than one drive (or partition), pick which; each says its free space. StremioK says
  what it will save and where (the file's name and size, the drive's free space) before it
  starts.
- It goes into a `StremioK` folder on the drive, named after the release, with a subtitle file
  next to it: one in your language from a subtitle addon, or, from the player, the subtitle
  that's on (a built-in one comes with the video).
- Only a file can be downloaded. A streamed playlist (HLS or DASH, as many live and some
  on-demand sources are) can't: it isn't offered, or the download stops and says so.
- One downloads at a time (the others wait). It goes on while you browse or watch something
  else; closing StremioK may stop it, and it picks up where it stopped when you start again.
- The **Downloads** list is at the top of the Local tab while it has anything: each with its
  progress, speed and time left, or done, or what went wrong. OK on one: *Cancel* (its partial
  file deleted), *Retry*, or *Remove from the list*.
- Done, it's at once a source on its title page ("💾 USB drive"), matched to the title it was
  downloaded for, with its subtitle file.

## Trakt

Connect in Settings › Content › Integrations › *Trakt account*: scan the QR code with your phone
(Trakt's activate page with the code in it), sign in if asked and confirm. A free account will
do; there's nothing else to set up.

### What it shares

- **From Trakt:** titles you watched are marked watched; what you left part-way is in Continue
  Watching, and the shows you're watching are there on their next episode ("Next episode · from
  Trakt"). An episode you left part-way and have since watched past, here or on another device,
  gives way to the next one.
- **To Trakt:** what you play here (where you stopped, once past the first minute; watched when
  the credits start), and what you mark watched or not watched by hand. Ratings you give (hold
  OK on a poster or a season › *Rate on Trakt*).
- **Stopped past 85%** (before the credits) counts as watched, here and on Trakt. Between 80% and
  85% it stays in progress. Leaving StremioK with the TV's Home button past 80% sends nothing:
  you may come back to it.
- YouTube videos are never sent: they aren't Trakt's.
- **Rows on Home**, read from your Trakt account (also in Discover; ordered and hidden in Settings › Appearance › *Home feeds*):
  **Series · Up next** (the next episode of the 15 shows you watched most recently) and
  **Movies / Series · Watchlist**. They refresh when StremioK starts, a few seconds after you
  watch or mark something, and every 15 minutes.

### Keeping in step

- Changes are sent at once and retried automatically. Ones that still fail stay in *Trakt
  sync*, to send again or let go. *Trakt sync* (Settings ›
  Content › Integrations) shows when it last synced, the changes waiting, and any Trakt
  refused; *Sync now* sends everything, *Let them go* drops the refused ones.
- **Trakt needs reconnecting** shows when Trakt no longer accepts the sign-in; changes wait
  until you connect again.
- **Disconnecting** clears everything kept from Trakt (history, Continue Watching, rows, ratings)
  and the changes waiting. Connecting again starts afresh.

## Other apps (where to watch)

- Some addons, and TMDB with a key, list **where to watch** a title: subscription and free
  services for your country (a series' are the show's). They sink to the bottom of the sources,
  under *Where to watch · other apps*.
- On the TV, one whose service you have an app for opens that app (*▶ OK opens …*, listed
  first). Apps are matched by name across spellings ("Amazon Prime Video" = "Prime Video",
  "HBO Max" = "Max").
- An app that isn't one of your streaming apps asks once before it first opens, naming the app
  and its ID.
- Where an addon gives the app's own link for the title, the app opens on that movie or episode
  if it supports it (Apple TV does); others open on their home screen (Prime Video, so far).
- A service with several apps on the TV (three Netflix entries, say) only opens once you've
  listed the one to use in Settings › Content › **Streaming apps**.
- The country is the TV's language region (en-US: US), or the one picked in Settings › Content ›
  Integrations › *Where to watch: country*.
