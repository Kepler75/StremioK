# Privacy and data

What StremioK keeps, what it sends and to whom, and how to keep things to yourself. StremioK has
no account and no server of its own: it talks directly to the services below, from your TV.

- [What stays on the TV](#what-stays-on-the-tv)
- [What leaves the TV, and where it goes](#what-leaves-the-tv-and-where-it-goes)
- [Private viewing](#private-viewing)
- [Links that carry your tokens](#links-that-carry-your-tokens)
- [Sending text from your phone](#sending-text-from-your-phone)
- [Your home network](#your-home-network)
- [StremioK's service on the TV](#stremioks-service-on-the-tv)
- [TizenBrew shares storage](#tizenbrew-shares-storage)
- [Clearing what's kept](#clearing-whats-kept)

## What stays on the TV

Kept on the TV, in StremioK's own storage:

- your addons and playlists (their links, with any tokens in them), API keys, settings;
- progress, watched marks, Continue Watching, ratings you gave;
- per-title choices: subtitle and audio tracks and timing, sources marked not suitable, the
  sources that played (the last 3 for each movie or episode, 150 in all), formats learned;
- saved copies to start quickly: Home rows, addon manifests, IPTV playlists, USB drive indexes;
- with Trakt connected: your Trakt history and sign-in tokens.

Nothing in Diagnostics leaves the TV. Keys, tokens and passwords are masked (•••) wherever a link
is shown or appears in an error message, and in the logs.

## What leaves the TV, and where it goes

| Who | What they get | When |
|-----|---------------|------|
| Your addons | The title (its IMDb or other id), season and episode you open; your search words; for subtitle addons, the playing file's name, size and fingerprint (as Stremio sends them), so subtitles for that exact release come first | As you browse, search and play |
| Your search addons | Titles worked out from your USB drive's file names (not the files) | Only once you've said yes to matching |
| TMDB, OMDb, MDBList | Title ids, with your own API key | With a key set, as you browse |
| Trakt | What you play (where you stopped, watched), marks you make by hand, ratings | Only when connected |
| AIOManager | Your API key, to read your addon list; StremioK shows in its *Connections* as a *Pull* app. Your addons are never sent | When you sync |
| Your Stremio account | Read once to list your addons; StremioK signs out straight after. No password reaches the TV | When you import |
| TheIntroDB, SkipDB, IntroDB, AniSkip, ARM | The title's ids, season, episode and length, to find skip times | As something plays |
| YouTube | What any YouTube page asks for (no account, no key), through StremioK's service | YouTube videos, trailers, YouTube catalogs |
| SponsorBlock (`sponsor.ajay.app`) | The first 4 characters of a hash of the video's id: the answer covers every video sharing them, so it isn't told which one. For DeArrow titles in a list, the listed videos' ids (what a channel lists, not what you watch) | YouTube videos and lists |
| Media servers (debrid services, the hosts in a source's link) | Requests for the video itself, with whatever the link carries (debrid tokens) and the headers an addon asks for | As something plays or downloads |
| IPTV providers | Requests for your playlists and channels, with the username and password in their links and a channel's own headers | As you load playlists and watch |
| Subtitle-file hosts | Requests for the subtitle files your addons list | As something plays |
| Image hosts | Requests for posters and pictures | As you browse |

StremioK has no analytics and sends nothing to its developers.

## Private viewing

Settings › Playback › *Private viewing*, or UP › *◐ Private* while something plays. While it's
on, what you play isn't recorded:

- no progress or place to resume, nothing added to Continue Watching;
- nothing marked watched at the credits (and no next episode queued);
- nothing sent to Trakt;
- no "played before", no remembered subtitle or audio choice;
- a YouTube video's audio language isn't remembered, and Diagnostics doesn't name it ("a private
  playback").

What you do by hand (*Mark watched*, *Add to Continue Watching*) still counts. What starts from a
private playback is private too: a video followed from an end screen, another source picked in
the player.

It's about what StremioK *keeps*, not who's contacted: playing still asks your addons for
sources and subtitles, and YouTube, SponsorBlock and the skip-time services, as usual.

## Links that carry your tokens

- **Addon and playlist links** often carry personal parts: config tokens, usernames, passwords,
  API keys. StremioK masks them on screen and in error messages.
- **Share** (OK on an addon) shows a QR code of its link, tokens included: only show it to your
  own devices.
- **▣ Phone** (continue on phone, UP while playing) shows a QR code of what's playing. Anyone who
  scans it can play it, and a debrid link carries your account's access, so it's shown only
  when you ask.
- A playlist downloaded over plain `http://` is noted in Diagnostics.

## Sending text from your phone

**▣ From your phone** opens a small page StremioK's service serves on your home network.

- It travels **unencrypted** (plain HTTP), as anything a page on the TV serves, so use it only on
  a network you trust: addon and playlist links often carry your tokens or passwords.
- It exists only while the QR code is on screen: at most 5 minutes, and it closes 30 seconds after
  the TV stops asking for it (StremioK closed or in the background).
- Its address has a random one-time code, and it takes one entry.
- Its port listens on the TV's home-network address only, and only while a page is open.

## Your home network

*Local-network links from internet addons* (Settings › Content › Addons) is **Blocked** by
default: an addon on the internet can't point streams, subtitles, artwork or any other link into
your home network (a router, NAS, camera, the TV itself). Addons on your own network and your
IPTV playlists aren't affected.

It's best effort. A redirect into your network is caught only once it's there (the request has
been made, but its answer isn't used); a public name that resolves to a local address isn't
caught, nor a redirect followed by the TV's player or an image. The exact rules are in the
[technical reference](TECHNICAL-REFERENCE.md#local-network-links).

## StremioK's service on the TV

The sideloaded app and TizenBrew run a small service on the TV for YouTube, USB drives,
downloads, the phone page, AIOManager and live channels. It listens on the TV itself only and
refuses requests from web pages: a request must name its local address and carry no `Origin`
header, and the USB, download and other sensitive endpoints also need a token only StremioK can
read (or, where it can't, a header a web page can't send). These checks keep web pages out; they
don't prove who's calling, and under TizenBrew every module shares StremioK's address. It reads
only USB drives (`/opt/media/…`), never a path elsewhere. Details in the
[technical reference](TECHNICAL-REFERENCE.md#who-it-answers).

## TizenBrew shares storage

TizenBrew serves every module from the same address, so they all share one storage. Another
TizenBrew module you install can read what StremioK keeps (API keys, addon links with their
tokens, playlist links with any username and password, the stream links of what you're watching
with their request headers, which can carry debrid tokens, remembered subtitle links, the
sources you've played, Trakt's sign-in tokens) and reach StremioK's service. Only install
modules you trust, or use the sideloaded app, which keeps its data to itself.

## Clearing what's kept

- **Trakt:** disconnecting stops everything under way for that sign-in and clears what was kept
  from Trakt (history, Continue Watching, rows, ratings) and the changes waiting.
- **AIOManager:** *Forget AIOManager* clears the address, the key and the record of what came
  from it (your addons stay).
- **Saved copies:** Settings › Diagnostics › Storage › *Clear saved copies*.
- **USB:** *Clear the USB index* and *Forget matches* (Settings › Content › USB drive).
- **Formats:** *Forget all formats* (Settings › Playback › Formats).
- **Logs:** *Clear log* (Settings › Diagnostics › Logs).
