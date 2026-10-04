/* Peer-to-peer transports. No game server: players connect directly over WebRTC.
 * Trystero uses public Nostr relays only to exchange connection offers (signaling). */

export type Handler = (data: any, from: string) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Transport {
  readonly selfId: string;
  send(type: string, data: unknown, to?: string): void;
  on(type: string, cb: Handler): void;
  onJoin(cb: (id: string) => void): void;
  onLeave(cb: (id: string) => void): void;
  leave(): void;
  whenReady(cb: () => void): void;
}

interface Envelope { t: string; d: unknown }

abstract class Base implements Transport {
  abstract readonly selfId: string;
  protected handlers = new Map<string, Handler[]>();
  protected joinCbs: ((id: string) => void)[] = [];
  protected leaveCbs: ((id: string) => void)[] = [];
  abstract send(type: string, data: unknown, to?: string): void;
  abstract leave(): void;
  abstract whenReady(cb: () => void): void;
  on(type: string, cb: Handler) {
    let l = this.handlers.get(type);
    if (!l) this.handlers.set(type, (l = []));
    l.push(cb);
  }
  onJoin(cb: (id: string) => void) {
    this.joinCbs.push(cb);
  }
  onLeave(cb: (id: string) => void) {
    this.leaveCbs.push(cb);
  }
  protected dispatch(env: Envelope, from: string) {
    const l = this.handlers.get(env.t);
    if (l) for (const h of l) {
      try {
        h(env.d, from);
      } catch (e) {
        console.error('net handler', env.t, e);
      }
    }
  }
}

/** Real internet play over WebRTC (Trystero + Nostr signaling). */
export class TrysteroTransport extends Base {
  selfId = '';
  private room: { leave(): Promise<void> } | null = null;
  private action: { send(d: Envelope, o?: { target?: string }): Promise<void> } | null = null;
  private queue: [string, unknown, string | undefined][] = [];

  constructor(roomId: string) {
    super();
    // lazy-load so solo players never download the networking code
    import('trystero').then(({ joinRoom, selfId }) => {
      this.selfId = selfId;
      const room = joinRoom(
        {
          appId: 'toy-troopers-bedroom-v1',
          rtcConfig: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun.cloudflare.com:3478' },
            ],
          },
        },
        roomId,
      );
      this.room = room;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const act = room.makeAction<any>('tt');
      act.onMessage = (data: Envelope, ctx: { peerId: string }) => this.dispatch(data, ctx.peerId);
      this.action = act as unknown as TrysteroTransport['action'];
      room.onPeerJoin = (id: string) => this.joinCbs.forEach((c) => c(id));
      room.onPeerLeave = (id: string) => this.leaveCbs.forEach((c) => c(id));
      for (const [t, d, to] of this.queue) this.send(t, d, to);
      this.queue = [];
      this.readyCbs.forEach((c) => c());
    });
  }

  private readyCbs: (() => void)[] = [];
  whenReady(cb: () => void) {
    if (this.action) cb();
    else this.readyCbs.push(cb);
  }

  send(type: string, data: unknown, to?: string) {
    if (!this.action) {
      this.queue.push([type, data, to]);
      return;
    }
    this.action.send({ t: type, d: data }, to ? { target: to } : undefined).catch(() => {});
  }

  leave() {
    this.room?.leave();
    this.room = null;
    this.action = null;
  }
}

/** Same-browser transport (tabs on one device) used for local testing: ?net=local */
export class LocalTransport extends Base {
  readonly selfId = Math.random().toString(36).slice(2, 10);
  private ch: BroadcastChannel;
  private peers = new Map<string, number>();
  private timer: number;

  constructor(roomId: string) {
    super();
    this.ch = new BroadcastChannel('tt-room-' + roomId);
    this.ch.onmessage = (ev) => {
      const m = ev.data as { from: string; to?: string; t: string; d: unknown };
      if (m.from === this.selfId || (m.to && m.to !== this.selfId)) return;
      const known = this.peers.has(m.from);
      this.peers.set(m.from, performance.now());
      if (m.t === '__bye') {
        this.peers.delete(m.from);
        this.leaveCbs.forEach((c) => c(m.from));
        return;
      }
      if (!known) {
        this.joinCbs.forEach((c) => c(m.from));
        if (m.t === '__hello') this.raw('__hello', null, m.from);
      }
      if (!m.t.startsWith('__')) this.dispatch({ t: m.t, d: m.d }, m.from);
    };
    setTimeout(() => this.raw('__hello', null), 0);
    this.timer = window.setInterval(() => {
      this.raw('__ping', null);
      const now = performance.now();
      for (const [id, last] of this.peers)
        if (now - last > 5000) {
          this.peers.delete(id);
          this.leaveCbs.forEach((c) => c(id));
        }
    }, 1000);
    window.addEventListener('beforeunload', () => this.leave());
  }

  private raw(t: string, d: unknown, to?: string) {
    try {
      this.ch.postMessage({ from: this.selfId, to, t, d });
    } catch {
      /* closed */
    }
  }

  send(type: string, data: unknown, to?: string) {
    this.raw(type, data, to);
  }

  whenReady(cb: () => void) {
    cb();
  }

  leave() {
    this.raw('__bye', null);
    clearInterval(this.timer);
    this.ch.close();
  }
}

export function createTransport(roomId: string): Transport {
  const local = new URLSearchParams(location.search).get('net') === 'local';
  return local ? new LocalTransport(roomId) : new TrysteroTransport(roomId);
}

export function randomRoomCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
