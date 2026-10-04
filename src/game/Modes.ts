import { SNIPER, MINIGUN } from './Weapons';

export type ModeId = 'ffa' | 'gungame' | 'snipers' | 'tdm' | 'coop';

export interface ModeDef {
  id: ModeId;
  name: string;
  blurb: string;
  /** weapons available (gun game overrides per level) */
  loadout: number[];
  frags: number;
  flashes: number;
  /** kills to win (per player, or per team in tdm) */
  scoreLimit: number;
  /** seconds; 0 = none */
  timeLimit: number;
  teams: boolean;
  /** which map pickups exist */
  pickups: ('health' | 'ammo' | 'frag' | 'flash' | 'minigun')[];
}

export const MODES: Record<ModeId, ModeDef> = {
  ffa: {
    id: 'ffa', name: 'FREE FOR ALL', blurb: 'Everyone for themselves. First to 20 knockouts.',
    loadout: [0, 1, 2, 3], frags: 1, flashes: 1, scoreLimit: 20, timeLimit: 480, teams: false,
    pickups: ['health', 'ammo', 'frag', 'flash', 'minigun'],
  },
  gungame: {
    id: 'gungame', name: 'GUN GAME', blurb: 'Every knockout gives you a new gun. 15 to win.',
    loadout: [0], frags: 0, flashes: 1, scoreLimit: 15, timeLimit: 600, teams: false,
    pickups: ['health', 'flash'],
  },
  snipers: {
    id: 'snipers', name: 'SNIPERS ONLY', blurb: 'Snap Snipers and flash cubes. First to 15.',
    loadout: [SNIPER], frags: 0, flashes: 2, scoreLimit: 15, timeLimit: 480, teams: false,
    pickups: ['health', 'flash'],
  },
  tdm: {
    id: 'tdm', name: 'TEAM BATTLE', blurb: 'Green Squad vs Tan Squad. First team to 30.',
    loadout: [0, 1, 2, 3], frags: 1, flashes: 1, scoreLimit: 30, timeLimit: 600, teams: true,
    pickups: ['health', 'ammo', 'frag', 'flash', 'minigun'],
  },
  coop: {
    id: 'coop', name: 'CO-OP SURVIVAL', blurb: 'Team up against all 5 waves and the Wind-Up King.',
    loadout: [0, 1, 2, 3], frags: 2, flashes: 1, scoreLimit: 0, timeLimit: 0, teams: false,
    pickups: ['health', 'ammo', 'frag', 'flash', 'minigun'],
  },
};

/** Gun Game ladder: the weapon you hold after N knockouts. */
export const GUN_LADDER = [0, 1, 3, MINIGUN, 2, 0, 1, 3, MINIGUN, 2, 1, 3, 0, 3, 1];

export const TEAM_NAMES = ['GREEN SQUAD', 'TAN SQUAD'];
export const TEAM_COLORS = [0x5f8f2f, 0xc9a26b];
/** body colours for free-for-all soldiers */
export const FFA_COLORS = [0x5f8f2f, 0x3f7fd9, 0xc9a26b, 0x9b59d0, 0xff8a1f, 0x2fb3b3, 0xe8453c, 0x8a8f98];
