/**
 * APEX 2.9 – which creature model a name stands for (shared by the 3D kit and the server, which names creatures by
 * what they look like). Pure: no 3D code.
 */
import { DRAGON_TINTS } from './creatures.js';

export type CreatureVariant = 'male' | 'female' | 'young';
const DRAGON_COLOURS = DRAGON_TINTS;

/**
 * Name / type → model id, tint and variant (null: not a creature model – humanoid figure or the old miniature).
 * APEX 2.3: English and German names and synonyms; young / female words pick a variant; exceptions first (a wolf
 * spider is a spider, a werewolf stays a humanoid figure).
 */
export function creatureFor(text: string): { kind: string; tint?: string; variant?: CreatureVariant } | null {
  const t = ` ${text.toLowerCase().replace(/[-_]/g, ' ')} `;
  if (/\bwere ?(wolf|rat|bear|boar|tiger|wölf)|\bwerwolf|lykanthrop/.test(t)) return null;
  const variant: CreatureVariant | undefined = /\b(cub|pup|puppy|kitten|calf|lamb|foal|fawn|piglet|kid|chick|duckling|hatchling|wyrmling|young|baby|juvenile|welpe|junges|kalb|lamm|fohlen|kitz|ferkel|küken|jung)\b/.test(t) ? 'young'
    : /\b(female|she|lioness|doe|hind|cow|ewe|sow|mare|vixen|hen|weibchen|löwin|hirschkuh|bärin|wölfin|stute|sau|henne|kuh|ricke|fähe)\b/.test(t) ? 'female' : undefined;
  const dragonTint = () => { for (const c of DRAGON_COLOURS) if (t.includes(c)) return c; const de: Record<string, string> = { rot: 'red', blau: 'blue', grün: 'green', schwarz: 'black', weiß: 'white', weiss: 'white', gold: 'gold', silber: 'silver', bronze: 'bronze', kupfer: 'copper', messing: 'brass', schatten: 'shadow', fee: 'fairy' }; for (const [k, v] of Object.entries(de)) if (t.includes(k)) return v; return undefined; };
  const rules: Array<[RegExp, string, (() => string | undefined)?]> = [
    // exceptions and compound names first
    [/wolf spider|phase spider|wolfsspinne|phasenspinne/, 'spider', () => (/phase|phasen/.test(t) ? '#8a6ad8' : undefined)],
    [/dracolich|bone dragon|skeletal dragon|knochendrache|skelettdrache/, 'bonedragon'], [/winter wolf|frost wolf|frostwolf|eiswolf/, 'winterwolf'], [/spectral wolf|ghost wolf|geisterwolf|shadow wolf|schattenwolf/, 'ghostwolf'],
    [/spectral stag|silver stag|ghost stag|geisterhirsch|silberhirsch/, 'spectralstag'], [/displacer/, 'displacer'], [/blink dog|blinkhund/, 'blinkdog'], [/jackalope|wolpertinger/, 'jackalope'], [/moon ?hare|mondhase/, 'moonhare'],
    [/kitsune|nine.?tailed|neunschwänzig/, 'kitsune'], [/fire fox|feuerfuchs|flame fox/, 'firefox'], [/cockatrice/, 'cockatrice'], [/phoenix|phönix/, 'phoenix'], [/thunderbird|donnervogel|storm eagle/, 'thunderbird'],
    [/cerberus|kerberos|three headed (dog|hound)|dreiköpfig/, 'cerberus'], [/chimera|chimäre/, 'chimera'], [/bulette/, 'bulette'], [/ankheg/, 'ankheg'], [/carrion crawler|aaskriecher/, 'carrioncrawler'], [/umber hulk/, 'umberhulk'],
    [/roper|piercer/, 'roper'], [/darkmantle/, 'darkmantle'], [/sea serpent|seeschlange|meeresschlange/, 'seaserpent'], [/jellyfish|qualle/, 'jellyfish'], [/kraken|krake/, 'kraken'],
    [/grell/, 'grell'], [/intellect devourer/, 'devourer'], [/flumph/, 'flumph'], [/gazer|spectator/, 'gazer'], [/nothic/, 'nothic'], [/cloaker/, 'cloaker'], [/slaad/, 'slaad'],
    [/myconid|walking mushroom|wandelnder pilz|pilzwesen/, 'myconid'], [/glowing mushroom|leuchtpilz|pilzkoloss/, 'glowshroom'], [/carnivorous|man ?eating plant|fleischfressend|flytrap/, 'flytrap'],
    [/world turtle|weltenschildkröte|dragon turtle/, 'worldturtle'], [/sky whale|himmelswal|leviathan|\bwhale\b|\bwal\b/, 'skywhale'], [/colossus|koloss|titan/, 'colossus'],
    [/skeletal (horse|steed)|skelettpferd|knochenpferd/, 'skelhorse'],
    [/wyvern|lindwurm/, 'wyvern'], [/\bdrake\b|drache ohne flügel/, 'drake'],
    [/dragon|wyrm|drache|drachen/, 'dragon', dragonTint],
    [/beholder|eye tyrant|betrachter|gauth/, 'beholder'], [/aboleth/, 'aboleth'], [/otyugh|neogi/, 'otyugh'], [/gibbering|mouther/, 'mouther'], [/octopus|squid|oktopus|tintenfisch/, 'octopus'],
    [/owlbear|eulenbär/, 'owlbear'], [/hippogriff|hippogreif/, 'hippogriff'], [/griff|greif/, 'griffon'], [/pegasus/, 'pegasus'], [/unicorn|einhorn/, 'unicorn'], [/nightmare|nachtmahr/, 'nightmare'],
    [/manticore|mantikor/, 'manticore'], [/hydra/, 'hydra'], [/basilisk/, 'basilisk'], [/purple worm|remorhaz|purpurwurm|\bworm\b|sandwurm|wurm\b/, 'worm'], [/mimic|mimik/, 'mimic'], [/rust monster|rostmonster/, 'rustmonster'],
    [/minotaur/, 'minotaur'], [/yeti|abominable/, 'yeti'], [/hell ?hound|barghest|höllenhund/, 'hellhound'],
    [/gelatinous cube|gallertwürfel/, 'cube'], [/ooze|slime|pudding|jelly|schleim/, 'ooze', () => (/black|schwarz/.test(t) ? '#1e1e24' : /ochre|yellow|gelb/.test(t) ? '#c8a030' : /gray|grey|grau/.test(t) ? '#7a7a70' : /red|rot/.test(t) ? '#b3261e' : /blue|blau/.test(t) ? '#2d6fb0' : undefined)],
    [/fire elemental|salamander|magmin|feuerelementar/, 'fire'], [/water elemental|water weird|wasserelementar/, 'water'], [/air elemental|invisible stalker|luftelementar/, 'air'], [/earth elemental|galeb|xorn|erdelementar/, 'earth'], [/will ?o|wisp|irrlicht/, 'wisp'],
    [/gargoyle|gargyl/, 'gargoyle'], [/golem|construct|animated statue|shield guardian|konstrukt/, 'golem', () => (/iron|eisen/.test(t) ? '#5a5f68' : /clay|lehm|ton/.test(t) ? '#a0704a' : /flesh|fleisch/.test(t) ? '#b88a7a' : /crystal|kristall/.test(t) ? '#8ad8ff' : undefined)],
    [/treant|awakened tree|baumhirte|baumwächter/, 'treant'], [/shambling|blight|sumpfhügel/, 'shambling'],
    [/ghost|specter|spectre|wraith|banshee|poltergeist|phantom|\bshade\b|geist|gespenst/, 'ghost', () => (/wraith|specter|spectre|shade|schatten/.test(t) ? '#4a4a5a' : undefined)],
    [/demon|devil|balor|vrock|hezrou|glabrezu|pit fiend|barbed|horned devil|fiend|dämon|teufel/, 'demon'],
    [/warhorse|destrier|charger|schlachtross|kriegspferd/, 'warhorse'], [/donkey|esel/, 'donkey'], [/pony|mule|maultier/, 'pony'], [/horse|stallion|mare|steed|pferd|hengst|stute/, 'horse'], [/camel|kamel|dromedar/, 'camel'], [/llama|alpaca|lama|alpaka/, 'llama'], [/worg|warg|dire wolf|schreckenswolf/, 'wardog'],
    [/\broc\b|giant eagle|riesenadler/, 'roc'], [/wolf|wölf/, 'wolf'], [/hyena|hyäne|gnoll pack/, 'hyena'], [/fox|fuchs/, 'fox'], [/jackal|\bdog\b|hound|mastiff|hund|schakal/, 'dog'],
    [/polar bear|eisbär/, 'polarbear'], [/bear|bär/, 'bear'], [/boar|keiler|wildschwein/, 'boar'], [/\bpig|piglet|sow|schwein|ferkel|\bsau\b/, 'pig'],
    [/elk|deer|stag|moose|antelope|hirsch|reh\b|elch|rentier/, 'deer'], [/billy goat|ziegenbock/, 'billygoat'], [/goat|ziege/, 'goat'], [/sheep|\bram\b|lamb|ewe|schaf|widder|lamm/, 'sheep'],
    [/bison|buffalo|yak|wisent|büffel/, 'bison'], [/\bcow\b|\bcalf\b|cattle|kuh|rind|kalb/, 'cow'], [/\box\b|bull\b|aurochs|ochse|stier/, 'ox'],
    [/rhino|nashorn/, 'rhino'], [/hippo|nilpferd|flusspferd/, 'hippo'], [/giraffe/, 'giraffe'], [/zebra/, 'zebra'],
    [/tiger/, 'tiger'], [/panther|leopard|jaguar|puma|lynx|luchs/, 'panther'], [/lion|sabre|saber|big cat|löwe|lowe\b/, 'cat'], [/house ?cat|kitten|hauskatze|kätzchen|\bkatze\b|\bcat\b/, 'housecat'],
    [/rabbit|hare|bunny|hase|kaninchen/, 'rabbit'], [/squirrel|eichhörnchen/, 'squirrel'], [/hedgehog|igel/, 'hedgehog'], [/badger|dachs|wolverine|vielfraß/, 'badger'],
    [/\brat\b|weasel|ratte|wiesel/, 'rat'], [/crocodile|alligator|krokodil/, 'crocodile'], [/lizard|iguana|echse|waran/, 'lizard'], [/turtle|tortoise|schildkröte/, 'turtle'], [/snail|schnecke/, 'snail'],
    [/mammoth|mammut/, 'mammoth'], [/elephant|elefant/, 'elephant'], [/\bape\b|gorilla|baboon|affe/, 'ape'], [/frog|toad|frosch|kröte/, 'frog'], [/shark|\bhai\b/, 'shark'], [/fish|eel|fisch|\baal\b/, 'fish'],
    [/cobra|viper|asp\b|kobra/, 'cobra'], [/snake|serpent|constrictor|python|naga|schlange/, 'snake'],
    [/spider|ettercap|spinne/, 'spider'], [/scorpion|skorpion/, 'scorpion'], [/centipede|tausendfüß|hundertfüß/, 'centipede'], [/beetle|käfer/, 'beetle'], [/crab|krabbe|hummer/, 'crab'],
    [/butterfly|moth|schmetterling|falter|motte/, 'butterfly'],
    [/chicken|rooster|\bhen\b|huhn|hahn|henne|küken/, 'chicken'], [/duck|goose|ente|gans/, 'duck'], [/swan|schwan/, 'swan'],
    [/eagle|hawk|falcon|bird|blood hawk|adler|falke|habicht|vogel/, 'eagle'], [/owl\b|eule|uhu/, 'owl'], [/raven|crow|rabe|krähe/, 'raven'], [/vulture|buzzard|geier/, 'vulture'], [/\bbat\b|bats\b|fledermaus/, 'bat'],
    // type fallbacks (stat block type)
    [/\bdragon\b/, 'dragon'], [/aberration/, 'mouther'], [/\booze\b/, 'ooze'], [/elemental/, 'earth'], [/construct/, 'golem'], [/\bplant\b/, 'shambling'],
  ];
  for (const [re, kind, tintFn] of rules) if (re.test(t)) { const ti = tintFn?.(); return { kind, ...(ti ? { tint: ti } : {}), ...(variant ? { variant } : {}) }; }
  return null;
}
