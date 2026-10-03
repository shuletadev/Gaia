import { useEffect, useMemo, useRef, useState } from "react";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk.bundled.js";
import { api } from "../api.ts";
import { iconSlugFor } from "../iconMap.ts";
import { typeLabel } from "../format.ts";
import { Btn } from "./ui.tsx";
import { IconX } from "./Icons.tsx";
import type { EdgeKind, Topology } from "../../../server/topology.ts";

const NODE_W = 230;
const NODE_H = 58;

interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "vnet" | "subnet" | "node";
}

interface Laid {
  width: number;
  height: number;
  boxes: Map<string, Placed>;
  edges: { id: string; kind: EdgeKind; label?: string; points: { x: number; y: number }[]; labelPos?: { x: number; y: number } }[];
  loose?: { x: number; y: number; count: number };
}

function palette(dark: boolean) {
  return dark
    ? { bg: "#0c0d10", text: "#e7e5e4", muted: "#a8a29e", node: "#17181c", nodeStroke: "#2e2f35", vnet: "rgba(61,214,176,0.06)", vnetStroke: "rgba(61,214,176,0.45)", subnet: "rgba(255,255,255,0.025)", subnetStroke: "#3a3b41", ext: "#57534e" }
    : { bg: "#f5f5f4", text: "#1c1917", muted: "#78716c", node: "#ffffff", nodeStroke: "#d6d3d1", vnet: "rgba(61,214,176,0.08)", vnetStroke: "rgba(13,148,136,0.5)", subnet: "rgba(0,0,0,0.02)", subnetStroke: "#c7c3bf", ext: "#a8a29e" };
}

const EDGE_STYLE: Record<EdgeKind, { color: string; dash?: string; width: number; label: string }> = {
  uses: { color: "#8b8a91", width: 1.3, label: "uses" },
  ip: { color: "#8b8a91", dash: "2 4", width: 1.3, label: "by IP / FQDN" },
  peering: { color: "#3dd6b0", dash: "8 5", width: 2.4, label: "peering" },
  "dns-link": { color: "#60a5fa", dash: "2 4", width: 1.8, label: "DNS zone link" },
  route: { color: "#ff6a3d", width: 2.2, label: "UDR next hop" },
  reserved: { color: "#fbbf24", dash: "5 4", width: 1.6, label: "reserved for" },
};

async function layout(t: Topology): Promise<Laid> {
  const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
  const elk = new ELK();
  const labelOf = (text?: string) => (text ? [{ text, width: text.length * 6.2 + 8, height: 14 }] : []);
  const leaf = (id: string): ElkNode => ({ id, width: NODE_W, height: NODE_H });
  const children: ElkNode[] = [];

  for (const v of t.vnets) {
    children.push({
      id: v.id,
      layoutOptions: { "elk.padding": "[top=46,left=18,bottom=18,right=18]", "elk.direction": "DOWN" },
      children: v.subnets.map((s) => {
        const inside = t.nodes.filter((n) => n.parent === s.id).map((n) => leaf(n.id));
        return {
          id: s.id,
          layoutOptions: { "elk.padding": `[top=${s.badges.length ? 54 : 38},left=14,bottom=14,right=14]` },
          ...(inside.length ? { children: inside } : { width: 230, height: s.badges.length ? 64 : 46 }),
        };
      }),
    });
  }
  // Resources with no links and no subnet go into a compact grid below the graph, so they don't
  // stretch the layered layout into one long column.
  const linked = new Set(t.edges.flatMap((e) => [e.from, e.to]));
  const looseIds = t.nodes.filter((n) => !n.parent && !linked.has(n.id)).map((n) => n.id);
  const loose = new Set(looseIds);
  for (const n of t.nodes.filter((x) => !x.parent && !loose.has(x.id))) children.push(leaf(n.id));

  const edges: ElkExtendedEdge[] = t.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to], labels: labelOf(e.label) }));
  const graph = (await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "70",
      "elk.spacing.edgeLabel": "4",
      "elk.edgeLabels.inline": "true",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children,
    edges,
  })) as ElkNode;

  const boxes = new Map<string, Placed>();
  const vnetIds = new Set(t.vnets.map((v) => v.id));
  const subnetIds = new Set(t.vnets.flatMap((v) => v.subnets.map((s) => s.id)));
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      boxes.set(c.id, { id: c.id, x, y, w: c.width ?? 0, h: c.height ?? 0, kind: vnetIds.has(c.id) ? "vnet" : subnetIds.has(c.id) ? "subnet" : "node" });
      walk(c, x, y);
    }
  };
  walk(graph, 0, 0);

  // Edge coordinates are relative to the edge's container, which ELK may move into a compound node.
  const offsets = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  for (const b of boxes.values()) offsets.set(b.id, { x: b.x, y: b.y });
  const outEdges: Laid["edges"] = [];
  const collect = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as (ElkExtendedEdge & { container?: string })[]) {
      const off = offsets.get(e.container ?? n.id) ?? { x: 0, y: 0 };
      const sec = e.sections?.[0];
      if (!sec) continue;
      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((pt) => ({ x: pt.x + off.x, y: pt.y + off.y }));
      const src = t.edges.find((x) => x.id === e.id)!;
      const lab = e.labels?.[0];
      outEdges.push({ id: e.id, kind: src.kind, label: src.label, points: pts, labelPos: lab && lab.x !== undefined ? { x: lab.x + off.x, y: (lab.y ?? 0) + off.y } : undefined });
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(graph);

  let width = graph.width ?? 800;
  let height = graph.height ?? 600;
  let looseInfo: Laid["loose"];
  if (looseIds.length) {
    const gap = 14;
    const top = (children.length ? height : 0) + 40;
    const cols = Math.max(2, Math.min(looseIds.length, Math.floor((Math.max(width, 1000) - 48 + gap) / (NODE_W + gap))));
    looseIds.forEach((id, i) => {
      boxes.set(id, { id, x: 24 + (i % cols) * (NODE_W + gap), y: top + Math.floor(i / cols) * (NODE_H + gap), w: NODE_W, h: NODE_H, kind: "node" });
    });
    looseInfo = { x: 24, y: top - 12, count: looseIds.length };
    width = Math.max(width, 48 + cols * (NODE_W + gap) - gap);
    height = top + Math.ceil(looseIds.length / cols) * (NODE_H + gap) + 24;
  }
  return { width, height, boxes, edges: outEdges, loose: looseInfo };
}

export function TopologyDialog({ resourceGroupId, title, onClose }: { resourceGroupId: string; title: string; onClose: () => void }) {
  const [topo, setTopo] = useState<Topology>();
  const [laid, setLaid] = useState<Laid>();
  const [error, setError] = useState<string>();
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string>();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number }>(undefined);
  const dark = document.documentElement.classList.contains("dark");
  const c = palette(dark);

  useEffect(() => {
    api<Topology>(`/api/topology?resourceGroupId=${encodeURIComponent(resourceGroupId)}`)
      .then(async (t) => {
        setTopo(t);
        const l = await layout(t);
        setLaid(l);
        const wrap = wrapRef.current?.getBoundingClientRect();
        if (wrap) {
          const k = Math.min(1.2, (wrap.width - 40) / l.width, (wrap.height - 40) / l.height);
          setView({ k, x: (wrap.width - l.width * k) / 2, y: (wrap.height - l.height * k) / 2 });
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [resourceGroupId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const nodeById = useMemo(() => new Map((topo?.nodes ?? []).map((n) => [n.id, n])), [topo]);
  const connected = useMemo(() => {
    if (!hover || !topo) return undefined;
    const set = new Set([hover]);
    for (const e of topo.edges) if (e.from === hover || e.to === hover) set.add(e.from).add(e.to);
    return set;
  }, [hover, topo]);

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.min(3, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
  };

  const exportSvg = async () => {
    const svg = svgRef.current!.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("viewBox", `0 0 ${laid!.width} ${laid!.height}`);
    svg.setAttribute("width", String(laid!.width));
    svg.setAttribute("height", String(laid!.height));
    svg.querySelector("g[data-view]")?.removeAttribute("transform");
    // Inline the icons so the file renders anywhere.
    const cache = new Map<string, string>();
    for (const img of [...svg.querySelectorAll("image")]) {
      const href = img.getAttribute("href")!;
      if (!cache.has(href)) {
        const text = await fetch(href).then((r) => (r.ok ? r.text() : "")).catch(() => "");
        cache.set(href, text ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}` : "");
      }
      if (cache.get(href)) img.setAttribute("href", cache.get(href)!);
    }
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title}-topology.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const dim = (id: string) => (connected && !connected.has(id) ? 0.25 : 1);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-100/95 backdrop-blur dark:bg-[#0c0d10]/95">
      <header className="flex items-center gap-3 border-b border-stone-300 px-6 py-3 dark:border-stone-800">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-stone-500">Topology</span>
        <span className="font-medium">{title}</span>
        {topo && <span className="text-xs text-stone-500">{topo.nodes.length + topo.vnets.length} resources · {topo.edges.length} links</span>}
        <div className="ml-auto flex items-center gap-1">
          <Btn onClick={() => laid && wrapRef.current && setView(() => { const w = wrapRef.current!.getBoundingClientRect(); const k = Math.min(1.2, (w.width - 40) / laid.width, (w.height - 40) / laid.height); return { k, x: (w.width - laid.width * k) / 2, y: (w.height - laid.height * k) / 2 }; })}>Fit</Btn>
          <Btn onClick={exportSvg} disabled={!laid}>Download SVG</Btn>
          <button onClick={onClose} className="rounded-full p-1.5 text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800" aria-label="Close">
            <IconX />
          </button>
        </div>
      </header>
      <div
        ref={wrapRef}
        className="relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y })}
        onPointerMove={(e) => drag.current && setView((v) => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y }))}
        onPointerUp={() => (drag.current = undefined)}
        onPointerLeave={() => (drag.current = undefined)}
      >
        {error && <p className="p-6 text-sm text-signal">{error}</p>}
        {!laid && !error && <div className="grid h-full place-items-center text-sm text-stone-500">Laying out…</div>}
        {laid && topo && (
          <svg ref={svgRef} width="100%" height="100%" style={{ fontFamily: "Segoe UI, system-ui, sans-serif" }}>
            <defs>
              {Object.entries(EDGE_STYLE).map(([k, s]) => (
                <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={s.color} />
                </marker>
              ))}
            </defs>
            <g data-view transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <rect x={0} y={0} width={laid.width} height={laid.height} fill={c.bg} opacity={0} />
              {laid.loose && (
                <g>
                  <line x1={laid.loose.x} x2={laid.width - 24} y1={laid.loose.y - 14} y2={laid.loose.y - 14} stroke={c.subnetStroke} strokeDasharray="3 4" />
                  <text x={laid.loose.x} y={laid.loose.y} fontSize={10} letterSpacing={2} fill={c.muted} fontFamily="Cascadia Code, Consolas, monospace">
                    NOT CONNECTED · {laid.loose.count}
                  </text>
                </g>
              )}
              {topo.vnets.map((v) => {
                const b = laid.boxes.get(v.id);
                if (!b) return null;
                return (
                  <g key={v.id} opacity={dim(v.id)} onPointerEnter={() => setHover(v.id)} onPointerLeave={() => setHover(undefined)}>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={16} fill={c.vnet} stroke={v.external ? c.ext : c.vnetStroke} strokeDasharray={v.external ? "6 4" : undefined} strokeWidth={1.4} />
                    <image href={`/azure-icons/${iconSlugFor("Microsoft.Network/virtualNetworks")}.svg`} x={b.x + 14} y={b.y + 12} width={22} height={22} />
                    <text x={b.x + 44} y={b.y + 22} fontSize={13} fontWeight={600} fill={c.text}>{v.name}</text>
                    <text x={b.x + 44} y={b.y + 36} fontSize={10} fill={c.muted} fontFamily="Cascadia Code, Consolas, monospace">{v.prefixes.join(", ")}{v.external ? " · other group" : ""}</text>
                    {v.subnets.map((s) => {
                      const sb = laid.boxes.get(s.id);
                      if (!sb) return null;
                      return (
                        <g key={s.id}>
                          <rect x={sb.x} y={sb.y} width={sb.w} height={sb.h} rx={10} fill={c.subnet} stroke={c.subnetStroke} strokeDasharray="4 3" />
                          <text x={sb.x + 12} y={sb.y + 18} fontSize={11} fontWeight={600} fill={c.text}>{s.name}</text>
                          <text x={sb.x + 12} y={sb.y + 31} fontSize={9.5} fill={c.muted} fontFamily="Cascadia Code, Consolas, monospace">{s.prefix}</text>
                          {s.badges.map((bd, i) => (
                            <g key={bd.label}>
                              <image href={`/azure-icons/${iconSlugFor(bd.type)}.svg`} x={sb.x + 12 + i * 110} y={sb.y + 37} width={12} height={12} />
                              <text x={sb.x + 28 + i * 110} y={sb.y + 47} fontSize={9.5} fill={c.muted}>{bd.label.length > 15 ? `${bd.label.slice(0, 14)}…` : bd.label}</text>
                            </g>
                          ))}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {laid.edges.map((e) => {
                const s = EDGE_STYLE[e.kind];
                const src = topo.edges.find((x) => x.id === e.id)!;
                const on = !connected || (connected.has(src.from) && connected.has(src.to));
                return (
                  <g key={e.id} opacity={on ? 1 : 0.12}>
                    <polyline points={e.points.map((pt) => `${pt.x},${pt.y}`).join(" ")} fill="none" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} markerEnd={e.kind === "peering" || e.kind === "dns-link" ? undefined : `url(#arrow-${e.kind})`} />
                    {e.label && e.labelPos && (
                      <text x={e.labelPos.x + 4} y={e.labelPos.y + 11} fontSize={9.5} fill={s.color} fontFamily="Cascadia Code, Consolas, monospace" style={{ paintOrder: "stroke" }} stroke={c.bg} strokeWidth={3}>
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {topo.nodes.map((n) => {
                const b = laid.boxes.get(n.id);
                if (!b) return null;
                const node = nodeById.get(n.id)!;
                const name = node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name;
                const sub = [typeLabel(node.type), node.sku].filter(Boolean).join(" · ");
                return (
                  <g key={n.id} opacity={dim(n.id)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(undefined)}>
                    <title>{`${node.name}\n${typeLabel(node.type)}${node.sku ? ` · ${node.sku}` : ""}${node.badges.length ? `\nIP ${node.badges.map((x) => x.label).join(", ")}` : ""}`}</title>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill={c.node} stroke={node.external ? c.ext : c.nodeStroke} strokeDasharray={node.external ? "5 4" : undefined} />
                    <image href={`/azure-icons/${iconSlugFor(node.type) ?? "Resource-Groups"}.svg`} x={b.x + 12} y={b.y + 15} width={28} height={28} />
                    <text x={b.x + 50} y={b.y + 24} fontSize={12} fontWeight={600} fill={c.text}>{name}</text>
                    <text x={b.x + 50} y={b.y + 39} fontSize={9.5} fill={c.muted}>{sub.length > 30 ? `${sub.slice(0, 29)}…` : sub}</text>
                    {node.badges.slice(0, 2).reduce<{ x: number; els: React.ReactNode[] }>((acc, bd) => {
                      acc.els.push(
                        <g key={bd.label}>
                          <image href={`/azure-icons/${iconSlugFor(bd.type)}.svg`} x={b.x + 50 + acc.x} y={b.y + 43} width={10} height={10} />
                          <text x={b.x + 63 + acc.x} y={b.y + 52} fontSize={8.5} fill={c.muted} fontFamily="Cascadia Code, Consolas, monospace">{bd.label}</text>
                        </g>,
                      );
                      acc.x += 20 + bd.label.length * 5.3;
                      return acc;
                    }, { x: 0, els: [] }).els}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="pointer-events-none absolute bottom-4 left-6 flex flex-wrap gap-3 rounded-xl bg-stone-100/90 px-3 py-2 text-[10px] text-stone-500 dark:bg-[#15161a]/90">
          {Object.entries(EDGE_STYLE).filter(([k]) => topo?.edges.some((e) => e.kind === k)).map(([k, s]) => (
            <span key={k} className="flex items-center gap-1.5">
              <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} /></svg>
              {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5"><svg width="16" height="10"><rect x="1" y="1" width="14" height="8" rx="2" fill="none" stroke={c.ext} strokeDasharray="3 2" /></svg>outside this group</span>
        </div>
      </div>
    </div>
  );
}
