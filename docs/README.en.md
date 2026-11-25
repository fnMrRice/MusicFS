# MusicFS

[简体中文](../README.md) · English

MusicFS is a self-hosted music library. Add a music folder to your server and listen to your collection in a browser, on your desktop or on Android. Server plugins can also connect online music sources and find lyrics, artwork and release details for recordings you already own.

The NetEase Cloud Music desktop client inspired the overall layout of the Web and desktop apps. The left sidebar holds search, recommendations, libraries, favorites and playlists. The current page opens on the right. A persistent player along the bottom lets you skip tracks, check the queue and change the volume while browsing albums or editing playlists.

![The MusicFS Web track list with a track playing](screenshots/web-library.png)

*Screenshot of the Web library with demo tracks and artwork.*

## Features

- **Import and browse your library.** Scan server directories and mounted network shares. Set scan depth and exclusions per folder or enable file watching. Search by track title or browse by artist, album, genre, source or folder.
- **Organize versions of a recording.** Listen to potential duplicates before merging or dismissing them. A merge keeps every source and leaves the files in place. Choose a default version or pin a favorite or playlist entry to a particular source.
- **Discover and play music.** Open **Discover** for daily songs and recommended playlists from your NetEase account. Use **Time machine** to revisit earlier playlist recommendations. The Web player offers a queue, synchronized lyrics and audio effects. **Recently played** helps you find a track you heard earlier.
- **Save favorites and build playlists.** Favorite a track or select several tracks to add to a personal playlist. Combine other personal playlists and imported remote playlists in your preferred order, or link a playlist you own on NetEase. [Playlist linking and sync](#playlist-linking-and-sync)
- **Choose how to stream or download.** Play compatible audio directly or let the server transcode it. Online sources that support downloads can stream while caching. You can also choose a quality and save one track, a selection or an entire playlist to the server.
- **Edit and enrich metadata.** Edit tracks and albums, find releases by name, ID or album link, and preview tracklists, artwork and lyrics before choosing what to save. Set the order in which plugins look for lyrics or queue a batch lookup for albums with missing metadata.
- **Keep complete works together.** Plugins provide dedicated libraries for CD albums, ASMR works and recorded radio programs. Import a local folder to preserve disc, main program and bonus material directories, play individual tracks, and preview or download attachments.
- **Track background tasks.** Follow folder metadata refreshes, batch album lookups and batch duplicate merges in the task queue. The server continues submitted tasks after you close the page.

## Playlist linking and sync

1. **Choose where songs should go.** In the Web app, open **Playlists**, expand your signed-in NetEase account, and choose **Link a local playlist** on a playlist you can write to. Select **Favorites**, an existing personal playlist or a new one. Each NetEase playlist can link to one local destination. Several NetEase playlists can share that destination.
2. **Sync tracks from NetEase to MusicFS.** Linking starts the first sync automatically. MusicFS imports the tracks and their NetEase sources, then adds any missing tracks to the destination. When you add songs on NetEase, choose **Sync now** from the link under **Playlists** or from the linked destination. Sync keeps tracks you added by hand and skips entries already present. If the remote read fails, the last successful list stays available.
3. **Add tracks to NetEase from MusicFS.** For example, link your NetEase “Commute” playlist to **Favorites**. When you favorite a new track in MusicFS with its NetEase source selected, the server queues it for addition to “Commute”. Only NetEase tracks added after linking are sent. Local files, tracks from other services, and local reordering, hiding and removal stay in MusicFS.
4. **Check or remove a link.** The **Playlists** page shows the linked destination, pending additions and any write errors. Choose **Unlink** to stop future additions. Both sides keep their existing songs.

**To combine several playlists**, open a personal playlist and choose **Edit name and rules**. Under **Add a source to combine**, select another personal playlist or an imported remote playlist, then choose **Add rule**. Move the rules up or down, save, and choose **Update playlist snapshot** to play the combined list in that order. These edits apply inside MusicFS. [Account playlist linking](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/library/source-playlists.md) · [Playlist aggregation rules](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/library/playlists.md)

## Music source plugins

| Source | Current support |
| --- | --- |
| Local files | Scan directories the server can access, read track tags and serve audio files for playback. Mount NAS shares on the server first. |
| NetEase Cloud Music | Sign in with a QR code to search tracks, albums, artists and playlists, get daily song recommendations, and import or sync playlists. Append NetEase tracks to a linked writable playlist. Play or download full tracks at a quality available to the account. |
| Bilibili | Use an ID or link to play or download audio from individual parts of public videos or from Bilibili's audio section. Preview, import and sync public favorites folders and audio playlists. No Bilibili account is required. |
| QQ Music | Scan a QR code with the QQ mobile app to authorize an account. The server implements track search, but it is not yet available in the Web client. |
| Apple Music | With an Apple developer token, MusicKit can authorize a user and verify their storefront. The integration currently covers account access only. |

End-to-end sign-in with real accounts is still pending verification for NetEase, QQ Music and Apple Music, as are real-account writes to NetEase playlists. Available NetEase quality depends on the account and track. [Online sources](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/providers/online.md) · [Platform sign-in and verification status](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/providers/platform-login.md)

## Metadata, audio and storage plugins

| Purpose | Built-in plugins and capabilities |
| --- | --- |
| Album and work details | MusicBrainz, iTunes Search, Bangumi, NetEase and QQ Music provide album details and tracklists. DLsite finds works, creators' circles and artwork by RJ number. NetEase and QQ metadata lookups work without a platform account. |
| Lyrics and artwork | The local plugin reads embedded lyrics and artwork, matching LRC/TXT files and cover images in the same folder. NetEase, QQ Music and LRCLIB provide lyrics. Cover Art Archive finds covers for specific MusicBrainz releases. |
| Recording identification | The matching plugin scores possible duplicates. Configure `fpcalc` to generate Chromaprint fingerprints and add an AcoustID application key to look up candidate MusicBrainz recordings. |
| Audio formats and effects | Configure FFmpeg and ffprobe for format detection, decoding and transcoding. The NCM plugin reads MP3 or FLAC audio inside local NCM files. Optional server effects include gain, parametric EQ, compression, reverb and channel mixing. |
| Media and storage | Generate thumbnails from PNG or JPEG artwork. FLAC write-back is off by default. Administrators can authorize writing lyrics or artwork to FLAC files on supported local Windows NTFS volumes. The library uses SQLite by default and also supports PostgreSQL. |

Official plugins are built into the server and run in its process by default. Administrators can inspect plugin instances and their settings under **Settings → Plugin management**. [Built-in plugins](https://github.com/fnMrRice/MusicFS-server/tree/main/plugins) · [Metadata plugins and data sources](https://github.com/fnMrRice/MusicFS-server/blob/main/docs/plugins/provider-api-sources.md)

## Run from source

Building the Web client and server requires Git LFS, Go, Node.js and npm. See the [build guide](packaging.md) for tool versions and options.

```sh
git lfs install
git clone --recurse-submodules https://github.com/fnMrRice/MusicFS.git
cd MusicFS
```

From the root of the repository, run both commands for your platform.

| Platform | Build | Start |
| --- | --- | --- |
| Windows x64 (PowerShell) | `./scripts/package.ps1` | `./deploy/musicfs-windows-amd64/start.bat` |
| Linux x64 (Shell) | `sh scripts/package.sh` | `sh deploy/musicfs-linux-amd64/start.sh` |

Open <http://127.0.0.1:8080> and sign in with the administrator token generated by the launcher. Under **设置 → 音乐源 → 本地音乐 → 添加本地目录** (Settings → Music sources → Local music → Add local directory), choose a folder the server can read. Saving starts a scan. When it finishes, open the track list to play your music. [First sign-in, directory access and audio tools](packaging-start.md)

## Clients and server

| Repository | Current scope |
| --- | --- |
| [MusicFS-server](https://github.com/fnMrRice/MusicFS-server) | Go server, library, playback, plugins and API contracts |
| [MusicFS-web](https://github.com/fnMrRice/MusicFS-web) | Browser player and library management. Organize playlists, look up metadata, manage sources and background tasks, and adjust a ten-band EQ and other local effects during playback. |
| [MusicFS-android](https://github.com/fnMrRice/MusicFS-android) | One app for phones, tablets and Android TV, with LAN discovery, background playback, lock-screen and headset controls, and TV remote navigation. On Android 14 or later it can request bit-perfect output from a compatible USB DAC. |
| [MusicFS-client](https://github.com/fnMrRice/MusicFS-client) | Native Rust desktop player with a mini player, synchronized desktop lyrics, system media controls and a tray menu. [Platform verification](https://github.com/fnMrRice/MusicFS-client/blob/main/docs/validation/desktop.md) |

This repository pins the components as Git submodules and documents the [architecture](architecture.md) and [implementation status](implementation.md). This project was generated almost entirely by AI. [License (GPLv3)](../LICENSE)
