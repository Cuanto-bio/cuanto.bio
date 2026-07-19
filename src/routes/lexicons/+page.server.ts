import dagre from '@dagrejs/dagre';
import { loadUserHandle } from '$lib/server/user';
import type { PageServerLoad } from './$types';
import { authors, type EntityMeta, relationships, surveyors } from './graph';

// A lexicon property, as it appears in the raw lexicon JSON. Only the parts we
// need to render a field's name and a readable type are modeled here.
type LexProp = {
  type: string;
  format?: string;
  ref?: string;
  refs?: string[];
  items?: LexProp;
};

// A record's `record` block or a standalone object def; both carry properties.
type LexObject = {
  description?: string;
  required?: string[];
  properties?: Record<string, LexProp>;
};

type LexDef = LexObject & {
  type?: string;
  record?: LexObject;
};

type LexDoc = {
  id: string;
  defs: Record<string, LexDef>;
};

export type FieldInfo = { name: string; type: string; required: boolean };
export type SubDef = { name: string; purpose: string; fields: FieldInfo[] };
export type LexInfo = {
  purpose: string;
  fields: FieldInfo[];
  subdefs: SubDef[];
};

// Index every lexicon JSON by its NSID so an entity can be looked up by id.
// import.meta.glob keeps these on the server; only the small extracted result
// below is serialized to the client.
const modules = import.meta.glob<{ default: LexDoc }>('/lexicons/**/*.json', {
  eager: true,
});
const byId = new Map<string, LexDoc>();
for (const mod of Object.values(modules)) {
  const doc = mod.default;
  if (doc?.id) byId.set(doc.id, doc);
}

// Last segment of an NSID or local ref, e.g. "com.atproto.repo.strongRef" ->
// "strongRef", "#track" -> "track", "org.atgeo.place" -> "place".
function refName(ref: string): string {
  return ref.split(/[.#]/).pop() || ref;
}

// A readable type label for a lexicon property, staying close to the lexicon's
// own vocabulary (format, ref target, union members).
function describeType(prop: LexProp): string {
  switch (prop.type) {
    case 'string':
      return prop.format ?? 'string';
    case 'ref':
      return prop.ref ? refName(prop.ref) : 'ref';
    case 'union':
      return (prop.refs ?? []).map(refName).join(' | ') || 'union';
    case 'array': {
      const inner = prop.items ? describeType(prop.items) : 'unknown';
      return inner.includes(' ') ? `(${inner})[]` : `${inner}[]`;
    }
    default:
      return prop.type;
  }
}

function fieldsOf(obj?: LexObject): FieldInfo[] {
  const required = new Set(obj?.required ?? []);
  return Object.entries(obj?.properties ?? {}).map(([name, prop]) => ({
    name,
    type: describeType(prop),
    required: required.has(name),
  }));
}

function extract(doc: LexDoc): LexInfo {
  const main = doc.defs?.main;
  // Object defs besides `main`, e.g. the taxon/verbatim members a scope is a
  // union of. Described on the page under their parent record.
  const subdefs: SubDef[] = [];
  for (const [name, def] of Object.entries(doc.defs ?? {})) {
    if (name === 'main' || def.type !== 'object' || !def.properties) continue;
    subdefs.push({
      name,
      purpose: def.description ?? '',
      fields: fieldsOf(def),
    });
  }
  return {
    purpose: main?.description ?? '',
    fields: fieldsOf(main?.record),
    subdefs,
  };
}

// --- Diagram layout (dagre) --------------------------------------------------
// dagre computes a top-to-bottom layered layout from the graph in ./graph; we
// only style the result. It runs here on the server, so dagre never reaches the
// client bundle: the load returns plain coordinates and path strings.

type Role = 'author' | 'surveyor';
type Pt = { x: number; y: number };
export type LaidNode = {
  name: string;
  shared: boolean;
  role: Role;
  x: number;
  y: number;
  w: number;
};
export type LaidEdge = {
  key: string;
  d: string;
  label: string;
  labelX: number;
  labelY: number;
  markerStart: boolean;
  markerEnd: boolean;
};
export type Layout = {
  width: number;
  height: number;
  dividerY: number;
  nodes: LaidNode[];
  edges: LaidEdge[];
};

const NODE_H = 56;

// Node boxes are sized to their own text rather than to a fixed width, which is
// what lets the whole diagram fit a phone screen: a uniform box has to be as
// wide as "ProtocolTarget", so "Follow" wasted ~100px and the widest rank set
// the width of everything. We can't measure text on the server, so these are
// per-character advances for the two fonts the diagram uses, checked against
// canvas measureText in a browser.
//
// Both sublabels and edge labels are ui-monospace, so their advance is exact.
const SUB_CHAR_W = 6.02; // 10px monospace
const LABEL_CHAR_W = 6.62; // 11px monospace

// Node names are Nunito 600 13px, which is proportional, so this approximates by
// character class. It runs ~5-8% under the real advance, so the result is padded
// by NAME_FUDGE; the SVG centers each label in its box, which keeps any residual
// error symmetric and invisible.
const NAME_NARROW = new Set("ijlt.,!'");
const NAME_WIDE = new Set('mwMW');
const NAME_FUDGE = 1.08;

function nameWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (NAME_NARROW.has(ch)) w += 3.8;
    else if (NAME_WIDE.has(ch)) w += 9.0;
    else if (ch !== ch.toLowerCase()) w += 8.2;
    else w += 6.1;
  }
  return w * NAME_FUDGE;
}

// Wide enough for the display name and the "cuanto"/"lexicons.bio" sublabel
// under it. The shared nodes are usually pinned by the sublabel, not the name.
function nodeWidth(n: EntityMeta, padX: number): number {
  const sub = (n.shared ? 'lexicons.bio' : 'cuanto').length * SUB_CHAR_W;
  return Math.ceil(Math.max(nameWidth(n.name), sub) + padX * 2);
}

// The two diagrams the page renders. Same graph and the same dagre pass, just
// tuned differently: `compact` has to fit a phone, so it trades away the breathing
// room and uses each relationship's terser `compactLabel`, while `wide` gets the
// roomier spacing and the fuller labels that read better on a big screen.
type LayoutOpts = {
  padX: number;
  nodesep: number;
  ranksep: number;
  edgesep: number;
  marginx: number;
  marginy: number;
  compact: boolean;
};

const COMPACT_OPTS: LayoutOpts = {
  padX: 12,
  nodesep: 20,
  ranksep: 46,
  edgesep: 12,
  marginx: 14,
  marginy: 22,
  compact: true,
};

const WIDE_OPTS: LayoutOpts = {
  padX: 22,
  nodesep: 46,
  ranksep: 58,
  edgesep: 18,
  marginx: 22,
  marginy: 26,
  compact: false,
};

// A Catmull-Rom spline through dagre's routed points, emitted as cubic beziers.
function smoothPath(p: Pt[]): string {
  if (p.length === 0) return '';
  let d = `M${p[0].x},${p[0].y}`;
  if (p.length === 2) return `${d} L${p[1].x},${p[1].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function computeLayout(o: LayoutOpts): Layout {
  const roleOf = new Map<string, Role>();
  for (const a of authors) roleOf.set(a.name, 'author');
  for (const s of surveyors) roleOf.set(s.name, 'surveyor');

  // Vertical order is a role property, independent of which way each reference
  // points: authors sit above surveyors, and within a band the array order wins.
  // Edges are laid out top-to-bottom by this order (so the bands stay put no
  // matter how a relationship is authored) while the arrowhead is drawn in the
  // reference's real direction.
  const orderOf = new Map<string, number>();
  authors.forEach((n, i) => {
    orderOf.set(n.name, i);
  });
  surveyors.forEach((n, i) => {
    orderOf.set(n.name, 1000 + i);
  });
  const order = (name: string) => orderOf.get(name) ?? 0;

  // One line per relationship, laid out top-to-bottom by node order; the arrow
  // head goes on whichever end the reference actually points to. Two records
  // that reference each other therefore get two separate lines.
  type Drawn = {
    field: string;
    src: string;
    dst: string;
    up: boolean;
    label?: string;
  };
  const drawn: Drawn[] = relationships.map((r) => {
    const up = order(r.from) > order(r.to); // reference points up the bands
    const [src, dst] = up ? [r.to, r.from] : [r.from, r.to];
    const label = o.compact ? (r.compactLabel ?? r.label) : r.label;
    return { field: r.field, src, dst, up, label };
  });

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: 'TB',
    nodesep: o.nodesep,
    ranksep: o.ranksep,
    edgesep: o.edgesep,
    marginx: o.marginx,
    marginy: o.marginy,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const widthOf = new Map<string, number>();
  for (const n of [...authors, ...surveyors]) {
    const w = nodeWidth(n, o.padX);
    widthOf.set(n.name, w);
    g.setNode(n.name, { width: w, height: NODE_H });
  }
  for (const e of drawn) {
    g.setEdge(
      e.src,
      e.dst,
      e.label
        ? {
            label: e.label,
            width: Math.max(30, Math.ceil(e.label.length * LABEL_CHAR_W)),
            height: 16,
            labelpos: 'c',
          }
        : {},
      e.field,
    );
  }

  // Force every author above every surveyor so the lanes read as two bands: add
  // an invisible edge from each author to each surveyor "root" (a surveyor with
  // no surveyor above it) where no real edge already exists.
  const surveyorSet = new Set(surveyors.map((s) => s.name));
  const hasSurveyorParent = new Set<string>();
  const connected = new Set<string>();
  for (const e of drawn) {
    connected.add(`${e.src}::${e.dst}`);
    if (surveyorSet.has(e.src) && surveyorSet.has(e.dst))
      hasSurveyorParent.add(e.dst);
  }
  for (const a of authors) {
    for (const s of surveyors) {
      if (
        !hasSurveyorParent.has(s.name) &&
        !connected.has(`${a.name}::${s.name}`)
      ) {
        g.setEdge(a.name, s.name, { weight: 0 }, `__band_${a.name}_${s.name}`);
      }
    }
  }

  dagre.layout(g);

  const nodes: LaidNode[] = [...authors, ...surveyors].map((n) => {
    const gn = g.node(n.name);
    const w = widthOf.get(n.name) ?? 0;
    return {
      name: n.name,
      shared: !!n.shared,
      role: roleOf.get(n.name) ?? 'surveyor',
      x: (gn.x ?? 0) - w / 2,
      y: (gn.y ?? 0) - NODE_H / 2,
      w,
    };
  });

  const edges: LaidEdge[] = drawn.map((e) => {
    const ge = g.edge(e.src, e.dst, e.field);
    return {
      key: e.field,
      d: smoothPath(ge.points ?? []),
      label: e.label ?? '',
      labelX: ge.x ?? 0,
      labelY: ge.y ?? 0,
      markerStart: e.up,
      markerEnd: !e.up,
    };
  });

  const graph = g.graph();
  const authorNodes = nodes.filter((n) => n.role === 'author');
  const surveyorNodes = nodes.filter((n) => n.role === 'surveyor');
  const dividerY =
    (Math.max(...authorNodes.map((n) => n.y + NODE_H)) +
      Math.min(...surveyorNodes.map((n) => n.y))) /
    2;

  return {
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    dividerY,
    nodes,
    edges,
  };
}

// Both run once at module load, not per request.
const layouts = {
  compact: computeLayout(COMPACT_OPTS),
  wide: computeLayout(WIDE_OPTS),
};

export const load: PageServerLoad = async ({ locals }) => {
  const lexicons: Record<string, LexInfo> = {};
  for (const [id, doc] of byId) {
    if (doc.defs?.main?.record) lexicons[id] = extract(doc);
  }
  return { ...(await loadUserHandle(locals.did)), lexicons, layouts };
};
