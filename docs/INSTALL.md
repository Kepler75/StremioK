# Installing StremioK

StremioK runs on Samsung TVs with Tizen 3.0 or later (2017 models onward). It's tested on a
2017 UN50MU6100 (Tizen 3.0) and a 2021 QN55Q80AAG (Tizen 6.0). Once it's installed, the
[README's first steps](../README.md#first-steps) get you watching.

- [Which way to install](#which-way-to-install)
- [TizenBrew](#tizenbrew)
- [Apps2Samsung (a release's `.wgt`)](#apps2samsung-a-releases-wgt)
- [Tizen Studio (build and sideload)](#tizen-studio-build-and-sideload)
- [Updating](#updating)

## Which way to install

| | TizenBrew | Apps2Samsung | Tizen Studio |
|---|---|---|---|
| You need | TizenBrew on the TV (Tizen 3.0 to 6.0) | Apps2Samsung on a computer or Android phone, a Samsung account | Tizen Studio and a Samsung certificate profile |
| Certificate signing | none | done for you by Apps2Samsung | yours |
| StremioK's storage | shared with every other TizenBrew module ([see below](#tizenbrew-shares-storage)) | its own | its own |
| Downloads to a USB drive, indexing a drive | no | yes | yes |
| A USB drive's subtitle files for streamed titles | no | yes | yes |
| Continue Watching on the TV's home bar (Tizen 4 and later) | no | yes | yes |
| Opening other apps ("where to watch") | as far as TizenBrew allows its modules | yes | yes |

Apart from these, the features are the same in all three, YouTube included; how well a TV's
own player copes with a stream doesn't depend on how StremioK was installed. The sideloaded app
(Apps2Samsung or Tizen Studio) and TizenBrew can both be installed on one TV. *Settings › Diagnostics* says
how a copy was installed and whether its YouTube service is running.

## TizenBrew

[TizenBrew](https://github.com/reisxd/TizenBrew) runs web-app modules on the TV without
certificate signing.

1. Install TizenBrew on the TV (see its own instructions).
2. In TizenBrew, open **MENU › Add NPM module** and enter `stremiok`.
3. Open StremioK from TizenBrew.

TizenBrew starts StremioK's YouTube service when it launches StremioK. If the service doesn't
answer, StremioK says so: close it, open it again from TizenBrew, and update TizenBrew if
that doesn't help (it needs a TizenBrew that runs module services).

### TizenBrew shares storage

Every TizenBrew module can read what StremioK keeps, your API keys and addon tokens included
(the full list is in [Privacy and data](PRIVACY.md#tizenbrew-shares-storage)). Install only
modules you trust, or choose the sideloaded app. Settings shows this notice on a TizenBrew
install.

## Apps2Samsung (a release's `.wgt`)

Each [release](https://github.com/Kepler75/StremioK/releases) has an unsigned
`StremioK-<version>.wgt`. [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)
(Windows, macOS, Linux, Android) signs it with your own Samsung certificate and installs it.

1. On the TV, turn on **Developer Mode**: open Apps, press 1 2 3 4 5 on the remote, and set
   *Host PC IP* to the address of the device running Apps2Samsung. Restart the TV.
2. Download `StremioK-<version>.wgt` from the latest release.
3. In Apps2Samsung, pick your TV and choose that file as a custom `.wgt`. It signs in to
   Samsung once (for the certificate) and installs it.

## Tizen Studio (build and sideload)

Installing on a retail TV needs a **Samsung certificate profile**: create one in Tizen
Studio's Certificate Manager (a *Samsung* profile, signed in with a Samsung account, with your
TV's DUID added to its distributor certificate). A Tizen-only profile won't install.

From a clone of this repository, with the Tizen Studio CLI on your `PATH`:

```bash
tizen build-web -e 'docs/*' -e 'scripts/*' -e 'package.json' -e 'README.md' -e 'CHANGELOG.md' -- .
```

```bash
tizen package -t wgt -s <your-cert-profile> -- .buildResult
```

Put the TV in Developer Mode (as in step 1 above, with your computer's address), then connect
to it with `sdb`, which comes with Tizen Studio (Samsung's guide:
[Connecting the TV and SDK](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)):

```bash
sdb connect <TV's IP address>
```

`sdb devices` then lists the TV by its device name. Install:

```bash
tizen install -n StremioK.wgt -t <TV-device-name>
```

The docs and scripts stay out of the package.

## Updating

- **TizenBrew:** TizenBrew serves its modules from npm rather than installing them on the TV,
  so a newer published version of `stremiok` reaches you through TizenBrew (see TizenBrew's own
  documentation for how and when it refreshes a module).
- **Apps2Samsung:** install the newer release's `.wgt` the same way.
- **Tizen Studio:** build and install again from the newer code.

Your settings, addons and progress stay.
