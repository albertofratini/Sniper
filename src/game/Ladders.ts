import * as THREE from 'three';
import { CollisionWorld } from './Collision';

/**
 * Vertical ladders (world units). A ladder stands in front of a face; `n` points
 * from the ladder INTO the platform it leads up to. You climb at (x,z) - n*(r+gap),
 * from y0 (its foot) to y1 (the floor of the platform above).
 */
export interface Ladder {
  id: number;
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** half width along the face */
  halfW: number;
  y0: number;
  y1: number;
}

/** Anything that can climb: the player, or a bot's body. */
export interface Climber {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  height: number;
  climb: LadderState;
}

export class LadderState {
  ladder: Ladder | null = null;
  /** >= 0 while stepping off the top onto the platform (seconds into it) */
  exitT = -1;
  exitFrom = new THREE.Vector3();
  exitTo = new THREE.Vector3();
  /** can't grab any ladder for this long (after jumping / stepping off) */
  regrab = 0;
  /** ladder we just left at the top: don't immediately grab it back from above */
  lastTop: Ladder | null = null;
  get active() {
    return this.ladder !== null;
  }
}

export const CLIMB_SPEED = 7.5;
const GAP = 0.18;
const EXIT_TIME = 0.24;

const tan = (l: Ladder) => ({ tx: -l.nz, tz: l.nx });

/** where the climber's feet go on the ladder (at height y) */
export function ladderSpot(l: Ladder, r: number, lateral: number, out: THREE.Vector3, y: number) {
  const { tx, tz } = tan(l);
  return out.set(l.x - l.nx * (r + GAP) + tx * lateral, y, l.z - l.nz * (r + GAP) + tz * lateral);
}

function local(l: Ladder, p: THREE.Vector3) {
  const dx = p.x - l.x, dz = p.z - l.z;
  const { tx, tz } = tan(l);
  return { along: dx * l.nx + dz * l.nz, lateral: dx * tx + dz * tz };
}

/**
 * Should the climber latch on? Walking forward into a ladder from below, or
 * backing off the top edge onto it. Never by accident: you must be pushing
 * toward it, roughly facing it (from below) or facing away (from the top).
 */
export function tryGrab(world: CollisionWorld, c: Climber, moveY: number, fwdX: number, fwdZ: number, grounded: boolean) {
  const st = c.climb;
  if (st.active || st.regrab > 0) return false;
  for (const l of world.ladders) {
    const { along, lateral } = local(l, c.pos);
    if (Math.abs(lateral) > l.halfW + 0.35) continue;
    const facing = fwdX * l.nx + fwdZ * l.nz;
    // from below: in front of the ladder, pushing forward while facing it
    if (moveY > 0.3 && facing > 0.35 && along < 0.15 && along > -(c.radius + 1.0) && c.pos.y >= l.y0 - 0.6 && c.pos.y < l.y1 - 0.4) {
      st.ladder = l;
      st.lastTop = null;
      ladderSpot(l, c.radius, Math.max(-l.halfW * 0.5, Math.min(l.halfW * 0.5, lateral)), c.pos, c.pos.y);
      c.vel.set(0, 0, 0);
      return true;
    }
    // from the top: standing at the edge, backing over it
    if (grounded && moveY < -0.3 && facing > 0.35 && along > -0.2 && along < c.radius + 1.0 && Math.abs(c.pos.y - l.y1) < 0.35) {
      st.ladder = l;
      st.lastTop = null;
      ladderSpot(l, c.radius, Math.max(-l.halfW * 0.5, Math.min(l.halfW * 0.5, lateral)), c.pos, l.y1 - c.height * 0.75);
      c.vel.set(0, 0, 0);
      return true;
    }
  }
  return false;
}

const tmp = new THREE.Vector3();
/**
 * One step on the ladder. Forward climbs, backward descends, letting go of the
 * stick stops you in place. Jump pushes you off. Reaching the top carries you
 * onto the platform. Returns true while still attached (or stepping off).
 */
export function climbStep(world: CollisionWorld, c: Climber, dt: number, moveY: number, moveX: number, jump: boolean) {
  const st = c.climb;
  const l = st.ladder;
  if (!l) return false;
  // stepping off the top: a short scripted move, then you're standing on the floor
  if (st.exitT >= 0) {
    st.exitT += dt;
    const k = Math.min(1, st.exitT / EXIT_TIME);
    const e = k * k * (3 - 2 * k);
    // rise first, then move in, so the body clears the lip
    c.pos.x = st.exitFrom.x + (st.exitTo.x - st.exitFrom.x) * Math.max(0, (e - 0.35) / 0.65);
    c.pos.z = st.exitFrom.z + (st.exitTo.z - st.exitFrom.z) * Math.max(0, (e - 0.35) / 0.65);
    c.pos.y = st.exitFrom.y + (st.exitTo.y - st.exitFrom.y) * Math.min(1, e / 0.35);
    c.vel.set(0, 0, 0);
    if (k >= 1) {
      c.pos.copy(st.exitTo);
      st.ladder = null;
      st.exitT = -1;
      st.lastTop = l;
      st.regrab = 0.35;
    }
    return true;
  }
  if (jump) {
    st.ladder = null;
    st.regrab = 0.45;
    c.vel.set(-l.nx * 7, 9, -l.nz * 7);
    return false;
  }
  const { lateral } = local(l, c.pos);
  // a little sideways shuffle; off the side = let go
  const lat = lateral + moveX * 3 * dt;
  if (Math.abs(lat) > l.halfW + 0.15) {
    st.ladder = null;
    st.regrab = 0.4;
    return false;
  }
  const vy = moveY > 0.15 ? CLIMB_SPEED * Math.min(1, moveY * 1.2) : moveY < -0.15 ? -CLIMB_SPEED * Math.min(1, -moveY * 1.2) : 0;
  ladderSpot(l, c.radius, lat, tmp, c.pos.y);
  c.vel.set((tmp.x - c.pos.x) / Math.max(dt, 1e-3), vy, (tmp.z - c.pos.z) / Math.max(dt, 1e-3));
  world.moveCylinder(c.pos, c.vel, dt, c.radius, c.height, 0.2, 0);
  // keep hanging on even if the collision solver reported "grounded" mid-ladder
  c.vel.set(0, vy, 0);
  if (c.pos.y < l.y0) c.pos.y = l.y0;
  // at the foot and still pulling back: step off onto the ground
  if (moveY < -0.15 && c.pos.y <= l.y0 + 0.02) {
    st.ladder = null;
    st.regrab = 0.4;
    return false;
  }
  // feet level with the platform: step onto it
  if (vy > 0 && c.pos.y >= l.y1 - 0.05) {
    st.exitT = 0;
    st.exitFrom.copy(c.pos);
    st.exitTo.set(l.x + l.nx * (c.radius + 0.35) + -l.nz * lat, l.y1, l.z + l.nz * (c.radius + 0.35) + l.nx * lat);
    return true;
  }
  return true;
}

/** Tick timers that run whether or not you're on a ladder. */
export function ladderTick(c: Climber, dt: number) {
  c.climb.regrab = Math.max(0, c.climb.regrab - dt);
}

/** Put a climber straight onto a ladder (bots): at its foot, or just below the top. */
export function mountLadder(c: Climber, l: Ladder, fromTop: boolean) {
  const st = c.climb;
  st.ladder = l;
  st.exitT = -1;
  st.lastTop = null;
  ladderSpot(l, c.radius, 0, c.pos, fromTop ? l.y1 - c.height * 0.75 : Math.max(c.pos.y, l.y0));
  c.vel.set(0, 0, 0);
}
