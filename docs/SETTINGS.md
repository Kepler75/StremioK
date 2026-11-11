# StremioK settings reference

Every setting, where it is, its choices and what it does. Defaults are in **bold**. For how to
use the features, see the [user guide](USER-GUIDE.md).

Settings (**Settings ⚙**, at the end of the top menu, or **0** on the remote) has five groups:
[Content](#content), [Playback](#playback), [Appearance](#appearance), [Home](#home) and
[Diagnostics](#diagnostics). Each opens a page of its sections. BACK goes up a level, onto the
row you came from. Where a setting asks for a link or text, **▣ From your phone** sends it
from your phone (see the [user guide](USER-GUIDE.md#typing-or-sending-from-your-phone)).
In a list you order, ▲ / ▼ move an item one place and ⇈ / ⇊ move it to the top or bottom.

- [Content](#content): [Addons](#addons), [AIOManager](#aiomanager),
  [Streaming server](#streaming-server), [Integrations](#integrations), [IPTV](#iptv), [YouTube](#youtube),
  [Streaming apps](#streaming-apps), [USB drive](#usb-drive), [Media servers](#media-servers),
  [Import configuration file](#import-configuration-file), [Export configuration](#export-configuration)
- [Playback](#playback): [Audio](#audio), [Subtitles](#subtitles), [Skipping](#skipping),
  [Seeking & buffering](#seeking--buffering), [Source ranking](#source-ranking),
  [Formats](#formats), [Private viewing](#private-viewing)
- [Appearance](#appearance)
- [Home](#home)
- [Diagnostics](#diagnostics): [Logs](#logs), [Storage](#storage),
  [Installed apps](#installed-apps)

## Content

### Addons

Adding, ordering and managing addons: the user guide's
[Getting started](USER-GUIDE.md#add-your-addons). Each shows its logo, or else its initial.

| Setting | Choices | What it does |
|---------|---------|--------------|
| *+ Add addon* | a manifest link | Adds an addon (`https://…/manifest.json`, or a `stremio://` install link). Only v3 addons work. |
| *Import addons from your Stremio account* | | Lists your Stremio account's addons to tick and import. |
| *AIOManager* | | Its own page: see [AIOManager](#aiomanager). |
| Each addon | *Refresh*, *Turn off* / *Turn on*, *Remove*, *Share*, *Configure*, ⇈ ▲ ▼ ⇊ | Reloads, switches off (kept, not asked) or on, removes, shows a QR code of its link (with your tokens: your devices only) or setup page, or moves it. Higher addons describe titles first. |
| *Wait for addons* | **Normal** (12 s; sources 15, search 25), 20, 30, 45, 60 seconds | How long StremioK waits for an addon. Longer helps one that sleeps when unused. |
| *Local-network links from internet addons* | **Blocked**, Allowed | Blocked, internet addons can't point links into your home network; your own network's addons and your playlists still can. See [Privacy](PRIVACY.md#your-home-network). |

### AIOManager

Settings › Content › Addons › *AIOManager* (the sideloaded app or TizenBrew).

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Address* | ElfHosted, Midnight's, Yeb's, Kuu's, *Another address…* | Your AIOManager instance. |
| *API key* | your account's | Shown as `••••1234`. A key AIOManager refuses is forgotten and asked for again. |
| *↻ Sync with AIOManager* | | Lists what it would refresh, add or remove, none ticked; *Apply N* does the ticked ones. |
| *Forget AIOManager* | | Clears the address, the key and the record of what came from it. Your addons stay. |

### Streaming server

A Stremio streaming server or a TorrServer on your network (a computer or a NAS) plays the
sources that are only torrents; Stremio's can also convert a video the TV can't play.

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Server* | **Off**, Stremio server, TorrServer | The one you run. Stremio's comes with the Stremio app for computers (port 11470) or on its own; TorrServer's usual port is 8090. |
| *Address* | its link, e.g. `http://192.168.0.10:11470` | *Test* says whether it answers. |
| *Wait for a torrent to start* | 45 seconds, 1, **2**, 3, 5 minutes | How long a torrent source gets to start (finding people sharing it) before the next. |
| *Convert videos the TV can't play* | **Off**, On | Stremio's server only: a source that doesn't start is tried once more, converted, before the next. The 2017 TV can't play what it converts. |

### Integrations

| Setting | Choices | What it does |
|---------|---------|--------------|
| *TMDB* | an API key | Episode stills and ratings, *Cast & more*, collections, "More like this", where to watch, episode trailers, Browse and People in Discover, the People row in Search. |
| *OMDb* | an API key | IMDb episode ratings (the ★ Episode ratings grid). |
| *MDBList* | an API key | The ratings line on title pages (IMDb, Rotten Tomatoes, audience score, Metacritic, Letterboxd). |
| *Where to watch: country* | **automatic** (the TV's language region; US when it has none), or a country | The country for TMDB's where-to-watch services and Discover's Browse catalogs. |
| *Trakt account* | connect / disconnect | See [Trakt](USER-GUIDE.md#trakt). |
| *Trakt sync* | *Sync now*, *Let them go* | When it last synced, changes waiting, and any Trakt refused with what it said. |
| *Stremio account* | connect; *Sync now*, *Disconnect* | See [Your Stremio account](USER-GUIDE.md#your-stremio-account). |

### IPTV

Your M3U playlists: *Add playlist*, *Add Xtream account* (server, username, password: checked,
then its channels and guide added; OK on it for *Format*: **MPEG-TS** or HLS), *Add Stalker portal*
(its address and MAC address: checked, then its channels added), ▲ / ▼ to order
them, and OK on one for *Rename*, *Turn off* /
*Turn on*, *Edit link*, *Guide link* (empty: the playlist's own TV guide), *Reload*, *Remove*.
Each says whether its guide was read. See [IPTV and radio](USER-GUIDE.md#iptv-and-radio).

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Auto-refresh* | **Off**, Every hour, Every 3 hours, Every 6 hours, Every 12 hours | All playlists and their TV guides downloaded again, as *Reload* does. |
| *Stalker channels* | **First 100 pages**, Whole portal | How much of a portal's channel list is read (100 pages: about 1,400). *Whole portal* (up to 30,000): minutes each *Reload*; a portal may block such a MAC. *Channel groups*: only those. |
| *Stalker films and series* | **Kept 10 minutes**, Kept 5 minutes, Off | How long a portal's row, category or search is kept, so showing it again doesn't ask it. Off: asked each time. |

### YouTube

| Setting | Choices | What it does |
|---------|---------|--------------|
| *YouTube in Search* | **On**, Off | Adds YouTube · Videos, Channels and Live now rows to Search. |
| *+ Add catalog* | a channel, playlist or search | Up to 40 catalogs, shown as Home feeds and Discover catalogs. A source containing `{term}` becomes a search-only catalog. |
| Each catalog | *Rename*, *Source*, *Search type* (**Auto**, Videos, Channels, Live now), *Sort order* (**Relevance**, Upload date, Views, Rating; for searches), *Type* (**YouTube**, or your own, like "Podcasts"), *Turn off*, *Remove*, ▲ / ▼ | Live now with a channel: what it's streaming. |
| *+ Copy from YouTubio* | | With a YouTubio addon installed: its catalogs become yours. |
| *Video titles* | **Original**, English | Titles in the language they were uploaded in, or as YouTube translates them. |
| *SponsorBlock* | **On**, Off | Sections other viewers marked, on every YouTube video except trailers. |
| *SponsorBlock sections* | Skip, Ask, Show on the bar, Off, for each kind | By default sponsors are **skipped**, self-promotion and interaction reminders **asked**, intros, endcards, previews, filler and non-music **shown**. |
| *DeArrow titles* / *DeArrow thumbnails* | **On**, Off | Titles and thumbnails other viewers rewrote, on StremioK's own YouTube cards and pages. |

### Streaming apps

The apps a title's "where to watch" sources open. Most are found by name; list the one to use
where the TV has several for a service. Your apps first (OK removes one), then this TV's apps
to add (OK adds one; hidden system apps on request). On the TV only.

### USB drive

| Setting | Choices | What it does |
|---------|---------|--------------|
| Each drive | *Index again* | Its index: videos, how many are matched, when. |
| *Match videos to titles* | **Off (not asked yet)**, On, Off | Whether file names are looked up with your search addons; asked the first time a folder has videos to match. |
| *Show hidden files* | **Off**, On | Lists files starting with "." and the system folders. |
| *Clear the USB index* | | Title pages stop offering the drive's files; Local still browses it. |
| *Forget matches* | | Every video is matched again from its name, yours too. |

### Network folders

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Add a network folder* | | A WebDAV folder's address, then its user name and password, if any (see the [user guide](USER-GUIDE.md#a-network-folder-webdav)). |
| Each folder | *Turn off* / *on*, *Index again*, *Remove* | Off: its sources set aside, its index kept. |

### Media servers

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Add a Jellyfin or Emby server* | | Its address, then a user name and password, or Jellyfin's Quick Connect (see the [user guide](USER-GUIDE.md#your-media-server)). |
| *Add a Plex server* | | A code to enter at plex.tv/link, then which of your account's servers. |
| Each server | *Turn off* / *on*, *Reload*, *Sign out and remove* | See the [user guide](USER-GUIDE.md#what-you-get). |
| *Wait for a server* | **Normal** (20 s), 45, 90, 180 seconds | Longer for a slow one (a Raspberry Pi). |

### Import configuration file

A link to a text file (up to 256 KB) with one addon link, playlist link or API key per line;
`#` lines are ignored. From your phone: its link, or the file (chosen or pasted). What it has
is listed to tick and import. See [Getting started](USER-GUIDE.md#add-your-addons).

### Export configuration

Your addons (in order), playlists and Stalker portals (names, guide links), API keys
and settings (not your Trakt sign-in, history or progress), as a file your phone copies or
downloads, to import later. It holds your passwords and keys: keep it private. Imported
settings replace yours (StremioK restarts).

## Playback

### Audio

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Preferred language* | **Default (first track)**, a language | The audio track picked when there's one in it. |
| *Second choice* | **none**, a language | Picked when there's none in the preferred language. |
| *Switching to it* | **Quick (no wait)**, Safe: waits 3, 6 or 10 seconds | Quick picks the track before the video starts; Safe once playing, reloading the audio 6 seconds back (when Quick names your language but you hear another). Live streams always switch Safely. |

### Subtitles

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Default language* | **Off**, a language | Turns a subtitle on by itself. |
| *Second choice* | **None**, a language | Used when nothing is in the default language (not when the default is Off). |
| *Second subtitle (at the top)* | **Off**, a language | A second language at the top of the screen at the same time. |
| *Only my languages* | **Off**, On | The subtitle menu lists only the three languages above, and tracks that don't say their language. |
| *Skip lines with* | **none**, your words, separated by commas | A line with one of them (or a bit of one, capitals or not) isn't shown. |

**Appearance** (a page of its own, from Subtitles):

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Size* | Small, **Medium**, Large, Extra Large | |
| *Color* | **White**, Yellow, Cyan, Green | |
| *Background* | None, **See-through box**, Solid box | |
| *Edge* | **Drop shadow**, Outline, None | |
| *Position* | Lower, **Bottom**, Raised, Higher | Lower is close to the screen's edge; Raised is above a widescreen film's black bars. |
| *Font* | **the TV's**, Roboto, Atkinson Hyperlegible, Nunito, Cousine | |

### Skipping

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Intros, recaps and previews* | **Ask**, After 5, 10, 15 or 30 seconds | Ask shows the *Skip Intro* prompt; a countdown skips on its own, with Cancel. |
| *Next episode* | **Ask**, After 5, 10, 15 or 30 seconds | At the credits: the prompt, or the next episode after a countdown, with Watch Credits. |

### Seeking & buffering

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Seek step* | 5, **10**, 15, 30 seconds | How far LEFT / RIGHT jump. FF / REW jump three steps; holding a direction speeds up. |
| *Reconnect live channels* | Off, **A few times**, Keep trying | A channel that drops (lost, frozen or ended) opens again at the live edge: 3 times in 5 minutes, or with no limit, up to a minute apart (BACK stops it). Off: the player closes. |
| *Buffer* | **Normal (the TV's own)**, More, Most | What the TV's player loads before starting and after running dry (More: 8 and 10 seconds; Most: 15 and 20): slower to start, dry less often. |
| *HLS through StremioK's service* | **Off**, Sources that need headers, All HLS sources | The service fetches it with the source's User-Agent, Referer and Cookie (the TV's player can't always send them): a step more to start. Hold OK on a source: once. |

### Source ranking

Everything that decides which source plays: the order on this page, with two pages of their own
for what's left out and what *▶ Play* does. Their rows sum up what's set.

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Played before first* | **On**, Off | Sources that played for this title (or, for a series, like its recent episodes') come first; Off, they rank like others. |
| *Filters ›* | a page (below) | What's left out, or sent to the bottom. |
| *When you press Play ›* | a page (below) | Whether the list shows, and what happens when a source doesn't start. |
| The criteria, in order | ▲ / ▼ to move, OK to turn on or off | What orders the sources (see [The criteria](#the-criteria)). *Restore defaults* puts them back. |
| *Addons* (Feed sources) | ▲ / ▼, OK to turn off | The addons that give sources, in the order they're asked. One turned off isn't asked. |

**Filters:**

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Sources the TV can't play* | **Shown**, Hidden | Shown: dimmed at the bottom. Hidden: torrents and links it can't open are left out (a line says how many); where-to-watch apps stay. |
| *Movies' sizes* / *Series' sizes (an episode)* | *Smallest* (100 MB to 2 GB), *Largest* (2 GB to 80 GB), *Most per hour* (1 GB to 10 GB an hour); **no limits** | Sources outside a limit move to the bottom and are never picked on their own ([Size limits](#size-limits)). |
| *Hide sources with these words* | **none**, your words, separated by commas | Sources with one in their name, description or file name (whole words, capitals or not: CAM, HDTS, a language) move to the bottom and are never picked on their own. |

**When you press Play:**

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Skip the source list* | **Off**, On | On, *▶ Play* on a movie, OK on an episode and *▶ Play SxEx* play the top source once the addons have answered (nothing playable: the list). The remote's ▶ Play key does this whichever you choose. |
| *The next source if one doesn't start* | **On**, Off | A source the TV refuses, or not started after 45 seconds, gives way to the next (up to 3 more); Off: back to the list. Not live channels, YouTube or USB files. |

#### Size limits

*Most per hour* goes by the title's length: 3 GB an hour allows a 2-hour film up to 6 GB and a
45-minute episode up to 2.25 GB. A source outside a limit says why (*over 20 GB*, *4.1 GB an
hour, over 3 GB*). A source without a size, or a title without a length (for *Most per hour*),
isn't held to them.

#### The criteria

In their default order, all on except the last:

1. **Resolution (high to low):** at the top, the list is grouped by resolution.
2. **Not yet cached last.**
3. **Release type:** remux > Blu-ray > web > unknown > TV rip, CAM far below.
4. **HDR before SDR.**
5. **Seeders (high to low):** the count a torrent source states (Torrentio's 👤 123); sources
   that don't state one keep their order.
6. **Feed sources order:** your addons' order (below).
7. **Each addon's own order:** right after *Feed sources order*, each addon's list as it gives
   it, one addon after another; above it, the addons' lists interleave.
8. *Cached before unknown* (off).

### Formats

What plays on this TV, learned as you watch. It starts empty; each source you play adds its
**video profile** (resolution, codec, bit depth and HDR: *4K · HEVC · 10-bit · HDR10*) and its
formats (video codec, 10-bit, HDR / Dolby Vision, audio, file type). Sources with a format
marked *Not working* sit at the bottom of the list, and ▶ Play best and the next episode skip
them.

| Setting | Choices | What it does |
|---------|---------|--------------|
| Each row | **Working**, Not working | *Working* once a source with it has played a couple of seconds, *Not working* after failing with two different files. OK switches it by hand. |
| *Mark "Not working" automatically* | **On**, Off | Off, failed starts aren't recorded; what's marked stays. |
| *Resolutions* | 4K, 1440p, 1080p, 720p, SD, Unknown: **Allowed**, Not allowed | A resolution not allowed sends its sources to the bottom at once. |
| *Forget all formats* | | Starts over (the resolutions stay as you set them). |

### Private viewing

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Private viewing* | **Off**, On | On, what you play isn't recorded (see [Privacy](PRIVACY.md#private-viewing)) until turned off; StremioK's name shows in outline. UP › *◐ Private*: for what's playing. |

## Appearance

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Language* | **Automatic** (the TV's; English where StremioK was already in use), English, or another language | Menus, buttons and messages; StremioK restarts in it. Titles and synopses come from your addons. |
| *Look* | **Classic**, Modern | Modern: big backdrops and logos, rounder posters, a centered menu. |
| *Effects* | **Auto (by the TV)**, Light, Full | Modern's blur, fades and motion. Auto: on from Tizen 6 (2021 TVs), off on older ones, where they'd slow it. |
| *Background* | Black, **Dark**, Light Gray, White | The light ones have dark text; the player keeps its dark controls. |
| *Accent color* | **Indigo**, and nine others | |
| *Zoom* | **100%**, 110%, 120%, 130%, 140% | Everything bigger; fewer cards fit a row. Subtitles keep theirs. |
| *Poster orientation* | **Portrait**, Landscape | |
| *Ratings on posters* | **Off**, On | A title's IMDb rating on its card (★ 7.8), when the catalog gives it. |
| *Watched titles* | **Show**, Dim, Hide | Ticked (✓), dimmed too, or left out of Home's and Discover's rows (not Continue Watching). |
| *Hide spoilers* | **Off**, Pictures, Pictures and synopses | Blurs the stills of episodes you haven't watched (and hides their synopses). |

## Home

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Start on* | **Watching** (Continue Watching), any Home tab | The tab StremioK opens on (the Guide once its guide is read; Watching for a hidden tab). |
| *Titles in a Home row* | **30**, 50, 100, 200, Unlimited | How many titles a Home row holds (catalogs, IPTV groups). More load slower, *Unlimited* much slower (an addon may refuse so many requests). ★ Favorites shows all. |
| *Home bar preview* | **Most recent first**, As in Watching, Off | Continue Watching on the TV's home bar (StremioK on it: Apps › StremioK › *Add to Home*): up to 8 playable tiles. Sideloaded app, Tizen 4 and later. |
| *Menu ›* | ⇈ ▲ ▼ ⇊, OK to show or hide | The top menu's order between Watching (first) and Settings (last), and which Home tabs show. Discover and Search always show. |
| *Home feeds ›* | ▲ / ▼, OK to show or hide | The order of the Home rows, and which show. |
| *Search results ›* | ▲ / ▼, OK to show or hide | The same for Search's rows; a hidden one isn't asked. |

## Diagnostics

The Diagnostics page also says how StremioK was installed (sideloaded `.wgt` or TizenBrew) and
whether its YouTube service is running. Nothing in Diagnostics leaves the TV.

### Logs

The last 200 problems since StremioK started (failed downloads, playback and script errors,
storage full), newest first, with keys, tokens and passwords masked; *Clear log*. When
StremioK closed without being exited (a crash, or the TV closing it), the next launch says so,
with its last steps. *Startup* shows how long this launch and the one before took. See
[Troubleshooting](TROUBLESHOOTING.md#where-to-look).

### Storage

| Setting | Choices | What it does |
|---------|---------|--------------|
| *Use the TV's database* | **On**, Off | The database holds StremioK's big copies (Home's saved rows, playlists, USB indexes, watched histories). Off: in the settings storage (about 5 MB), the database deleted. |
| *TV storage* | | What StremioK keeps, item by item, with sizes (its saved TV guides too), and the TV's free disk space. |
| *Tidy up the TV's database* | | Gives back the space of old versions the TV hasn't cleared out. |
| *Clear saved copies* | | Gives up the copies that can be made again (Home's saved rows, IPTV playlist copies, saved TV guides and Xtream lists, the USB index). |

### Installed apps

The TV's apps with their IDs (hidden system apps on request). OK on one opens it: a check of
which apps StremioK may launch from this install. On the TV only.
