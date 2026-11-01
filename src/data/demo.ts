/**
 * Demo-Kampagne "APEX – Arena des Ewigen Willens".
 * Alle Namen und Hintergründe sind Platzhalter, die du frei ändern kannst.
 */
import { ORIGIN, distance, hexKey, hexesInRange, type Axial, type HexKey } from '../game/hex';
import { generateArena } from '../game/mapgen';
import { isPassable, type TerrainType } from '../game/terrain';
import { refreshAllKnowledge, emptyKnowledge } from '../game/visibility';
import { addLog } from '../game/log';
import {
  STATE_VERSION,
  type ArenaEvent,
  type GameConfig,
  type GameState,
  type HexTile,
  type Site,
  type Team,
  type Token,
} from '../game/types';

export interface DemoOptions {
  radius?: number;
  seed?: number;
}

export const DEFAULT_RADIUS = 12;
export const DEFAULT_SEED = 1337;

export function createDemoState(opts: DemoOptions = {}): GameState {
  const radius = Math.max(4, Math.min(20, Math.round(opts.radius ?? DEFAULT_RADIUS)));
  const seed = Math.round(opts.seed ?? DEFAULT_SEED);
  // Positionen sind für Radius 12 entworfen und werden für andere Größen skaliert.
  const f = radius / DEFAULT_RADIUS;
  const at = (q: number, r: number): Axial => ({ q: Math.round(q * f), r: Math.round(r * f) });

  const config: GameConfig = {
    mapRadius: radius,
    seed,
    defaultMovePoints: 8,
    defaultVisionRadius: 2,
    shrink: {
      enabled: true,
      startDay: 5,
      intervalDays: 2,
      ringsPerStep: 1,
      mode: 'danger',
      warningDays: 1,
      consequence: 'Rettungswurf auf Konstitution (SG 12) – bei Misserfolg 2W6 nekrotischer Schaden.',
    },
  };

  // ---------------- Orte ----------------
  const siteList: Array<Site & { terrain: TerrainType }> = [
    {
      id: 'meta-aurea',
      name: 'Meta Aurea',
      type: 'start',
      pos: { ...ORIGIN },
      terrain: 'plains',
      description:
        'Eine goldene Wendesäule, die über dem Arenaboden schwebt. Hier wurden die Tribute abgesetzt; rundherum liegen Kisten mit Grundausrüstung.',
      gmNotes: 'Am Abend von Tag 1 fällt eine zweite Versorgungskiste – wer bleibt, riskiert einen Hinterhalt.',
      visibility: 'public',
      status: 'intact',
      rewards: ['Rationen für 2 Tage', 'Seil (15 m)', 'Gladius'],
      interactions: ['Ausrüstung plündern', 'Säule untersuchen (Arkana SG 13)'],
    },
    {
      id: 'castra-neutra',
      name: 'Castra Neutra',
      type: 'camp',
      pos: at(5, -3),
      terrain: 'plains',
      description:
        'Ein umzäuntes Lager unter dem Siegel der Spielmacher. Die Händlerin Sabina Velox tauscht Vorräte gegen Willenskraft. Kämpfe sind hier verboten.',
      gmNotes: 'Sabina ist eine Informantin der Legio Ferrata. Bei hohem Ruf verrät sie das.',
      visibility: 'onSight',
      status: 'occupied',
      rewards: ['Heiltränke (gegen Willenskraft)', 'Karte eines Sektors'],
      interactions: ['Handeln', 'Rasten (sicher)', 'Gerüchte erfragen'],
    },
    {
      id: 'speculum',
      name: 'Speculum',
      type: 'tower',
      pos: at(-3, 1),
      terrain: 'ruins',
      description: 'Ein halb verfallener Signalturm mit einem riesigen Bronzespiegel. Von oben überblickt man die Umgebung.',
      gmNotes: 'Besteigen: Athletik SG 10 → GM gibt +2 Sichtweite bis Tagesende.',
      visibility: 'onSight',
      status: 'intact',
      rewards: ['Weite Sicht (+2)'],
      interactions: ['Turm besteigen', 'Spiegel ausrichten (Signal an andere Teams!)'],
    },
    {
      id: 'fons-voluntatis',
      name: 'Fons Voluntatis',
      type: 'shrine',
      pos: at(-8, 2),
      terrain: 'magic',
      description: 'Eine Quelle, aus der flüssige Willenskraft sprudelt. Sie füllt Willensgefäße – zu einem Preis.',
      gmNotes: 'Pro Füllung: Weisheitsrettungswurf SG 14, sonst 1 Erschöpfungsstufe.',
      visibility: 'onSight',
      status: 'intact',
      rewards: ['Willensphiole füllen (+3 Willenskraft)'],
      interactions: ['Trinken', 'Gefäß füllen'],
    },
    {
      id: 'templum-oblitum',
      name: 'Templum Oblitum',
      type: 'ruin',
      pos: at(-6, 8),
      terrain: 'ruins',
      description: 'Ein vergessener Tempel, der in keiner Arenakarte verzeichnet ist.',
      gmNotes: 'Versteckter Ort. Enthält den Ankerstein, der die Arenagrenzen speist. Zerstörung stoppt die Schrumpfung für 2 Tage.',
      visibility: 'hidden',
      status: 'intact',
      rewards: ['Ankerstein der Arena'],
      interactions: ['Ankerstein entnehmen', 'Ankerstein zerstören'],
    },
    {
      id: 'donum-imperatoris',
      name: 'Donum Imperatoris',
      type: 'cache',
      pos: at(6, 2),
      terrain: 'plains',
      description: 'Ein vom Himmel gesenkter Versorgungsschrein mit dem Adler des Imperators.',
      gmNotes: 'Wird an Tag 3 durch das Event "Proklamation" öffentlich. Alle Rivalen steuern ihn an.',
      visibility: 'hidden',
      status: 'intact',
      rewards: ['Pilum der Sterne', 'Willensphiole (voll)', 'Rationen für 4 Tage'],
      interactions: ['Schrein öffnen'],
    },
  ];

  const overrides: Record<HexKey, TerrainType> = {};
  for (const s of siteList) overrides[hexKey(s.pos)] = s.terrain;

  const hexes = generateArena({ radius, seed, overrides });
  for (const s of siteList) if (hexes[hexKey(s.pos)]) hexes[hexKey(s.pos)].siteId = s.id;

  const sites: Record<string, Site> = {};
  for (const { terrain: _t, ...s } of siteList) if (hexes[hexKey(s.pos)]) sites[s.id] = s;

  // ---------------- Teams ----------------
  const teams: Record<string, Team> = {
    party: {
      id: 'party',
      name: 'Cohors Ignota',
      kind: 'party',
      color: '#e9c46a',
      emblem: '✦',
      motto: 'Niemand kennt unsere Namen – noch nicht.',
      personality: 'Die Gruppe der Spieler.',
      aggression: 0,
      goals: ['Überleben', 'Die Wahrheit hinter der Arena finden'],
      resources: [],
      strategy: 'manual',
      visibility: 'revealed',
      tracking: null,
    },
    ferrata: {
      id: 'ferrata',
      name: 'Legio Ferrata',
      kind: 'rival',
      color: '#8fa3bf',
      emblem: '⚔',
      motto: 'Eisen gehorcht. Eisen siegt.',
      personality: 'Disziplinierte Veteranen aus den Kasernen von Ostia. Arbeiten in Formation, verhandeln nie zweimal.',
      aggression: 8,
      goals: ['Donum Imperatoris sichern', 'Stärkstes Team ausschalten'],
      resources: ['Schilde', 'Signalhorn', '2 Willensphiolen'],
      strategy: 'patrol',
      visibility: 'auto',
      tracking: null,
    },
    vesperia: {
      id: 'vesperia',
      name: 'Haus Vesperia',
      kind: 'rival',
      color: '#b48ee0',
      emblem: '✶',
      motto: 'Der Wille vieler in der Hand weniger.',
      personality: 'Adelige Willensbinder. Höflich, berechnend, ziehen andere Teams gerne in Fallen.',
      aggression: 5,
      goals: ['Fons Voluntatis kontrollieren', 'Allianzen schmieden und brechen'],
      resources: ['Gebundene Diener', 'Gefälschte Karte'],
      strategy: 'forage',
      visibility: 'auto',
      tracking: null,
    },
    aquaeductus: {
      id: 'aquaeductus',
      name: 'Kinder des Aquädukts',
      kind: 'rival',
      color: '#4fc1b0',
      emblem: '≈',
      motto: 'Wir kennen die Wege unter der Arena.',
      personality: 'Straßenkinder aus den unteren Bezirken. Flink, misstrauisch, meiden offene Kämpfe.',
      aggression: 3,
      goals: ['Unentdeckt bleiben', 'Templum Oblitum erreichen'],
      resources: ['Kletterhaken', 'Rauchtöpfe'],
      strategy: 'flee',
      visibility: 'auto',
      tracking: null,
    },
  };

  // ---------------- Figuren ----------------
  const base = (p: Partial<Token> & Pick<Token, 'id' | 'name' | 'kind' | 'teamId' | 'color' | 'initials' | 'pos' | 'title'>): Token => ({
    movePoints: config.defaultMovePoints,
    maxMovePoints: config.defaultMovePoints,
    visionRadius: config.defaultVisionRadius,
    visionBonus: 0,
    controllers: [],
    sharesWithParty: true,
    will: { current: 0, max: 0 },
    inventory: [],
    ...p,
  });

  const tokenList: Token[] = [
    base({
      id: 'livia', name: 'Livia Aurelia', kind: 'player', teamId: 'party', title: 'Willensweberin',
      color: '#e9c46a', initials: 'LA', pos: { q: 0, r: 0 },
      will: { current: 6, max: 10 },
      inventory: [
        { id: 'i1', name: 'Voluntas-Phiole', kind: 'will-vessel', description: 'Speichert gebundene Willenskraft.', quantity: 1, willCharge: 3, willCapacity: 5 },
        { id: 'i2', name: 'Stab aus Aquäduktstein', kind: 'weapon', description: 'Leitet Willenskraft wie Wasser.', quantity: 1 },
      ],
    }),
    base({
      id: 'marcus', name: 'Marcus Varro', kind: 'player', teamId: 'party', title: 'Legionär a. D.',
      color: '#6fb1e0', initials: 'MV', pos: { q: 0, r: 0 }, maxMovePoints: 8,
      will: { current: 2, max: 4 },
      inventory: [
        { id: 'i3', name: 'Scutum', kind: 'armor', description: 'Großer Legionärsschild.', quantity: 1 },
        { id: 'i4', name: 'Gladius', kind: 'weapon', description: 'Kurzschwert.', quantity: 1 },
      ],
    }),
    base({
      id: 'nyx', name: 'Nyx Silvana', kind: 'player', teamId: 'party', title: 'Späherin',
      color: '#7cc98a', initials: 'NS', pos: { q: -1, r: 1 }, visionRadius: 3,
      will: { current: 3, max: 5 },
      inventory: [
        { id: 'i5', name: 'Kurzbogen', kind: 'weapon', description: '20 Pfeile.', quantity: 1 },
        { id: 'i6', name: 'Kletterseil', kind: 'tool', description: '15 m, mit Haken.', quantity: 1 },
      ],
    }),
    base({
      id: 'cassius', name: 'Cassius Thorne', kind: 'player', teamId: 'party', title: 'Gladiatorpriester',
      color: '#ece4d2', initials: 'CT', pos: { q: 0, r: 0 },
      will: { current: 4, max: 8 },
      inventory: [
        { id: 'i7', name: 'Netz & Dreizack', kind: 'weapon', description: 'Klassische Retiarius-Ausrüstung.', quantity: 1 },
        { id: 'i8', name: 'Heiltrank', kind: 'consumable', description: '2W4+2 TP.', quantity: 2 },
      ],
    }),
    base({
      id: 'r-ferrata', name: 'Legio Ferrata', kind: 'rival', teamId: 'ferrata', title: '4 Legionäre · Zenturio Gaius Dentatus',
      color: teams.ferrata.color, initials: '⚔', pos: nearestPassable(hexes, at(8, -8)),
    }),
    base({
      id: 'r-vesperia', name: 'Haus Vesperia', kind: 'rival', teamId: 'vesperia', title: '3 Willensbinder · Domina Aelia Vesper',
      color: teams.vesperia.color, initials: '✶', pos: nearestPassable(hexes, at(-9, 4)),
    }),
    base({
      id: 'r-aquaeductus', name: 'Kinder des Aquädukts', kind: 'rival', teamId: 'aquaeductus', title: '5 Streuner · „Ratte“ Felix',
      color: teams.aquaeductus.color, initials: '≈', pos: nearestPassable(hexes, at(2, 7)),
    }),
  ];
  const tokens: Record<string, Token> = Object.fromEntries(tokenList.map((t) => [t.id, t]));

  // ---------------- Events ----------------
  const floodHexes = hexesInRange(at(-1, -6), 1)
    .concat(hexesInRange(at(1, -7), 1))
    .map(hexKey)
    .filter((k) => hexes[k] && !hexes[k].siteId);

  const events: Record<string, ArenaEvent> = {
    flood: {
      id: 'flood',
      name: 'Bruch des Aquädukts',
      description: 'Ein schwebendes Aquädukt bricht im Norden zusammen. Die Fluten verwandeln das Land in einen See.',
      trigger: { type: 'day', day: 2 },
      hexes: [...new Set(floodHexes)],
      effects: [{ type: 'setTerrain', terrain: 'water' }],
      status: 'pending',
      announce: true,
    },
    proclamation: {
      id: 'proclamation',
      name: 'Proklamation des Editors',
      description: 'Die Stimme des Spielleiters der Arena hallt über das Feld: Im Osten wartet das Donum Imperatoris.',
      trigger: { type: 'day', day: 3 },
      hexes: sites['donum-imperatoris'] ? [hexKey(sites['donum-imperatoris'].pos)] : [],
      effects: [{ type: 'revealSite', siteId: 'donum-imperatoris' }],
      status: 'pending',
      announce: true,
    },
    willstorm: {
      id: 'willstorm',
      name: 'Willenssturm',
      description: 'Ein Sturm entfesselter Willenskraft fegt über die Arena. Jeder Schritt wird zur Qual (−2 BP).',
      trigger: { type: 'manual' },
      hexes: [],
      effects: [{ type: 'modifyMovePoints', amount: -2 }],
      status: 'pending',
      announce: true,
    },
  };

  const state: GameState = {
    version: STATE_VERSION,
    config,
    day: 1,
    hexes,
    tokens,
    teams,
    sites,
    events,
    knowledge: Object.fromEntries(tokenList.filter((t) => t.kind === 'player').map((t) => [t.id, emptyKnowledge()])),
    log: [],
    nextLogId: 1,
  };

  addLog(state, 'system', 'Die Tore der Arena schließen sich. Tag 1 beginnt an der Meta Aurea.');
  addLog(state, 'system', `Arena erzeugt: Radius ${radius}, ${Object.keys(hexes).length} Felder, Seed ${seed}.`, 'gm');
  refreshAllKnowledge(state);
  return state;
}

/** Nächstgelegenes passierbares Feld (für Startpositionen). */
export function nearestPassable(hexes: Record<HexKey, HexTile>, target: Axial): Axial {
  const tiles = Object.values(hexes)
    .filter((t) => isPassable(t.terrain))
    .sort((a, b) => distance(a, target) - distance(b, target));
  return tiles.length ? { q: tiles[0].q, r: tiles[0].r } : { ...ORIGIN };
}
