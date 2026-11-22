import type { MidSquad } from './types';

export const midRegistry: Record<string, MidSquad> = {
  'mid-zangu-ai': {
    id: 'mid-zangu-ai',
    name: '攒股收息 × AI手记',
    squads: ['zangu-shouxi', 'ai-shouji'],
  },
  'mid-bank': {
    id: 'mid-bank',
    name: '银行中团',
    squads: ['bank-big4', 'bank-joint', 'bank-city'],
  },
};
