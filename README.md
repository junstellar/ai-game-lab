# 🚀 AI Game Lab

A growing library of tiny browser games — built **solo, with AI, in public**.
No build step, no framework, no server: each game is self-contained static HTML/CSS/JS you can open anywhere.

**▶ Play: https://junstellar.github.io/games/**

## Games

| | Game | What it is |
|---|------|------------|
| 🎨 | [AI 그림 맞히기 — Guess the AI Picture](https://junstellar.github.io/games/guess-image/) | Look at an AI-drawn picture and guess what it is. 3 tries per question (type → hint → multiple choice), scored, with a daily streak and one-tap emoji sharing. 30 images generated **locally on an RTX GPU** (ComfyUI + SDXL). |

## Add a new game (2 steps)

1. Copy `_template/` to `<game-id>/`.
2. Add one line to [`games.js`](games.js):
   ```js
   { id:"2048", title:"2048", emoji:"🔢", desc:"...", tags:["puzzle"], status:"live", accent:"#4f8cff" }
   ```
That's it — the hub renders the card automatically. `id` must match the folder name.
`status`: `"live"` (playable) or `"wip"` (locked "coming soon" card).

## Structure

| File | Role |
|------|------|
| `index.html` | Hub — reads `games.js` and renders the game cards |
| `games.js`   | **The game list** (edit this to add a game) |
| `shared.css` | Shared dark theme |
| `share.js`   | Shared result sharing — `window.GameShare` (Web Share API / clipboard, Wordle-style emoji grid) |
| `stats.js`   | Shared local stats — `window.GameStats`: cumulative score + daily streak (localStorage, **no accounts**) |
| `_template/` | Copy-paste starter for a new game |
| `<id>/`      | Each game (self-contained) |

### The picture-quiz images

Quiz images live in `guess-image/img/` as WebP. They're generated on a home gaming laptop (RTX 4060) with ComfyUI + SDXL — free and unlimited — then converted to WebP (30 images ≈ 2.2 MB total). If an image is missing, the game shows a "준비중 / coming soon" placeholder and stays playable.

## Why

Inspired by Pieter Levels and the *build-in-public* idea: make something small, novel, and share-baked-in, cheaply, using a local GPU — and publish the process.
Build log (Korean): https://junstellar.github.io/p/ai-game-lab-build-1/

---

Made by [**To the Moon**](https://junstellar.github.io/).
