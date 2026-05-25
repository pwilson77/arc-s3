# Remotion video

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Commands

**Install Dependencies**

```console
npm i
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

**Render on GitHub (outside dev container)**

Use the workflow at `.github/workflows/remotion-render-tech.yml`.

1. Push your latest branch.
2. In GitHub, open **Actions** -> **Render Tech Demo (Remotion)**.
3. Click **Run workflow**.
4. Download the MP4 from the run artifacts (`remotion-TechDemo`).

Required assets for the workflow:

- Voiceover MP3s: either
  - set workflow input `generate_vo=true` and configure repository secrets `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`, or
  - commit `video/public/vo/tech-*.mp3` files.
- Capture frames: either
  - provide workflow inputs `terminal_capture_url` and `ui_capture_url` (public/signed URLs to MP4 files), or
  - commit frame folders under `video/public/captures/terminal-frames` and `video/public/captures/ui-frames`.

This runs the render on a GitHub-hosted Ubuntu runner, which is often more stable than constrained dev containers for long 4K exports.

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).
