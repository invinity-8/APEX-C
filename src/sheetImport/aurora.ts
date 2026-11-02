/**
 * Aurora Builder character sheets (fillable PDF, 5–6 pages).
 *
 * Aurora uses a stable, structured field naming scheme, so everything important comes from real
 * form fields – never from page-text guesses:
 *   details_*                    identity, abilities, combat, skills, saves, attacks (page 1)
 *   background_*                 appearance and story (page 2)
 *   equipment_page_*             numbered gear / magic items / valuables / coins (page 3)
 *   spellcasting_<x>:<Class>:<n> spellcasting summary per class (page 4)
 *   spells_<L>:<i>_:<Class>:<n>  spell names by level L (0 = cantrips)
 *   prepare_<L>:<i>_:<Class>:<n> checkbox: prepared
 *   slot<k>_<L>:<i>_:<Class>:<n> one checkbox per spell slot of level L (checked = expended)
 *   card_*                       item/spell cards – duplicates of the equipment list, ignored
 * The only text-based part is the "Features & Traits" block on page 1, which Aurora prints as
 * "Name. Description" paragraphs (marked "Please check").
 */
import { ATTRS, COINS, HP_LABEL, SKILLS, clean, row, type Extracted, type ImportRow } from './map';

/** Detects Aurora sheets by their characteristic field names. */
export function isAurora(x: Extracted): boolean {
  const names = Object.keys(x.fields);
  const hits = ['details_build', 'details_character_name', 'details_str_score', 'details_hp_max'].filter((n) => n in x.fields).length;
  return hits >= 3 || (names.filter((n) => n.startsWith('details_')).length >= 20 && names.some((n) => n.startsWith('equipment_page_')));
}

const yes = (x: Extracted, name: string) => x.checkboxes?.[name] === true;

/** Fields consumed by the mapping – everything else that has a value goes to the Advanced section. */
const IGNORED = [
  /^card_(title|subtitle|footer_left|footer_right)_/, // duplicate item/spell cards
  /^hidden_layout_helper$/,
  /^background_portrait_image/,
  /^background_organization_image/,
  /^equipment_page_vehicle_\d+_name$/, // placeholders "#1", "#2"
];

export function mapAurora(x: Extracted): ImportRow[] {
  const rows: ImportRow[] = [];
  const used = new Set<string>();
  const get = (name: string): string | null => {
    used.add(name);
    const v = x.fields[name];
    if (v === undefined) return null;
    const c = clean(v);
    return c ? c : null;
  };
  const rec = (r: Omit<ImportRow, 'status' | 'include'> & { status?: ImportRow['status']; include?: boolean }) => rows.push(row({ status: 'recognized', ...r }));

  // ---------------- identity & appearance
  const identity: Array<[string, string]> = [
    ['details_character_name', 'Character name'],
    ['details_build', 'Race, class & level'],
    ['details_background', 'Background'],
    ['details_alignment', 'Alignment'],
    ['details_deity', 'Deity'],
    ['details_player', 'Player name'],
    ['details_xp', 'Experience points'],
  ];
  for (const [f, label] of identity) {
    const v = get(f);
    if (v) rec({ key: f, group: 'identity', kind: 'detail', label, value: v, source: f });
  }
  get('background_character_name'); // same as details_character_name
  const appearance: Array<[string, string]> = [
    ['background_gender', 'Gender'],
    ['background_age', 'Age'],
    ['background_height', 'Height'],
    ['background_weight', 'Weight'],
    ['background_eyes', 'Eyes'],
    ['background_skin', 'Skin'],
    ['background_hair', 'Hair'],
  ];
  for (const [f, label] of appearance) {
    const v = get(f);
    if (v) rec({ key: f, group: 'identity', kind: 'appearance', label, value: v, source: f });
  }

  // ---------------- attributes
  for (const [k, label] of ATTRS) {
    const score = get(`details_${k}_score`);
    const mod = get(`details_${k}_modifier`);
    if (score || mod) rec({ key: `attr:${k}`, group: 'attributes', kind: 'attribute', label, value: score ?? '', modifier: mod ?? '', source: `details_${k}_score` });
  }

  // ---------------- combat & resources
  for (const [f, which] of [
    ['details_hp_max', 'max'],
    ['details_hp_current', 'current'],
    ['details_hp_temp', 'temp'],
  ] as const) {
    const v = get(f);
    if (v) {
      const ok = /^-?\d+$/.test(v);
      rec({ key: f, group: 'combat', kind: 'hp', label: HP_LABEL[which], value: v, hp: which, status: ok ? 'recognized' : 'uncertain', source: f, note: ok ? undefined : 'Not a whole number – please correct.' });
    }
  }
  const combat: Array<[string, string]> = [
    ['details_armor_class', 'Armor Class'],
    ['details_armor_conditional', 'Armor Class (conditional)'],
    ['details_equipped_armor', 'Armor worn'],
    ['details_equipped_shield', 'Shield'],
    ['details_hd', 'Hit dice'],
    ['details_proficiency_bonus', 'Proficiency bonus'],
    ['details_initiative', 'Initiative'],
    ['details_speed_walking', 'Speed (walking)'],
    ['details_speed_fly', 'Speed (flying)'],
    ['details_speed_climb', 'Speed (climbing)'],
    ['details_speed_swim', 'Speed (swimming)'],
    ['details_vision', 'Vision / senses'],
    ['details_passive_perception_total', 'Passive Perception'],
    ['details_inspiration', 'Inspiration'],
    ['details_exhaustion', 'Exhaustion'],
    ['details_resistances', 'Resistances & conditions'],
    ['details_saving_throws', 'Saving throw notes'],
    ['details_encounter_box', 'Actions per turn'],
    ['details_attack_description', 'Attack notes'],
  ];
  for (const [f, label] of combat) {
    const v = get(f);
    // Aurora writes "0ft." for movement types the character does not have – not worth importing.
    if (v && !(/^details_speed_(fly|climb|swim)$/.test(f) && /^0\s*ft\.?$/i.test(v))) {
      rec({ key: f, group: 'combat', kind: 'combat', label: f === 'details_initiative' && yes(x, 'details_initiative_advantage') ? 'Initiative (advantage)' : label, value: v, source: f });
    }
  }
  if (yes(x, 'details_armor_stealth_disadvantage')) rec({ key: 'stealthdis', group: 'combat', kind: 'combat', label: 'Stealth', value: 'Disadvantage (armor)', source: 'details_armor_stealth_disadvantage' });
  used.add('details_initiative_advantage');
  used.add('details_armor_stealth_disadvantage');
  for (let i = 1; i <= 4; i++) {
    const weapon = get(`details_attack${i}_weapon`);
    const attack = get(`details_attack${i}_attack`);
    const damage = get(`details_attack${i}_damage`);
    const range = get(`details_attack${i}_range`);
    const desc = get(`details_attack${i}_description`);
    if (weapon) {
      rec({ key: `attack:${i}`, group: 'combat', kind: 'attack', label: weapon, value: weapon, bonus: attack ?? '', damage: [damage, desc].filter(Boolean).join(' · '), range: range ?? '', source: `details_attack${i}_weapon` });
    }
  }
  for (let i = 1; i <= 3; i++) {
    used.add(`details_death_save_fail_${i}`);
    used.add(`details_death_save_success_${i}`);
  }

  // ---------------- skills & saving throws
  for (const [k, label] of ATTRS) {
    const total = get(`details_${k}_save_total`);
    used.add(`details_${k}_save_proficiency`);
    if (total) rec({ key: `save:${k}`, group: 'skills', kind: 'save', label: `${label} save`, value: total, proficient: yes(x, `details_${k}_save_proficiency`), source: `details_${k}_save_total` });
  }
  for (const [k, label, ability] of SKILLS) {
    const total = get(`details_${k}_total`);
    used.add(`details_${k}_proficiency`);
    used.add(`details_${k}_expertise`);
    if (total) {
      rec({
        key: `skill:${k}`,
        group: 'skills',
        kind: 'skill',
        label: `${label} (${ability})`,
        value: total,
        proficient: yes(x, `details_${k}_proficiency`) || yes(x, `details_${k}_expertise`),
        expertise: yes(x, `details_${k}_expertise`),
        source: `details_${k}_total`,
      });
    }
  }

  // ---------------- spells
  const spellcasting = new Map<string, Record<string, string>>(); // "Druid:1" → {class, ability, bonus, save, prepare}
  const spells = new Map<string, { name: string; level: number; prepared: boolean; source: string; field: string }>();
  const slots = new Map<number, { total: number; used: number }>();
  for (const name of Object.keys(x.fields)) {
    const sc = /^spellcasting_(class|ability|bonus|save|prepare):(.+)$/.exec(name);
    if (sc) {
      const v = get(name);
      if (v) (spellcasting.get(sc[2]) ?? spellcasting.set(sc[2], {}).get(sc[2])!)[sc[1]] = v;
      continue;
    }
    const sp = /^spells_(\d):(\d+)_:(.+)$/.exec(name);
    if (sp) {
      const v = get(name);
      const level = Number(sp[1]);
      const cls = sp[3].replace(/:\d+$/, '');
      const prepared = level === 0 || yes(x, `prepare_${sp[1]}:${sp[2]}_:${sp[3]}`);
      used.add(`prepare_${sp[1]}:${sp[2]}_:${sp[3]}`);
      if (!v) continue;
      // Aurora lists some spells twice (prepared list + full list): keep one entry, prepared wins.
      const key = `${cls}|${level}|${v.toLowerCase()}`;
      const prev = spells.get(key);
      if (prev) prev.prepared ||= prepared;
      else spells.set(key, { name: v, level, prepared, source: cls, field: name });
    }
  }
  for (const name of Object.keys(x.checkboxes ?? {})) {
    const sl = /^slot\d+_(\d):\d+_:/.exec(name); // slot<index>_<level>:…
    if (sl) {
      const lvl = Number(sl[1]);
      const s = slots.get(lvl) ?? { total: 0, used: 0 };
      s.total++;
      if (yes(x, name)) s.used++;
      slots.set(lvl, s);
    }
  }
  for (const [id, sc] of spellcasting) {
    const cls = sc.class ?? id.replace(/:\d+$/, '');
    const label = (l: string) => (spellcasting.size > 1 ? `${l} (${cls})` : l);
    if (sc.class) rec({ key: `sc:${id}:class`, group: 'spells', kind: 'spellcasting', label: label('Spellcasting class'), value: sc.class, source: `spellcasting_class:${id}` });
    if (sc.ability) rec({ key: `sc:${id}:ability`, group: 'spells', kind: 'spellcasting', label: label('Spellcasting ability'), value: sc.ability, source: `spellcasting_ability:${id}` });
    if (sc.bonus) rec({ key: `sc:${id}:bonus`, group: 'spells', kind: 'spellcasting', label: label('Spell attack bonus'), value: sc.bonus, source: `spellcasting_bonus:${id}` });
    if (sc.save) rec({ key: `sc:${id}:save`, group: 'spells', kind: 'spellcasting', label: label('Spell save DC'), value: sc.save, source: `spellcasting_save:${id}` });
    if (sc.prepare) rec({ key: `sc:${id}:prepare`, group: 'spells', kind: 'spellcasting', label: label('Spells to prepare'), value: sc.prepare, source: `spellcasting_prepare:${id}` });
  }
  for (const [lvl, s] of [...slots].sort((a, b) => a[0] - b[0])) {
    rec({ key: `slots:${lvl}`, group: 'spells', kind: 'resource', label: `Spell slots (level ${lvl})`, value: String(s.total - s.used), modifier: String(s.total), source: `slot${lvl}_* (${s.total} checkboxes)` });
  }
  const sorted = [...spells.values()].sort((a, b) => a.level - b.level || Number(b.prepared) - Number(a.prepared) || a.name.localeCompare(b.name));
  for (const s of sorted) {
    rec({ key: `spell:${s.source}:${s.level}:${s.name}`, group: 'spells', kind: 'spell', label: s.name, value: s.name, level: s.level, prepared: s.prepared, spellSource: s.source, source: s.field });
  }
  for (const name of Object.keys(x.checkboxes ?? {})) if (/^(prepare|slot)\d?_/.test(name)) used.add(name);

  // ---------------- equipment & inventory
  const items = new Map<string, { name: string; quantity: number; equipped: boolean; field: string }>();
  for (const list of ['gear', 'magic_gear', 'valuable']) {
    for (let i = 0; i < 60; i++) {
      const raw = get(`equipment_page_${list}_name.${i}`);
      const count = get(`equipment_page_${list}_count.${i}`);
      get(`equipment_page_${list}_weight.${i}`);
      if (!raw) continue;
      const equipped = /^\[.*\]$/.test(raw); // Aurora brackets equipped items: "[Breastplate]"
      const name = raw.replace(/^\[(.*)\]$/, '$1').trim();
      const quantity = count && /^\d+$/.test(count) ? Number(count) : 1;
      const key = name.toLowerCase();
      const prev = items.get(key);
      if (prev) prev.quantity += quantity;
      else items.set(key, { name, quantity, equipped, field: `equipment_page_${list}_name.${i}` });
    }
    get(`equipment_page_${list}_name`);
    get(`equipment_page_${list}_count`);
    get(`equipment_page_${list}_weight`);
  }
  for (const it of items.values()) {
    rec({ key: `item:${it.name}`, group: 'equipment', kind: 'item', label: it.name, value: it.name, quantity: it.quantity, equipped: it.equipped, source: it.field, note: it.equipped ? 'Equipped' : undefined });
  }
  for (const [c, label] of COINS) {
    const v = get(`equipment_page_coins_${c}`);
    if (v && v !== '0') rec({ key: `coin:${c}`, group: 'equipment', kind: 'resource', label, value: v, status: /^\d+$/.test(v) ? 'recognized' : 'uncertain', source: `equipment_page_coins_${c}` });
  }
  for (const [f, label] of [
    ['equipment_page_weight_carried', 'Weight carried'],
    ['equipment_page_weight_capacity', 'Carrying capacity'],
  ] as const) {
    const v = get(f);
    if (v) rec({ key: f, group: 'equipment', kind: 'combat', label, value: v, source: f });
  }
  const att = get('equipment_page_attunement_current');
  const attMax = get('equipment_page_attunement_max');
  if (att && attMax) rec({ key: 'attunement', group: 'equipment', kind: 'resource', label: 'Attuned magic items', value: att, modifier: attMax, source: 'equipment_page_attunement_current' });
  get('equipment_page_weight_drag');
  for (const [f, label] of [
    ['equipment_page_quest_items', 'Quest items & trinkets'],
    ['equipment_page_additional_treasure', 'Additional treasure'],
  ] as const) {
    const v = get(f);
    if (v) rec({ key: f, group: 'equipment', kind: 'note', label, value: v, source: f });
  }

  // ---------------- background & notes
  const story = get('background_story');
  if (story) rec({ key: 'story', group: 'background', kind: 'note', label: 'Background story', value: story, source: 'background_story' });
  const bgFeature = get('background_feature_name');
  if (bgFeature) rec({ key: 'bgfeature', group: 'features', kind: 'feature', label: `Background feature: ${bgFeature}`, value: bgFeature, source: 'background_feature_name' });
  for (const [f, label] of [
    ['background_allies', 'Allies & organizations'],
    ['background_organization_name', 'Organization'],
  ] as const) {
    const v = get(f);
    if (v) rec({ key: f, group: 'background', kind: 'note', label, value: v, source: f });
  }
  const addl = get('background_additional_features');
  if (addl) rec({ key: 'addl', group: 'features', kind: 'feature', label: 'Additional features', value: addl, source: 'background_additional_features' });

  // ---------------- features & traits (printed text block on page 1)
  for (const f of parseFeatureBlock(x.pageTexts?.[0] ?? '')) rows.push(f);

  // ---------------- advanced: meaningful leftovers
  for (const [name, v0] of Object.entries(x.fields)) {
    if (used.has(name) || IGNORED.some((re) => re.test(name))) continue;
    const v = clean(v0);
    if (!v || /^#\d+$/.test(v)) continue;
    rows.push(row({ key: `raw:${name}`, group: 'raw', kind: 'raw', label: name.slice(0, 80), value: v.slice(0, 2000), status: 'unrecognized', source: name, note: 'Not part of the character sheet. Tick to keep it in the Advanced section.' }));
  }
  return rows;
}

const PROFICIENCY_TITLES = /^(Armor Proficiencies|Weapon Proficiencies|Tool Proficiencies|Languages|Skill Proficiencies|Saving Throws)$/;

/**
 * Aurora prints features as paragraphs "Title. Description…" (wrapped over several lines) after the
 * last label of page 1. Proficiency lines are combined into one "Proficiencies & languages" entry.
 */
export function parseFeatureBlock(page1: string): ImportRow[] {
  const lines = page1.split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /^(Armor Proficiencies|Weapon Proficiencies|Tool Proficiencies|Languages)\.\s/.test(l));
  if (start < 0) return [];
  const paras: Array<{ title: string; text: string }> = [];
  for (const l of lines.slice(start)) {
    if (!l) continue;
    const m = /^([A-Z][A-Za-z’'()\-/ ]{1,48}?)\.\s+(.*)$/.exec(l);
    if (m && !/\b(the|a|an|and|or|you|your|of|to)$/i.test(m[1])) paras.push({ title: m[1], text: m[2] });
    else if (paras.length) paras[paras.length - 1].text += (paras[paras.length - 1].text.endsWith('-') ? '' : ' ') + l;
  }
  const rows: ImportRow[] = [];
  const prof = paras.filter((p) => PROFICIENCY_TITLES.test(p.title));
  if (prof.length) {
    rows.push(
      row({
        key: 'feat:proficiencies',
        group: 'features',
        kind: 'feature',
        label: 'Proficiencies & languages',
        value: prof.map((p) => `${p.title}: ${p.text}`).join('\n'),
        status: 'uncertain',
        source: 'page 1 – Proficiencies & Languages',
        note: 'Read from the printed text – please check.',
      }),
    );
  }
  for (const p of paras.filter((q) => !PROFICIENCY_TITLES.test(q.title))) {
    rows.push(row({ key: `feat:${p.title}`, group: 'features', kind: 'feature', label: p.title, value: p.text.trim(), status: 'uncertain', source: 'page 1 – Features & Traits', note: 'Read from the printed text – please check.' }));
  }
  return rows;
}
