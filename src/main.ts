import './ui/style.css';
import { Game } from './game/Game';
import { audio } from './game/Audio';

const $ = (id: string) => document.getElementById(id)!;
const canvas = $('game') as HTMLCanvasElement;
const playBtn = $('play-btn') as HTMLButtonElement;
const loading = $('loading');

playBtn.disabled = true;

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function goFullscreen() {
  if (!document.body.classList.contains('is-touch')) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('landscape').catch(() => {});
  } catch {
    /* not supported (iOS Safari) */
  }
}

// Let the loading text paint before the heavy procedural build.
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
    playBtn.disabled = false;
    game.tick();

    const show = (id: string, v: boolean) => $(id).classList.toggle('hidden', !v);

    game.onStateChange = (s, info) => {
      show('menu', s === 'menu');
      show('pause', s === 'paused');
      show('end', s === 'over');
      if (s === 'over' && info) {
        const st = info.stats;
        $('end-title').textContent = info.victory ? 'VICTORY!' : 'YOU GOT PACKED AWAY';
        const acc = st.shots ? Math.min(100, Math.round((st.hits / st.shots) * 100)) : 0;
        $('end-stats').innerHTML =
          `${info.victory ? 'You saved the bedroom!' : `You reached <b>WAVE ${game.waves.wave + 1}</b>`}<br>` +
          `SCORE <b>${st.score}</b> · KILLS <b>${st.kills}</b> · ACCURACY <b>${acc}%</b> · TIME <b>${fmtTime(st.time)}</b>`;
        game.hud.show(false);
      }
    };

    playBtn.addEventListener('click', () => {
      goFullscreen();
      game.start();
    });
    $('restart-btn').addEventListener('click', () => {
      goFullscreen();
      game.start();
    });
    $('restart-btn2').addEventListener('click', () => {
      game.start();
    });
    $('resume-btn').addEventListener('click', () => game.resume());
    $('pause-btn').addEventListener('click', () => game.pause());
    const sens = $('sens') as HTMLInputElement;
    try {
      const saved = localStorage.getItem('tt-sens');
      if (saved) sens.value = saved;
    } catch { /* storage unavailable */ }
    game.input.sensitivity = parseFloat(sens.value);
    sens.addEventListener('input', () => {
      game.input.sensitivity = parseFloat(sens.value);
      try { localStorage.setItem('tt-sens', sens.value); } catch { /* ignore */ }
    });
    // Desktop: clicking the paused canvas resumes
    canvas.addEventListener('click', () => {
      if (game.state === 'paused' && !game.input.isTouch) game.resume();
    });
    window.addEventListener('pointerdown', () => audio.init(), { once: true });
  }, 30),
);
