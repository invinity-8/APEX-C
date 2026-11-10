/** APEX 2.1 – the campaign's enemy groups and stat blocks for the scene editor (provided by App for the GM). */
import { createContext } from 'react';
import { BUILTIN_BESTIARY, type StatBlock } from '../game/bestiary';
import type { EnemyGroup } from '../game/groups';

export const GroupsContext = createContext<{ custom: EnemyGroup[]; blocks: StatBlock[] }>({ custom: [], blocks: BUILTIN_BESTIARY });
