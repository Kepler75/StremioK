# Security policy

StremioK is a TV app with a small Node service of its own, made and looked after by one person
in their spare time. Reports of security problems are very welcome; this page says how to send
one and what happens next.

## Supported versions

Only the latest release gets security fixes. Update to it before reporting, in case it's fixed
already.

| Version | Fixes |
|---------|-------|
| 2.2.x (latest) | Yes |
| Older | No: update through TizenBrew, or install the latest `.wgt` |

## Reporting a vulnerability

Please **don't open a public issue** for it. Report it privately instead, through GitHub:
[Report a vulnerability](https://github.com/Kepler75/StremioK/security/advisories/new) (the
repository's **Security** tab). Only you and the maintainer see it.

A useful report says:

- StremioK's version, and how it's installed (sideloaded `.wgt` or TizenBrew);
- the TV's model and year (or its Tizen version);
- what an attacker could do, and what they'd need first (being on your home network, getting
  you to add an addon or playlist, a page open in the TV's browser…);
- the steps to see it happen, and a proof of concept if you have one.

## What happens next

- **A reply** saying the report arrived, then whether it's confirmed and how serious it looks.
- **A fix** in a new release, as soon as its seriousness calls for; you're told when it's out,
  and can check it first if you like.
- **Disclosure:** the advisory is published once the fix is released, crediting you unless
  you'd rather not be named. Please keep it private until then.

## What's in scope

- **The app** (`index.html`, `js/`, `css/`) and **its bundled service** (`service/`).
- **The service's local endpoints** (`127.0.0.1:8099`, or `8098` under TizenBrew) and the checks
  on who may use them: a web page or another app on the TV reaching what it shouldn't, such as
  files on a USB drive, downloads or the live relay.
- **The phone page**, on the TV's home-network address while it's open.
- **Untrusted input:** what addons, M3U playlists, Xtream servers, TV guides (XMLTV), subtitle
  files and YouTube send StremioK, and the links they lead it to.
- **Your data:** API keys, your Trakt connection, Xtream logins, and what you watch, reaching
  anyone they shouldn't.

How the service decides whom to answer, and what it doesn't try to prevent, is in the technical
reference: [Who it answers](TECHNICAL-REFERENCE.md#who-it-answers).

## What's out of scope

- **Other people's services and content:** addons, IPTV servers and their streams, YouTube,
  Trakt, TMDB, OpenSubtitles, AIOManager. Report those to whoever runs them.
- **TizenBrew, Apps2Samsung, and the TV itself** (its firmware, player and web engine). Report
  those to their makers; how StremioK uses them is in scope.
- **Someone who already controls the TV**, through developer mode or its debugging tools.
- **Hardening without a way to cause harm**, such as a playlist's own `http://` links.
- **Copyright or content complaints:** StremioK hosts nothing (see the
  [README](../README.md)).

## Testing in good faith

Test on your own TV, with your own accounts and playlists. Don't reach other people's data, and
don't load other people's servers with traffic. Research done that way, and reported here first,
is welcome, and won't be pursued.
