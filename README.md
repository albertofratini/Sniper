# Toy Troopers — Survive the Bedroom

A mobile-first, first-person toy shooter that runs in the browser. You play a tiny plastic soldier holding off waves of hostile toys in a giant kid's bedroom.

Built with TypeScript, Vite and Three.js. There is no backend, and no image or audio files: every texture, model and sound is generated in code.

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
| Jump | JUMP | Space |
| Reload | R | R |
| Melee bash | BASH | F (or right click) |
| Switch weapon | SWAP | 1 / 2 / 3, Q, mouse wheel |
| Crouch | DUCK (toggle) | C / Ctrl |
| Pause | II button | Esc |

URL flags: `?touch` forces touch controls, `?low` forces the low-end renderer, and `?high` forces the high-end one.

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
  ui/HUD.ts, ui/style.css
```

## Notes

- Static geometry is merged per material, so the whole room costs only a few dozen draw calls. The sun's shadow map is rendered once, and moving things use blob shadows instead.
- On touch devices the game drops antialiasing and bloom, uses a smaller shadow map, scales resolution with frame rate, and adds light aim assist.
- `window.__game` is exposed for automated tests (`debugStep`, `debugKillAll`, `debugSkipToWave`).
