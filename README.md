# Toy Troopers — Survive the Bedroom

A mobile-first, first-person toy shooter that runs in the browser. You play a tiny plastic soldier holding off waves of hostile toys in a giant kid's bedroom, alone or against friends.

Built with TypeScript, Vite and Three.js. There is no game server, and no image or audio files: every texture, model and sound is generated in code.

## Multiplayer

Tap **PLAY WITH FRIENDS** to create a room, then share the link. Anyone with the link joins the same room, and anyone in the room can press **START** once two or more players are in. The creator doesn't have to wait in the lobby: they can close the page or play solo, and they'll get a prompt when a friend arrives. Players who open the link mid-match drop straight in.

Modes: **Free for All** (first to 20), **Gun Game** (new gun every knockout, 15 to win), **Snipers Only** (snipers and flash cubes, first to 15), **Team Battle** (2v2 or 3v3, first team to 30) and **Co-op Survival** (the 5 waves together).

Players connect peer-to-peer over WebRTC using [Trystero](https://github.com/dmotz/trystero). Public Nostr relays are used only for the initial handshake. Co-op enemies are simulated by one player and mirrored to the others, and that job moves to someone else automatically if they leave. Because there's no relay (TURN) server, a few strict mobile-carrier networks may fail to connect; switching to Wi-Fi usually fixes it. For local testing, add `?net=local` to the URL to connect browser tabs on the same device without the internet.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build      # production build -> dist/
npm run preview    # serve the production build
```

## Deploy

**Vercel:** run `npx vercel --prod` in this folder, or import the GitHub repo at vercel.com/new. `vercel.json` is already set up (Vite, `npm run build`, output `dist`).

**Netlify:** `npx netlify deploy --prod --dir=dist` after `npm run build`. `netlify.toml` is included.

`npm run build:single` produces a self-contained `dist-single/index.html` that you can host anywhere.

## Controls

| Action | Phone (landscape) | Desktop |
| --- | --- | --- |
| Move | Left thumb, floating joystick (push to the edge to sprint) | WASD / arrow keys, Shift to sprint |
| Look | Drag on the right half (you can also drag while holding FIRE) | Mouse (click to lock the pointer) |
| Fire | FIRE | Left click |
| Sniper scope | hold SCOPE, release to shoot (FIRE still shoots without scoping) | hold right click |
| Grenade / flash cube | 💣 / ✨ buttons | G / T |
| Jump | JUMP | Space |
| Reload | R | R |
| Melee bash | BASH | F (or middle click) |
| Switch weapon | SWAP | 1–5, Q, mouse wheel |
| Crouch | DUCK (toggle) | C / Ctrl |
| Pause | II button | Esc |

URL flags: `?touch` forces touch controls, `?low` forces the phone renderer, and `?high` forces the desktop one.

Fullscreen: Android and desktop get a FULLSCREEN button. iPhone Safari doesn't allow web pages to go fullscreen, so on iPhone tap Share → Add to Home Screen and launch the game from the home screen icon. It then runs fullscreen in landscape.

## Code layout

```
src/
  main.ts                 UI wiring (menus, pause, end screen)
  game/
    Game.ts               renderer, lights, post-fx, game loop, combat resolution, states
    Player.ts             movement controller and camera feel (bob, recoil, landing, shake)
    Weapons.ts            weapon definitions, toy viewmodels and arms, firing and reloads
    Enemies.ts            Trooper, Clank Bot, Chomper, Wind-up Bug, Wind-Up King boss, debris
    WaveManager.ts        5-wave progression
    Modes.ts              multiplayer modes and the Gun Game ladder
    Projectiles.ts        foam rockets, darts, energy bolts, bombs
    Effects.ts            instanced fragments, glows, puffs, tracers, decals
    Props.ts              physics toys (dice, pawns, balls, marbles) and pickups
    Collision.ts          AABB world, character controller, raycasts, flow-field navigation
    Input.ts / MobileControls.ts
    Audio.ts              Web Audio synthesized SFX
  environment/
    Bedroom.ts            the level, authored in centimetres (1 unit = 1.6 cm)
    Builder.ts            static mesh batching (vertex colours + baked contact AO)
    Materials.ts / Textures.ts   procedural toy materials and canvas textures
  net/
    Net.ts                WebRTC (Trystero) and same-browser transports
    Session.ts            rooms, lobby, match rules, scoring, co-op enemy sync
    RemotePlayers.ts      other players' toy soldiers
  ui/HUD.ts, ui/style.css
```

## Notes

- Static geometry is merged per material, so the whole room costs only a few dozen draw calls. The sun's shadow map is rendered once, and moving things use blob shadows instead.
- The game always renders at the screen's native sharpness (up to 2× pixel density) and never lowers resolution on the fly. To stay fast on phones, it skips bloom and the extra fill lights there and uses a smaller static shadow map. Touch players also get light aim assist, which is weaker against real players.
- `window.__game` is exposed for automated tests (`debugStep`, `debugKillAll`, `debugSkipToWave`).
