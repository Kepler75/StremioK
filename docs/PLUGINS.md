# Nuvio plugins

StremioK can run **Nuvio plugins**: small programs that look for sources for a film or an
episode, written for the [Nuvio](https://github.com/NuvioMedia) apps. StremioK reads the same
plugin repositories Nuvio does, so a repository made for Nuvio works here too. Credit for the
plugin format goes to the Nuvio project; StremioK isn't affiliated with it.

> **Read this first.** A plugin is someone else's code, run on your TV. StremioK keeps it apart
> from everything else (it can't see your settings, keys or files), but it can reach any website,
> and it learns which title you open. StremioK doesn't host, check or vouch for what a plugin
> finds, and gives no help with any particular plugin, as with any particular addon: if one
> stops working, ask its author.

## Which TVs
2017 and newer (Tizen 3 or later), with the sideloaded app. TizenBrew, older TVs and a desktop
browser don't show it: plugins need StremioK's own service.

| TVs | How plugins run |
|---|---|
| 2021 and newer (Tizen 6 on) | QuickJS in WebAssembly: two at a time, 20 s each |
| 2017 (Tizen 3) | QuickJS as plain JavaScript: slower, one at a time, 30 s each |
| 2018 to 2020 (Tizen 4, 5.0, 5.5) | As 2017, marked *experimental*: untried |

## Turning it on
1. In Settings › Content › Nuvio plugins, turn on *Nuvio plugins*. StremioK asks you to
   confirm: plugins run third-party code, and they're given your TMDB key.
2. *+ Add a repository*: its address (the one ending in `manifest.json`, or the folder it's
   in), typed or sent from your phone.
3. Each of its plugins is listed: OK turns one on or off. New ones start off.

Plugins need a [TMDB key](SETTINGS.md#integrations) (Settings › Content › Integrations): they
look titles up by their TMDB number.

Their sources show on title pages with your addons' (*From: Nuvio plugins*), ranked with the
rest, and placed like an addon in Settings › Playback › Source ranking (*Feed sources order*).
*↻ Refresh* gets a repository's latest plugins; StremioK never fetches them on its own.

## How it works
- **The code** is downloaded when you add or refresh a repository (up to 1 MB a plugin, 50
  plugins) and kept on the TV.
- **Each run** gets a fresh copy of QuickJS (a JavaScript engine) in a background worker:
  64 MB of memory, nothing of StremioK's inside. It's given the
  title's TMDB number, the season and episode, your TMDB key, `fetch`, `cheerio`, `crypto-js`,
  `URL`, `atob` / `btoa`, timers and `console` (logged in Settings › Diagnostics).
- **`cheerio`** runs outside QuickJS, on the TV's own engine, far faster; the plugin's stand-in
  passes it only text and numbers.
- **Its requests** go through StremioK's service: http(s) only, never the TV itself, 1 MB an
  answer, 40 requests a run. Your home network (by address, after the name is looked up, and at
  every redirect) follows *Local-network links from internet addons*.
- **Its sources** go through the same checks as an addon's: 100 at most, with their headers
  played as [an addon's](TECHNICAL-REFERENCE.md#sources).
- Bundled, unchanged, and loaded only when a plugin runs: quickjs-emscripten and crypto-js
  (MIT) and cheerio (MIT, with BSD and ISC parts); their licenses are in `js/vendor/quickjs/`.
