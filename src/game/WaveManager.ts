import { EnemyType } from './Enemies';

interface Group { type: EnemyType; count: number; hard?: boolean; delay?: number; burst?: number }
interface WaveDef { title: string; sub: string; groups: Group[]; maxAlive: number; interval: number }

export const WAVES: WaveDef[] = [
  { title: 'WAVE 1', sub: 'The Red Brigade marches in', maxAlive: 7, interval: 1.2, groups: [{ type: 'trooper', count: 10 }] },
  { title: 'WAVE 2', sub: 'Something is skittering…', maxAlive: 14, interval: 1.0, groups: [{ type: 'trooper', count: 8 }, { type: 'bug', count: 18, burst: 6, delay: 3 }] },
  { title: 'WAVE 3', sub: 'Clank Bots are wound up', maxAlive: 12, interval: 1.1, groups: [{ type: 'trooper', count: 10, hard: true }, { type: 'robot', count: 3, delay: 4 }] },
  { title: 'WAVE 4', sub: 'Chompers smell plastic', maxAlive: 14, interval: 1.0, groups: [{ type: 'chomper', count: 8 }, { type: 'robot', count: 3, delay: 6 }, { type: 'bug', count: 6, burst: 6, delay: 12 }] },
  { title: 'FINAL WAVE', sub: 'ALL HAIL THE WIND-UP KING', maxAlive: 10, interval: 2.2, groups: [{ type: 'boss', count: 1 }, { type: 'trooper', count: 6, hard: true, delay: 6 }, { type: 'chomper', count: 4, delay: 14 }] },
];

interface Pending { type: EnemyType; hard: boolean; at: number }

export class WaveManager {
  wave = 0; // 0-based
  state: 'intro' | 'fighting' | 'cleared' | 'done' = 'intro';
  timer = 0;
  private queue: Pending[] = [];
  private spawnTimer = 0;
  total = 0;
  killed = 0;
  extraSpawned = 0;

  constructor(
    private spawnFn: (type: EnemyType, hard: boolean) => void,
    private aliveCount: () => number,
    private events: { waveStart(i: number): void; waveCleared(i: number): void; victory(): void },
  ) {}

  start() {
    this.wave = 0;
    this.begin(0);
  }

  private begin(i: number) {
    this.wave = i;
    this.state = 'intro';
    this.timer = 2.6;
    const def = WAVES[i];
    this.queue = [];
    this.total = 0;
    this.killed = 0;
    this.extraSpawned = 0;
    for (const g of def.groups) {
      const burst = g.burst ?? 1;
      for (let k = 0; k < g.count; k++) {
        const at = (g.delay ?? 0) + Math.floor(k / burst) * (burst > 1 ? 5 : 0);
        this.queue.push({ type: g.type, hard: !!g.hard, at });
      }
      this.total += g.count;
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.events.waveStart(i);
  }

  get remaining() {
    return Math.max(0, this.total + this.extraSpawned - this.killed);
  }

  onKill() {
    this.killed++;
  }

  onExtraSpawn() {
    this.extraSpawned++;
  }

  private fightTime = 0;
  update(dt: number) {
    this.timer -= dt;
    if (this.state === 'intro') {
      if (this.timer <= 0) {
        this.state = 'fighting';
        this.fightTime = 0;
        this.spawnTimer = 0;
      }
      return;
    }
    if (this.state === 'fighting') {
      this.fightTime += dt;
      this.spawnTimer -= dt;
      const def = WAVES[this.wave];
      if (this.queue.length && this.spawnTimer <= 0 && this.aliveCount() < def.maxAlive && this.queue[0].at <= this.fightTime) {
        const next = this.queue[0];
        // burst groups spawn together
        const sameAt = this.queue.filter((q) => q.at === next.at && q.type === next.type && q.type === 'bug');
        if (sameAt.length > 1) {
          for (const q of sameAt) {
            this.spawnFn(q.type, q.hard);
            this.queue.splice(this.queue.indexOf(q), 1);
          }
        } else {
          this.spawnFn(next.type, next.hard);
          this.queue.shift();
        }
        this.spawnTimer = def.interval * (0.6 + Math.random() * 0.8);
      }
      if (!this.queue.length && this.aliveCount() === 0) {
        if (this.wave >= WAVES.length - 1) {
          this.state = 'done';
          this.events.victory();
        } else {
          this.state = 'cleared';
          this.timer = 4;
          this.events.waveCleared(this.wave);
        }
      }
      return;
    }
    if (this.state === 'cleared' && this.timer <= 0) this.begin(this.wave + 1);
  }
}
