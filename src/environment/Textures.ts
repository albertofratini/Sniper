import * as THREE from 'three';

// Procedural canvas textures. Everything is generated at load time so the game
// ships without any image assets.

export function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

function toTex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, r: () => number, base = 128) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, (base === -1 ? d[i] : d[i]) + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Near-white detail map: multiplied with vertex colours. Subtle mottling, scratches, smudges. */
export function plasticDetail(): THREE.Texture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const r = rand(7);
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, S, S);
  // soft mottling
  for (let i = 0; i < 60; i++) {
    const g = ctx.createRadialGradient(r() * S, r() * S, 0, r() * S, r() * S, 20 + r() * 40);
    const v = 225 + r() * 30;
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // scratches
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, a = r() * Math.PI * 2, l = 6 + r() * 30;
    ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(185,185,185,0.2)';
    ctx.lineWidth = 0.6 + r() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + r() * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  noiseFill(ctx, S, S, 10, r);
  return toTex(c, true, true);
}

/** Roughness variation (green channel used by three). */
export function plasticRough(): THREE.Texture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const r = rand(11);
  ctx.fillStyle = 'rgb(110,110,110)';
  ctx.fillRect(0, 0, S, S);
  // fingerprints / smudges = rougher ovals
  for (let i = 0; i < 14; i++) {
    const x = r() * S, y = r() * S;
    for (let k = 0; k < 7; k++) {
      ctx.strokeStyle = `rgba(200,200,200,${0.12 + r() * 0.1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + k * 2.2, 4 + k * 2.8, r(), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 50; i++) {
    ctx.strokeStyle = `rgba(200,200,200,${0.12 + r() * 0.22})`;
    ctx.lineWidth = 0.5 + r();
    const x = r() * S, y = r() * S, a = r() * 6.28, l = 5 + r() * 25;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  noiseFill(ctx, S, S, 30, r);
  return toTex(c, false, true);
}

export function fabricDetail(): THREE.Texture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const r = rand(3);
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.2})`;
    ctx.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    ctx.fillStyle = `rgba(150,150,150,${0.15 + r() * 0.15})`;
    ctx.fillRect(x, 0, 1, S);
  }
  noiseFill(ctx, S, S, 22, r);
  return toTex(c, true, true);
}

export function cardboardDetail(): THREE.Texture {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const r = rand(5);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(120,90,60,${r() * 0.12})`;
    ctx.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
  }
  for (let y = 0; y < S; y += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, y, S, 3);
  }
  noiseFill(ctx, S, S, 14, r);
  return toTex(c, true, true);
}

export function woodFloor(): THREE.Texture {
  const W = 1024, H = 1024;
  const { c, ctx } = canvas(W, H);
  const r = rand(21);
  const planks = 8;
  const ph = H / planks;
  for (let p = 0; p < planks; p++) {
    let x = -r() * 400;
    while (x < W) {
      const len = 380 + r() * 300;
      const hue = 26 + r() * 8;
      const light = 44 + r() * 12;
      ctx.fillStyle = `hsl(${hue}, ${48 + r() * 12}%, ${light}%)`;
      ctx.fillRect(x, p * ph, len, ph);
      // grain
      for (let g = 0; g < 26; g++) {
        const gy = p * ph + r() * ph;
        ctx.strokeStyle = `hsla(${hue - 4}, 50%, ${light - 12 - r() * 10}%, ${0.15 + r() * 0.25})`;
        ctx.lineWidth = 0.6 + r() * 1.6;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        for (let s = 0; s <= 8; s++) {
          ctx.lineTo(x + (len * s) / 8, gy + Math.sin(s * 0.9 + g) * (1 + r() * 3));
        }
        ctx.stroke();
      }
      // knots
      if (r() > 0.6) {
        const kx = x + r() * len, ky = p * ph + ph * (0.3 + r() * 0.4);
        ctx.fillStyle = `hsla(${hue - 6}, 55%, ${light - 20}%, 0.5)`;
        ctx.beginPath();
        ctx.ellipse(kx, ky, 10 + r() * 8, 4 + r() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // seam
      ctx.fillStyle = 'rgba(40,20,10,0.65)';
      ctx.fillRect(x, p * ph, 3, ph);
      x += len;
    }
    ctx.fillStyle = 'rgba(40,20,10,0.7)';
    ctx.fillRect(0, p * ph, W, 3);
    ctx.fillStyle = 'rgba(255,230,200,0.12)';
    ctx.fillRect(0, p * ph + 3, W, 2);
  }
  noiseFill(ctx, W, H, 12, r);
  return toTex(c, true, true);
}

/** Original kid's play-mat: little town with roads, crossings, park, pond. */
export function playMat(): THREE.Texture {
  const S = 1024;
  const { c, ctx } = canvas(S, S);
  const r = rand(99);
  ctx.fillStyle = '#6cc04a';
  ctx.fillRect(0, 0, S, S);
  // grass speckle
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${40 + r() * 40},${120 + r() * 60},${30 + r() * 30},0.5)`;
    ctx.fillRect(r() * S, r() * S, 2, 2);
  }
  // blocks / lots
  const lots: [number, number, number, number, string][] = [
    [60, 60, 300, 260, '#f2d9a6'],
    [640, 70, 310, 240, '#9fd2f2'],
    [80, 640, 260, 300, '#f6b6c8'],
    [660, 660, 280, 270, '#d9c3f2'],
  ];
  for (const [x, y, w, h, col] of lots) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
    // houses
    for (let k = 0; k < 4; k++) {
      const hx = x + 20 + (k % 2) * (w / 2), hy = y + 20 + Math.floor(k / 2) * (h / 2);
      ctx.fillStyle = ['#ff6b5a', '#ffd23f', '#4fb0ff', '#ffffff'][k];
      ctx.fillRect(hx, hy + 30, 90, 70);
      ctx.fillStyle = '#b5452c';
      ctx.beginPath();
      ctx.moveTo(hx - 10, hy + 32);
      ctx.lineTo(hx + 45, hy - 8);
      ctx.lineTo(hx + 100, hy + 32);
      ctx.fill();
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(hx + 36, hy + 62, 18, 38);
    }
  }
  // pond
  ctx.fillStyle = '#4aa8e8';
  ctx.beginPath();
  ctx.ellipse(512, 512, 120, 90, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d7f0ff';
  ctx.lineWidth = 6;
  ctx.stroke();
  // roads (ring + cross)
  const road = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = '#4b4f5c';
    ctx.fillRect(x, y, w, h);
  };
  road(0, 400, S, 90);
  road(0, 540, S, 0);
  road(470, 0, 90, 380);
  road(470, 650, 90, S - 650);
  road(400, 400, 0, 0);
  // ring road around pond
  ctx.strokeStyle = '#4b4f5c';
  ctx.lineWidth = 80;
  ctx.beginPath();
  ctx.arc(512, 512, 200, 0, Math.PI * 2);
  ctx.stroke();
  // lane markings
  ctx.strokeStyle = '#ffe680';
  ctx.lineWidth = 6;
  ctx.setLineDash([26, 22]);
  ctx.beginPath();
  ctx.moveTo(0, 445);
  ctx.lineTo(S, 445);
  ctx.moveTo(515, 0);
  ctx.lineTo(515, 380);
  ctx.moveTo(515, 650);
  ctx.lineTo(515, S);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(512, 512, 200, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // crossings
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) ctx.fillRect(240 + i * 16, 404, 9, 82);
  for (let i = 0; i < 6; i++) ctx.fillRect(740 + i * 16, 404, 9, 82);
  // trees
  for (let i = 0; i < 60; i++) {
    const x = r() * S, y = r() * S;
    if (Math.abs(y - 445) < 70 || Math.abs(x - 515) < 70) continue;
    ctx.fillStyle = '#2f8a3a';
    ctx.beginPath();
    ctx.arc(x, y, 10 + r() * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(x - 3, y - 3, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // stitched border
  ctx.strokeStyle = '#ff6b5a';
  ctx.lineWidth = 28;
  ctx.strokeRect(14, 14, S - 28, S - 28);
  ctx.strokeStyle = '#fff6';
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.strokeRect(30, 30, S - 60, S - 60);
  ctx.setLineDash([]);
  // fabric weave
  for (let y = 0; y < S; y += 3) {
    ctx.fillStyle = 'rgba(0,0,0,0.035)';
    ctx.fillRect(0, y, S, 1);
  }
  noiseFill(ctx, S, S, 16, r);
  return toTex(c, true);
}

export function wallpaper(): THREE.Texture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const r = rand(44);
  ctx.fillStyle = '#d9e6f2';
  ctx.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 64) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x, 0, 30, S);
  }
  // little stars and rockets motif
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 128 + 47, y = Math.floor(i / 4) * 128 + 64 + (i % 2) * 40;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,190,70,0.55)' : 'rgba(120,160,220,0.45)';
    star(ctx, x, y, 10, 5);
  }
  noiseFill(ctx, S, S, 8, r);
  return toTex(c, true, true);
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function quilt(): THREE.Texture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const r = rand(8);
  const cols = ['#ff8a7a', '#ffd166', '#7fd1c7', '#a3b8ff', '#ffb3d1', '#9be37a'];
  const n = 8, sz = S / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = cols[(x * 3 + y * 5) % cols.length];
      ctx.fillRect(x * sz, y * sz, sz, sz);
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        star(ctx, x * sz + sz / 2, y * sz + sz / 2, sz * 0.3, sz * 0.13);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let d = 0; d < 9; d++) {
          ctx.beginPath();
          ctx.arc(x * sz + 10 + (d % 3) * 22, y * sz + 10 + Math.floor(d / 3) * 22, 4, 0, 6.3);
          ctx.fill();
        }
      }
    }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * sz, 0);
    ctx.lineTo(i * sz, S);
    ctx.moveTo(0, i * sz);
    ctx.lineTo(S, i * sz);
    ctx.stroke();
  }
  for (let y = 0; y < S; y += 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, y, S, 1);
  }
  noiseFill(ctx, S, S, 18, r);
  return toTex(c, true, true);
}

/** Kid's crayon drawing pinned to the wall. */
export function drawing(kind: number): THREE.Texture {
  const W = 512, H = 384;
  const { c, ctx } = canvas(W, H);
  const r = rand(100 + kind);
  ctx.fillStyle = '#fbf8ef';
  ctx.fillRect(0, 0, W, H);
  const crayon = (col: string, w = 7) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  const wobble = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + r() * 4, y + r() * 4) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  // ground
  crayon('#4caf50', 10);
  wobble([[10, 330], [120, 325], [250, 335], [380, 322], [500, 330]]);
  // sun
  crayon('#ffb300', 8);
  ctx.beginPath();
  ctx.arc(420, 70, 38, 0, 6.3);
  ctx.stroke();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * 6.28;
    wobble([[420 + Math.cos(a) * 50, 70 + Math.sin(a) * 50], [420 + Math.cos(a) * 75, 70 + Math.sin(a) * 75]]);
  }
  if (kind % 3 === 0) {
    // house + family of toy soldiers
    crayon('#e53935');
    wobble([[80, 320], [80, 190], [220, 190], [220, 320]]);
    wobble([[65, 195], [150, 120], [235, 195]]);
    crayon('#1e88e5', 6);
    wobble([[130, 320], [130, 260], [170, 260], [170, 320]]);
    crayon('#2e7d32', 6);
    for (let k = 0; k < 3; k++) {
      const x = 280 + k * 60;
      ctx.beginPath();
      ctx.arc(x, 230, 14, 0, 6.3);
      ctx.stroke();
      wobble([[x, 244], [x, 295], [x - 18, 322]]);
      wobble([[x, 295], [x + 18, 322]]);
      wobble([[x - 22, 262], [x + 22, 262]]);
    }
  } else if (kind % 3 === 1) {
    // big robot vs tiny hero
    crayon('#757575');
    wobble([[260, 320], [260, 150], [400, 150], [400, 320]]);
    wobble([[290, 150], [290, 100], [370, 100], [370, 150]]);
    crayon('#f44336', 6);
    ctx.beginPath();
    ctx.arc(312, 125, 8, 0, 6.3);
    ctx.arc(348, 125, 8, 0, 6.3);
    ctx.stroke();
    crayon('#2e7d32', 6);
    ctx.beginPath();
    ctx.arc(120, 260, 12, 0, 6.3);
    ctx.stroke();
    wobble([[120, 272], [120, 300], [104, 322]]);
    wobble([[120, 300], [136, 322]]);
    crayon('#ffb300', 4);
    wobble([[135, 280], [250, 230]]);
    ctx.fillStyle = '#e91e63';
    ctx.font = 'bold 34px Comic Sans MS, cursive';
    ctx.fillText('ME!', 90, 220);
  } else {
    // dinosaur + rainbow
    const rb = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
    rb.forEach((col, i) => {
      crayon(col, 9);
      ctx.beginPath();
      ctx.arc(250, 330, 220 - i * 12, Math.PI, Math.PI * 2);
      ctx.stroke();
    });
    crayon('#7cb342', 8);
    wobble([[120, 320], [130, 260], [200, 240], [260, 250], [300, 200], [330, 210], [320, 260], [290, 280], [280, 320]]);
    wobble([[160, 320], [160, 290]]);
    wobble([[240, 320], [240, 290]]);
  }
  ctx.fillStyle = '#1565c0';
  ctx.font = 'bold 26px Comic Sans MS, cursive';
  ctx.fillText(['by MAX age 6', 'MY ROBOT', 'DINO DAY'][kind % 3], 20, 40);
  // tape
  ctx.fillStyle = 'rgba(255,240,180,0.7)';
  ctx.fillRect(W / 2 - 40, 0, 80, 22);
  noiseFill(ctx, W, H, 10, r);
  return toTex(c, true);
}

export function bookCover(seed: number, title: string, base: string): THREE.Texture {
  const W = 256, H = 64;
  const { c, ctx } = canvas(W, H);
  const r = rand(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 6, W, 4);
  ctx.fillRect(0, H - 10, W, 4);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, W / 2, H / 2 + 1);
  noiseFill(ctx, W, H, 14, r);
  return toTex(c, true);
}

export function cerealBox(): THREE.Texture {
  const W = 512, H = 768;
  const { c, ctx } = canvas(W, H);
  const r = rand(77);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ff5b3a');
  g.addColorStop(1, '#ffb030');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // sunburst
  ctx.save();
  ctx.translate(W / 2, H * 0.55);
  for (let i = 0; i < 24; i++) {
    ctx.rotate(Math.PI / 12);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(255,230,120,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-60, -600);
    ctx.lineTo(60, -600);
    ctx.fill();
  }
  ctx.restore();
  // bowl
  ctx.fillStyle = '#3f8ff0';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.68, 190, 120, 0, 0, Math.PI);
  ctx.fill();
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = ['#ffe36b', '#ff7ab8', '#8be06b', '#7fd4ff'][i % 4];
    star(ctx, W / 2 - 170 + r() * 340, H * 0.66 - r() * 70, 18, 8);
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#7a1c0c';
  ctx.lineWidth = 10;
  ctx.textAlign = 'center';
  ctx.font = 'bold 110px Arial Black, Impact, sans-serif';
  ctx.strokeText('STAR', W / 2, 150);
  ctx.fillText('STAR', W / 2, 150);
  ctx.font = 'bold 120px Arial Black, Impact, sans-serif';
  ctx.strokeText('PUFFS', W / 2, 270);
  ctx.fillText('PUFFS', W / 2, 270);
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillStyle = '#7a1c0c';
  ctx.fillText('NOW WITH 20% MORE CRUNCH!', W / 2, 330);
  ctx.fillStyle = '#ffe36b';
  ctx.beginPath();
  ctx.arc(420, 420, 60, 0, 6.3);
  ctx.fill();
  ctx.fillStyle = '#c0391b';
  ctx.font = 'bold 26px Arial Black, sans-serif';
  ctx.fillText('FREE', 420, 415);
  ctx.fillText('TOY!', 420, 445);
  noiseFill(ctx, W, H, 10, r);
  return toTex(c, true);
}

export function boardGame(): THREE.Texture {
  const S = 512;
  const { c, ctx } = canvas(S, S);
  const r = rand(55);
  ctx.fillStyle = '#2d6cdf';
  ctx.fillRect(0, 0, S, S);
  const cols = ['#ff4d3d', '#ffcf33', '#7bd35a', '#ffffff'];
  // spiral track of squares
  const n = 9, sz = S / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || (y === 4 && x > 1 && x < 7)) {
        ctx.fillStyle = cols[(x + y) % 4];
        ctx.fillRect(x * sz + 3, y * sz + 3, sz - 6, sz - 6);
      }
    }
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 54px Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ROCKET', S / 2, 190);
  ctx.fillText('RACE', S / 2, 360);
  noiseFill(ctx, S, S, 12, r);
  return toTex(c, true);
}

export function letterTex(letter: string, bg: string, fg: string): THREE.Texture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const r = rand(letter.charCodeAt(0));
  ctx.fillStyle = '#f3e3c3';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = bg;
  ctx.fillRect(10, 10, S - 20, S - 20);
  ctx.fillStyle = fg;
  ctx.font = 'bold 86px Arial Black, Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, S / 2, S / 2 + 4);
  noiseFill(ctx, S, S, 16, r);
  return toTex(c, true);
}

export function sky(): THREE.Texture {
  const W = 256, H = 256;
  const { c, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#7fb8ff');
  g.addColorStop(0.55, '#cfe6ff');
  g.addColorStop(0.8, '#fff1d0');
  g.addColorStop(1, '#a8d68a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = rand(1);
  for (let i = 0; i < 6; i++) {
    const x = r() * W, y = 30 + r() * 90;
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(x + k * 12, y + Math.sin(k) * 4, 12 + r() * 8, 0, 6.3);
      ctx.fill();
    }
  }
  // tree silhouettes
  ctx.fillStyle = '#5c9a4a';
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.arc(i * 30, H - 30 + Math.sin(i) * 8, 30, 0, 6.3);
    ctx.fill();
  }
  return toTex(c, true);
}

/** Soft radial blob used for contact shadows. */
export function blobTex(): THREE.Texture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTex(c, false);
}

/** Vertical gradient used for god-ray shafts. */
export function shaftTex(): THREE.Texture {
  const W = 64, H = 256;
  const { c, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createLinearGradient(0, 0, W, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)');
  g2.addColorStop(0.25, 'rgba(0,0,0,0)');
  g2.addColorStop(0.75, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  return toTex(c, true);
}

export function dotTex(): THREE.Texture {
  const S = 64;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,240,200,0.6)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTex(c, true);
}

/** Sticker decal, e.g. a star or lightning bolt on toys/weapons. */
export function stickerTex(kind: 'star' | 'bolt' | 'smile' | 'number', label = '7'): THREE.Texture {
  const S = 128;
  const { c, ctx } = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 4, 0, 6.3);
  ctx.fill();
  if (kind === 'star') {
    ctx.fillStyle = '#ffcf33';
    star(ctx, S / 2, S / 2, 50, 22);
  } else if (kind === 'bolt') {
    ctx.fillStyle = '#ff4d3d';
    ctx.beginPath();
    ctx.moveTo(70, 10);
    ctx.lineTo(30, 70);
    ctx.lineTo(60, 70);
    ctx.lineTo(50, 118);
    ctx.lineTo(98, 52);
    ctx.lineTo(66, 52);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'smile') {
    ctx.fillStyle = '#ffcf33';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 50, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(46, 52, 7, 0, 6.3);
    ctx.arc(82, 52, 7, 0, 6.3);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(S / 2, 64, 30, 0.3, Math.PI - 0.3);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#3fa9ff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 52, 0, 6.3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, S / 2, S / 2 + 4);
  }
  return toTex(c, true);
}
