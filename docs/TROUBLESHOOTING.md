# Troubleshooting StremioK

What to do when something doesn't work. For how things are meant to work, see the
[user guide](USER-GUIDE.md); for every setting, the [settings reference](SETTINGS.md).

- [Where to look](#where-to-look)
- [Addons](#addons)
- [No sources, or none that play](#no-sources-or-none-that-play)
- [A source doesn't start](#a-source-doesnt-start)
- [Playback](#playback)
- [Audio and subtitles](#audio-and-subtitles)
- [Skip prompts](#skip-prompts)
- [YouTube and trailers](#youtube-and-trailers)
- [IPTV](#iptv)
- [Trakt](#trakt)
- [USB drive](#usb-drive)
- [Other apps](#other-apps)
- [Storage](#storage)

## Where to look

- **Settings › Diagnostics › Logs** lists the last 200 problems since StremioK started (failed
  downloads, playback and script errors, storage full), with secrets masked. Many entries below
  say what they note there.
- **After a crash** (or the TV closing StremioK), the next launch says so: about when, after how
  long, the memory it used, its last steps and what was logged just before.
- **Slow to start?** *Startup* in Logs shows how long this launch and the one before took to
  apply the stylesheet, draw the first screen, load the addons and show the first title.
- **Diagnostics** also says how StremioK was installed and whether its YouTube service is
  running.

## Addons

| What you see | Why, and what to do |
|--------------|---------------------|
| An addon doesn't load | Settings › Content › Addons says why ("too large (over 2 MB)", "not an addon manifest", "timed out"…), with what the addon itself said when it refused (AIOStreams' "Invalid stream expression…" for a configuration it can't read). *Refresh* says it too. |
| An addon fails the first time, then works | It's hosted where it sleeps when unused and takes a while to wake. Set *Wait for addons* longer (Settings › Content › Addons). |
| An old addon link won't add | Only v3 addons work. Old `/stremio/v1` addons (e.g. `opensubtitles.strem.io/stremio/v1`) aren't supported; use their v3 versions. |
| Shows are described by the wrong addon (file names as episode titles) | A library addon (one describing shows from your files) answered before Cinemeta. The title page says which addon described it ("Details: Cinemeta"); move Cinemeta above the other with ▲ / ▼. |
| An addon's links to a device on your home network don't open | *Local-network links from internet addons* is *Blocked* (the default). Allow it only for addons you trust (see [Privacy](PRIVACY.md#your-home-network)). |
| AIOManager asks for the key again | AIOManager refused it, so it was forgotten. Enter a current one from AIOManager › the account's settings. |
| Discover or Search shows *from earlier: the addon sent nothing just now* | Some addons (YouTubio) answer an empty list when they fail; the titles from earlier this session are shown instead. Try again later, or **↻ Try again**. |
| A genre is missing from Discover's list | It came back empty twice in a row and is left out for a day. *Show N left out* at the end of the list brings it back. |

## No sources, or none that play

| What you see | Why, and what to do |
|--------------|---------------------|
| "No sources found" | No addon had anything, or none answered in time. StremioK asks once more after 3 seconds on its own; then **↻ Re-scan**. An addon that gathers from others (AIOStreams) can still be gathering and has it ready the next time. What an addon said instead (its filters, its errors) shows on that page. |
| "None of your addons provide sources" | Add a stream addon (Settings › Content › Addons). Cinemeta and OpenSubtitles give titles and subtitles, not sources. |
| Sources listed, but only as torrents | The TV's player needs a direct HTTP(S) or HLS link; StremioK has no torrent engine. Use a stream addon with a debrid service. *Sources the TV can't play: Hidden* leaves them out. |
| A source is at the bottom, "Not working or not allowed on this TV" | A format in it failed twice before, or its resolution isn't allowed. Settings › Playback › [Formats](SETTINGS.md#formats) shows which, and OK switches it back to *Working*. |
| A source is at the bottom under "Outside your size limits" or "Hidden by your words" | Your [size limits or words](SETTINGS.md#source-ranking). It stays listed, a press away. |
| *🕘 From earlier* sources don't play | The addon didn't answer in time, so the links it gave earlier are shown; they may have expired. Open the title again later to ask the addon fresh. |

## A source doesn't start

With *The next source if one doesn't start* on (the default), StremioK tries the next one on its
own ("Didn't start: trying the next source (2 of 4)…"), up to 3 more.

**A notice instead of the video.** When a source doesn't start, StremioK looks at where its link
leads. A debrid addon that can't give the file sends a short notice video the TV won't play;
StremioK says what it means, naming the service from the source's tag (*[TB⚡]*: TorBox,
*[RD⚡]*: Real-Debrid…) and the addon:

| Message | What to do |
|---------|-----------|
| "TorBox refused access (AIOStreams): check its TorBox key in the addon's settings" | Your key in that addon's configuration is wrong or expired. Fix it in the addon's setup page (*Configure* on the addon). |
| "TorBox: your limit is reached for now" | Your debrid account's limit. Wait, or use another service. |
| "TorBox won't give this file" | The service refuses this file. Try another source. |
| "Still downloading on TorBox: try again later" | The service hasn't got the file yet. Try again later. |

For notices about your account (access refused, a limit), the next source skips that addon's
other links through the same service, since they'd say the same.

**A few seconds of video, then "not ready yet".** Some debrid services answer a file they're
still downloading with a short video saying so (Real-Debrid through AIOStreams). A source
shorter than 2 minutes is taken for that: it isn't marked watched, and StremioK goes back to the
sources. Try again later.

## Playback

| What you see | Why, and what to do |
|--------------|---------------------|
| It stalls | A stalled stream reloads at the same position; if it keeps stalling, you're back on the source list. Try another source, or *Buffer: More* or *Most* (Settings › Playback › Seeking & buffering) on a slow connection. |
| An HLS quality won't start | It steps down a quality, then falls back to *Auto*. |
| A live channel keeps reopening | Its server stops the stream; StremioK opens it again ("The stream ended — opening the channel again…"), and stops when it keeps ending. |
| After a pause, it jumps ahead | The TV's player sometimes jumps to where it would be had it never paused. StremioK takes it back and notes it in Diagnostics; the same jump twice in a row (a real gap in the file) is let through. |
| No speed control, no HDR / frame-rate switching | Not available: the TV's player mutes audio at other speeds, and web apps can't switch modes on Tizen 3. |

## Audio and subtitles

| What you see | Why, and what to do |
|--------------|---------------------|
| The audio menu names your language, but you hear another | Some files need the audio reloaded for a switch to take effect. Set *Switching to it* to *Safe* (Settings › Playback › Audio). |
| A switch didn't happen | Choose the ticked track again in the audio menu: it's applied again. |
| The 2017 TV freezes after switching audio and jumping | Its player can crash on a jump made right after another. *Safe, waits 10 seconds* is what it needed. |
| Subtitles are early or late | *Timing* in the subtitle menu (or keys 1–3), or *Sync by ear*. A file made for another release can be seconds off. |
| A built-in subtitle can't be made earlier | The TV's player hands each line over at its time, so StremioK can hold it back but not show it sooner. |
| A built-in subtitle is selected but shows nothing at the start | The TV sometimes takes the first pick without showing lines; StremioK picks it again after a few seconds of playback. |
| Ad lines in subtitles ("Advertise your product…") | *Skip lines with* (Settings › Playback › Subtitles): `OPENSUBTITLES`, `.SRT`. |
| A subtitle file on the USB drive shows *Unknown language* | Its name has no language StremioK knows (a tag like `-ESP` isn't guessed). It's still listed; rename it (`….es.srt`) and index the drive again to have it in its language. |
| `.gz` subtitles don't load | Gzipped subtitle files aren't decoded. |

## Skip prompts

| What you see | Why, and what to do |
|--------------|---------------------|
| No *Skip Intro* | Skip times may not exist for this episode or release. Check Diagnostics › Logs for lookup failures; if the lookups succeeded but gave no usable times, no prompt is expected. |
| *Skip Credits* in the last 10 seconds only | No service has credits timing for it, so the last 10 seconds count as credits. |
| Anime on a Tizen 3 TV gets fewer skip prompts | A Tizen 3 TV can't reach AniSkip or ARM (they need newer secure connections than its browser makes), so only TheIntroDB, SkipDB and IntroDB are asked. |

## YouTube and trailers

| What you see | Why, and what to do |
|--------------|---------------------|
| "… through StremioK's YouTube service, which TizenBrew hasn't started" | TizenBrew didn't start it. Close StremioK and open it again from TizenBrew; if that doesn't help, update TizenBrew. |
| A trailer is skipped for another, with a note | YouTube refuses some studio uploads to the kind of player StremioK uses (they play on YouTube's site). The next trailer plays instead. |
| A YouTube video won't play | Some videos aren't offered in a form the TV's player takes. YouTube also changes how it works now and then, which can need a StremioK update. |
| An addon's YouTube direct links don't play | YouTubio's direct links are made for its server's address, not the TV's. Its *Stremio Player* sources (a video id) play through StremioK's service. |

## IPTV

| What you see | Why, and what to do |
|--------------|---------------------|
| A channel's sound stutters | Some servers cut a channel's sound into pieces the TV's player stutters on. StremioK detects it and restarts the channel through its service ("Fixing this channel's sound…"); not for encrypted streams, and not in a desktop browser. |
| A big playlist is missing channels | A playlist keeps its first 30,000 channels (up to 20 MB); the status line says when channels were left out. |
| A playlist didn't refresh | The saved copy keeps showing, and the playlist says what went wrong. *Reload* tries again. |

## Trakt

| What you see | Why, and what to do |
|--------------|---------------------|
| Changes waiting, or not sent | *Trakt sync* (Settings › Content › Integrations) lists each one Trakt refused or that ran out of tries, with what Trakt said. *Sync now* sends everything; *Let them go* drops them. |
| **Trakt needs reconnecting** | Trakt no longer accepts the sign-in. Nothing is sent (changes wait) until you connect again. |
| A long-running show's episodes don't sync (Trakt says "not found") | Trakt files some shows in two (later seasons as a separate show). StremioK sends the episode again by its TheTVDB number when the addon gives it, so a waiting change goes through once you've opened the show's page. Those episodes' Trakt history isn't shown here as watched. |
| A note that Trakt changes were dropped | At most 200 changes wait; past that the oldest are dropped. Also noted when a change couldn't be saved on the TV (its storage full). |

## USB drive

| What you see | Why, and what to do |
|--------------|---------------------|
| A video isn't matched to its title | The name didn't give a close enough match. Hold OK on it › *Match to a title…*. |
| Nothing is matched at all | *Match videos to titles* is off (Settings › Content › USB drive). |
| A download won't start | Not enough free space, or a file over 4 GB on a FAT32 drive (exFAT and NTFS are fine). It says which. |
| A download stops: link refused | The debrid link expired. *Retry* asks the addon again. |
| A download stopped when StremioK closed | Some TVs stop it. It picks up where it stopped when you start StremioK again. |
| A big file from the drive stalls on every jump (2017 TV) | That TV's player can't read past 2 GB of a file on the drive, so StremioK plays files over 2 GB through its service, where jumping works. |
| Indexing, downloads or USB subtitles for streams are missing (TizenBrew) | They need StremioK's service with its private token, which TizenBrew has no place for. Local still browses. Use the sideloaded app for them. |

## Other apps

| What you see | Why, and what to do |
|--------------|---------------------|
| A where-to-watch app opens on its home screen | It only opens on the title where an addon gives the app's own link and the app takes it (Apple TV does; Prime Video doesn't, so far). |
| A service's app doesn't open | The TV has several apps for it (three Netflix entries, say). List the one to use in Settings › Content › Streaming apps; Settings › Diagnostics › *Installed apps* tries which one opens. |
| Apps don't open under TizenBrew | It depends on what TizenBrew allows its modules; the sideloaded app has the permission. |

## Storage

| What you see | Why, and what to do |
|--------------|---------------------|
| A note that something couldn't be saved (storage full) | StremioK clears what can be made again (saved Home rows, playlist copies, show info) to save what matters. If it still can't, it says so and notes it in Diagnostics. *Clear saved copies* (Settings › Diagnostics › Storage) frees more. |
| The TV's database refuses saves | The 2017 TV's database doesn't always clear old versions out itself. StremioK tidies it on its own when they take more than half its room; *Tidy up the TV's database* does it now. Freeing space on the TV (unused apps) also raises what it allows. |
| The TV's database keeps failing | Turn *Use the TV's database* off: everything goes in the settings storage instead (about 5 MB). |
