import './ui/style.css';
import { Game } from './game/Game';
import { audio } from './game/Audio';
import { Session } from './net/Session';
import { randomRoomCode } from './net/Net';
import { BotManager, Difficulty } from './bots/BotManager';
import { HiddenBots } from './modes/hidden/HiddenBots';
import { MODES, ModeId, TEAM_NAMES } from './game/Modes';

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('game') as HTMLCanvasElement;
const playBtn = $('play-btn') as HTMLButtonElement;
const friendsBtn = $('friends-btn') as HTMLButtonElement;
const botsBtn = $('bots-btn') as HTMLButtonElement;
const loading = $('loading');

playBtn.disabled = friendsBtn.disabled = botsBtn.disabled = true;

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function canFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

function goFullscreen(force = false) {
  if (!force && !document.body.classList.contains('is-touch')) return;
  if (document.fullscreenElement) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  } catch {
    /* not supported (iPhone Safari) */
  }
}

function defaultName() {
  const saved = store.get('tt-name');
  if (saved) return saved;
  const a = ['Private', 'Sgt', 'Corporal', 'Captain', 'Major'];
  const b = ['Pip', 'Bolt', 'Sprocket', 'Crayon', 'Biscuit', 'Marble', 'Domino', 'Rocket'];
  return `${a[Math.floor(Math.random() * a.length)]} ${b[Math.floor(Math.random() * b.length)]}`;
}

requestAnimationFrame(() =>
  setTimeout(() => {
    let game: Game;
    try {
      game = new Game(canvas);
    } catch (err) {
      console.error(err);
      loading.textContent = 'Could not start WebGL on this device 😢';
      return;
    }
    loading.textContent = '';
    playBtn.disabled = friendsBtn.disabled = botsBtn.disabled = false;
    game.tick();

    const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);
    const screens = ['menu', 'pause', 'end', 'lobby', 'mp-end', 'bots'];
    const only = (id: string | null) => screens.forEach((s) => show(s, s === id));

    if (!canFullscreen() && isIOS && !standalone) show('ios-hint', true);
    if (!canFullscreen() || standalone) show('fs-btn', false);
    $('fs-btn').addEventListener('click', () => goFullscreen(true));

    // ------------------------------------------------------------ session / lobby
    let session: Session | null = null;
    const nameInput = $('player-name') as HTMLInputElement;
    nameInput.value = defaultName();

    const roomUrl = (code: string) => `${location.origin}${location.pathname}?room=${code}${new URLSearchParams(location.search).get('net') === 'local' ? '&net=local' : ''}`;

    function openRoom(code: string) {
      if (!session || session.room !== code) {
        session?.leave();
        session = new Session(code, game, nameInput.value);
        session.onChange = renderLobby;
        session.onEnd = () => {
          const info = session!.endInfo!;
          $('mp-end-title').textContent = info.title;
          $('mp-end-lines').innerHTML = info.lines.map((l) => `<div>${l.replace(/[&<>]/g, '')}</div>`).join('');
          only('mp-end');
        };
        history.replaceState(null, '', roomUrl(code));
      }
      $('room-code').textContent = code;
      ($('room-link') as HTMLInputElement).value = roomUrl(code);
      only('lobby');
      renderLobby();
    }

    function renderLobby() {
      if (!session) return;
      const s = session;
      // mode buttons
      const ml = $('mode-list');
      if (!ml.childElementCount) {
        for (const m of Object.values(MODES)) {
          const b = document.createElement('button');
          b.className = 'mode-btn';
          b.dataset.mode = m.id;
          b.innerHTML = `<b>${m.name}</b><span>${m.blurb}</span>`;
          b.addEventListener('click', () => session?.setMode(m.id as ModeId));
          ml.appendChild(b);
        }
      }
      ml.querySelectorAll<HTMLElement>('.mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
      show('team-size', s.mode === 'tdm');
      $('team-size').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === s.teamSize));
      // players
      const pl = $('player-list');
      pl.innerHTML = '';
      for (const p of s.all) {
        const row = document.createElement('div');
        row.className = 'pl-row';
        const color = '#' + s.colorOf(p).toString(16).padStart(6, '0');
        const nm = p.name.replace(/[&<>]/g, '');
        row.innerHTML = `<span class="pl-dot" style="background:${color}"></span>${nm}${p === s.self ? ' (you)' : ''}<small>${p.inMatch ? 'IN MATCH' : 'READY'}</small>`;
        pl.appendChild(row);
      }
      const n = s.playerCount;
      const max = s.mode === 'tdm' ? s.teamSize * 2 : 8;
      const inMatch = s.all.some((p) => p.inMatch);
      $('lobby-status').textContent = inMatch
        ? 'A match is running: press START to jump in'
        : n < 2
          ? 'Waiting for friends… share the link (need 2+ players)'
          : `${n} players ready${n > max ? ` (mode suits ${max})` : ''} — anyone can press START`;
      const start = $('start-match') as HTMLButtonElement;
      start.disabled = n < 2;
      start.textContent = inMatch ? 'JOIN MATCH' : 'START';
    }

    $('team-size').querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => session?.setMode('tdm', Number(b.dataset.size))),
    );
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim().slice(0, 14) || 'Trooper';
      nameInput.value = v;
      store.set('tt-name', v);
      session?.setName(v);
    });
    $('copy-link').addEventListener('click', () => {
      const inp = $('room-link') as HTMLInputElement;
      const done = () => game.hud.toast('Link copied!');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(inp.value).then(done, () => { inp.select(); document.execCommand('copy'); done(); });
      else { inp.select(); document.execCommand('copy'); done(); }
    });
    $('share-link').addEventListener('click', () => {
      const url = ($('room-link') as HTMLInputElement).value;
      if (navigator.share) navigator.share({ title: 'Toy Troopers', text: 'Join my Toy Troopers room!', url }).catch(() => {});
      else $('copy-link').click();
    });
    $('start-match').addEventListener('click', () => {
      if (!session) return;
      audio.init();
      goFullscreen();
      if (session.all.some((p) => p.inMatch)) {
        // ask a player in the match to send us the match state
        session.t.send('info', { name: session.self.name, joined: session.self.joined, inMatch: false, mode: session.mode, size: session.teamSize, ts: 0 });
        game.hud.toast('Joining match…');
        // peers in a match send 'start' when they see us join; nudge by re-announcing
        for (const p of session.peers.values()) if (p.inMatch) session.t.send('want', {}, p.id);
        return;
      }
      session.startMatch();
    });
    $('solo-wait').addEventListener('click', () => {
      goFullscreen();
      only(null);
      game.start();
    });
    $('leave-room').addEventListener('click', () => {
      session?.leave();
      session = null;
      history.replaceState(null, '', location.pathname + (new URLSearchParams(location.search).get('net') === 'local' ? '?net=local' : ''));
      only('menu');
    });

    // friend joins while you play solo / sit in a menu
    game.onPeerJoinedWhileSolo = (name) => {
      if (!session || session.self.inMatch) return;
      if (!$('lobby').classList.contains('hidden')) return;
      $('join-toast-text').textContent = `${name} joined your room!`;
      show('join-toast', true);
      setTimeout(() => show('join-toast', false), 12000);
    };
    $('join-toast-btn').addEventListener('click', () => {
      show('join-toast', false);
      if (game.state === 'playing' || game.state === 'paused' || game.state === 'over' || game.state === 'dying') game.quitToMenu();
      if (document.pointerLockElement) document.exitPointerLock();
      if (session) openRoom(session.room);
    });

    // ------------------------------------------------------------ matches against bots (offline room)
    let botSession: Session | null = null;
    const botCfg = { mode: (store.get('tt-bot-mode') as ModeId) || 'ffa', size: 5, diff: (store.get('tt-bot-diff') as Difficulty) || 'normal' };
    const sizeOpts: Record<string, [number, string][]> = {
      duel: [[1, '1 BOT']],
      ffa: [[3, '3 BOTS'], [5, '5 BOTS'], [7, '7 BOTS']],
      tdm: [[2, '2 V 2'], [3, '3 V 3'], [4, '4 V 4']],
      hidden: [[3, '3 BOTS'], [5, '5 BOTS'], [7, '7 BOTS']],
    };
    function renderBots() {
      $('bot-modes').querySelectorAll<HTMLElement>('.mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === botCfg.mode));
      const opts = sizeOpts[botCfg.mode] ?? sizeOpts.ffa;
      if (!opts.some(([n]) => n === botCfg.size)) botCfg.size = opts[Math.min(1, opts.length - 1)][0];
      $('bot-size-label').textContent = botCfg.mode === 'tdm' ? 'TEAMS' : 'OPPONENTS';
      const box = $('bot-size');
      box.innerHTML = '';
      for (const [n, label] of opts) {
        const b = document.createElement('button');
        b.className = 'chip-btn' + (n === botCfg.size ? ' on' : '');
        b.textContent = label;
        b.addEventListener('click', () => { botCfg.size = n; renderBots(); });
        box.appendChild(b);
      }
      $('bot-diff').querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.diff === botCfg.diff));
    }
    $('bot-modes').querySelectorAll<HTMLElement>('.mode-btn').forEach((b) =>
      b.addEventListener('click', () => { botCfg.mode = b.dataset.mode as ModeId; store.set('tt-bot-mode', botCfg.mode); renderBots(); }),
    );
    $('bot-diff').querySelectorAll<HTMLElement>('button').forEach((b) =>
      b.addEventListener('click', () => { botCfg.diff = b.dataset.diff as Difficulty; store.set('tt-bot-diff', botCfg.diff); renderBots(); }),
    );
    botsBtn.addEventListener('click', () => { audio.init(); renderBots(); only('bots'); });
    $('bots-back').addEventListener('click', () => only('menu'));
    function startBotMatch() {
      botSession?.leave();
      const s = new Session('BOTS-' + randomRoomCode(), game, nameInput.value);
      const count = botCfg.mode === 'tdm' ? botCfg.size * 2 - 1 : botCfg.size;
      s.setMode(botCfg.mode, botCfg.mode === 'tdm' ? botCfg.size : 2);
      s.bots = botCfg.mode === 'hidden' ? new HiddenBots(game, s, count, botCfg.diff) : new BotManager(game, s, count, botCfg.diff);
      s.onEnd = () => {
        const info = s.endInfo!;
        $('mp-end-title').textContent = info.title;
        $('mp-end-lines').innerHTML = info.lines.map((l) => `<div>${l.replace(/[&<>]/g, '')}</div>`).join('');
        only('mp-end');
      };
      botSession = s;
      goFullscreen();
      s.startMatch();
    }
    $('bots-start').addEventListener('click', startBotMatch);
    (window as unknown as { __startBots: (m: ModeId, n: number, d: Difficulty) => void }).__startBots = (m, n, d) => {
      botCfg.mode = m; botCfg.size = n; botCfg.diff = d; startBotMatch();
    };

    // ------------------------------------------------------------ game state → screens
    game.onStateChange = (s, info) => {
      show('join-toast', false);
      if (s === 'playing') only(null);
      else if (s === 'paused') {
        only('pause');
        $('restart-btn2').classList.toggle('hidden', game.inMatch);
        $('quit-btn').textContent = game.inMatch ? 'LEAVE MATCH' : 'QUIT TO MENU';
      } else if (s === 'menu') {
        game.hud.show(false);
        if (botSession) {
          // a bot match ended (or you left it): back to the main menu
          const bs = botSession;
          botSession = null;
          bs.leave();
          only('menu');
        } else if (session) openRoom(session.room);
        else only('menu');
      } else if (s === 'over' && info) {
        only('end');
        const st = info.stats;
        $('end-title').textContent = info.victory ? 'VICTORY!' : 'YOU GOT PACKED AWAY';
        const acc = st.shots ? Math.min(100, Math.round((st.hits / st.shots) * 100)) : 0;
        $('end-stats').innerHTML =
          `${info.victory ? 'You saved the bedroom!' : `You reached <b>WAVE ${game.waves.wave + 1}</b>`}<br>` +
          `SCORE <b>${st.score}</b> · KILLS <b>${st.kills}</b> · ACCURACY <b>${acc}%</b> · TIME <b>${fmtTime(st.time)}</b>`;
        game.hud.show(false);
        $('restart-btn').textContent = session ? 'BACK TO ROOM' : 'PLAY AGAIN';
      } else if (s === 'mpover') {
        // results screen is shown by session.onEnd
      }
    };

    playBtn.addEventListener('click', () => {
      goFullscreen();
      game.start();
    });
    friendsBtn.addEventListener('click', () => {
      audio.init();
      openRoom(new URLSearchParams(location.search).get('room')?.toUpperCase() || randomRoomCode());
    });
    $('restart-btn').addEventListener('click', () => {
      if (session) {
        game.quitToMenu();
        return;
      }
      goFullscreen();
      game.start();
    });
    $('restart-btn2').addEventListener('click', () => game.start());
    $('resume-btn').addEventListener('click', () => game.resume());
    $('quit-btn').addEventListener('click', () => game.quitToMenu());
    $('pause-btn').addEventListener('click', () => game.pause());
    const sens = $('sens') as HTMLInputElement;
    const saved = store.get('tt-sens');
    if (saved) sens.value = saved;
    game.input.sensitivity = parseFloat(sens.value);
    sens.addEventListener('input', () => {
      game.input.sensitivity = parseFloat(sens.value);
      store.set('tt-sens', sens.value);
    });
    canvas.addEventListener('click', () => {
      if (game.state === 'paused' && !game.input.isTouch) game.resume();
    });
    window.addEventListener('pointerdown', () => audio.init(), { once: true });

    // opened an invite link → go straight to the room
    const invited = new URLSearchParams(location.search).get('room');
    if (invited) {
      $('invite-code').textContent = invited.toUpperCase();
      show('invite', true);
      friendsBtn.textContent = 'JOIN ROOM';
      openRoom(invited.toUpperCase());
    }
    void TEAM_NAMES;
    (window as unknown as { __session: () => Session | null }).__session = () => session;
  }, 30),
);
