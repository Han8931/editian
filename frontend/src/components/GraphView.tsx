import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import { Download, Maximize2, Minimize2, RefreshCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { CompareEntitiesResponse, EntityDiffStatus, SingleDocGraphData } from '../types'

interface GraphNode {
  id: string
  name: string
  type: string
  value_a?: string | null
  value_b?: string | null
  status?: EntityDiffStatus | 'none'
  mentions: number
  degree: number  // number of edges connected (computed in buildGraphData)
  para_indices_a: number[]
  para_indices_b: number[]
  x?: number
  y?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  label: string
  side: 'a' | 'b' | 'both'
}

interface Props {
  data: CompareEntitiesResponse | SingleDocGraphData
  onNodeClick?: (node: GraphNode) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isCompareData(d: CompareEntitiesResponse | SingleDocGraphData): d is CompareEntitiesResponse {
  return 'diff' in d
}

function toCompareResponse(d: CompareEntitiesResponse | SingleDocGraphData): CompareEntitiesResponse {
  if (isCompareData(d)) return d
  return {
    entities_a: d.entities,
    entities_b: [],
    relationships_a: d.relationships,
    relationships_b: [],
    diff: d.entities.map((e) => ({
      name: e.name, type: e.type,
      value_a: e.value, value_b: e.value,
      para_indices_a: e.para_indices, para_indices_b: [],
      status: 'unchanged' as EntityDiffStatus,
    })),
  }
}

// ── Visual constants ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Person:       '#7aa2f7',
  Organization: '#f7768e',
  Location:     '#9ece6a',
  Date:         '#e0af68',
  Number:       '#bb9af7',
  Product:      '#2ac3de',
  Concept:      '#737aa2',
}

const STATUS_STROKE: Record<string, string> = {
  changed:   '#e0af68',
  added:     '#9ece6a',
  removed:   '#f7768e',
  unchanged: '#414868',
  none:      '#414868',
}

const EDGE_COLORS: Record<string, string> = {
  a:    '#7aa2f7',
  b:    '#9ece6a',
  both: '#9aa5ce',
}

function nodeColor(n: GraphNode): string {
  return TYPE_COLORS[n.type] ?? '#737aa2'
}

function nodeRadius(n: GraphNode): number {
  return Math.max(3, Math.min(10, 3 + Math.sqrt(n.degree) * 1.5 + Math.sqrt(n.mentions) * 0.3))
}

// ── Graph data builder ─────────────────────────────────────────────────────

function buildGraphData(data: CompareEntitiesResponse): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>()

  for (const d of data.diff) {
    nodeMap.set(d.name.toLowerCase(), {
      id: d.name, name: d.name, type: d.type,
      value_a: d.value_a, value_b: d.value_b,
      status: d.status,
      mentions: (d.para_indices_a?.length ?? 0) + (d.para_indices_b?.length ?? 0),
      degree: 0,
      para_indices_a: d.para_indices_a ?? [],
      para_indices_b: d.para_indices_b ?? [],
    })
  }

  const linkMap = new Map<string, GraphLink>()

  function addLinks(rels: { source: string; target: string; label: string }[], side: 'a' | 'b') {
    for (const r of rels) {
      const srcKey = r.source.toLowerCase()
      const tgtKey = r.target.toLowerCase()
      if (!nodeMap.has(srcKey) || !nodeMap.has(tgtKey)) continue
      const edgeKey = `${srcKey}→${tgtKey}`
      const existing = linkMap.get(edgeKey)
      if (existing) {
        existing.side = 'both'
      } else {
        linkMap.set(edgeKey, {
          source: nodeMap.get(srcKey)!.id,
          target: nodeMap.get(tgtKey)!.id,
          label: r.label,
          side,
        })
      }
    }
  }

  addLinks(data.relationships_a ?? [], 'a')
  addLinks(data.relationships_b ?? [], 'b')

  // Compute degree
  for (const link of linkMap.values()) {
    const srcKey = (typeof link.source === 'string' ? link.source : link.source.id).toLowerCase()
    const tgtKey = (typeof link.target === 'string' ? link.target : link.target.id).toLowerCase()
    const sn = nodeMap.get(srcKey); if (sn) sn.degree++
    const tn = nodeMap.get(tgtKey); if (tn) tn.degree++
  }

  return { nodes: Array.from(nodeMap.values()), links: Array.from(linkMap.values()) }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GraphView({ data, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [size, setSize] = useState({ width: 600, height: 500 })
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const hoveredNodeRef = useRef<GraphNode | null>(null)
  const [expanded, setExpanded] = useState(false)
  const isSingleDoc = !isCompareData(data)
  const graphData = useMemo(() => buildGraphData(toCompareResponse(data)), [data])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // ── Node painter ──────────────────────────────────────────────────────────
  const paintNode = useCallback((node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode
    const x = n.x ?? 0
    const y = n.y ?? 0
    const r = nodeRadius(n)
    const color = nodeColor(n)
    const isHovered = hoveredNodeRef.current?.id === n.id

    // ── Glow (only when hovered or notable) ──
    if (isHovered) {
      const grd = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3)
      grd.addColorStop(0, color + '55')
      grd.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.arc(x, y, r * 3, 0, 2 * Math.PI)
      ctx.fillStyle = grd
      ctx.fill()
    }

    // ── Status ring (outer stroke) ──
    const ringColor = STATUS_STROKE[n.status ?? 'none'] ?? STATUS_STROKE['none']
    const ringWidth = isHovered ? 2.5 / globalScale : 2 / globalScale
    ctx.beginPath()
    ctx.arc(x, y, r + ringWidth, 0, 2 * Math.PI)
    ctx.fillStyle = ringColor
    ctx.fill()

    // ── Node body ──
    ctx.beginPath()
    ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = isHovered ? '#ffffff' : color
    ctx.fill()

    // ── Inner highlight (top-left shimmer) ──
    ctx.beginPath()
    ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.45, 0, 2 * Math.PI)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fill()

    // ── Label: show at medium zoom, fixed 11 px on screen ──
    const LABEL_SHOW_SCALE = 0.3
    if (globalScale >= LABEL_SHOW_SCALE || isHovered) {
      const screenFontSize = 11
      const fontSize = screenFontSize / globalScale
      ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`
      const label = n.name
      const tw = ctx.measureText(label).width
      const lx = x
      const ly = y + r + (4 / globalScale) + fontSize * 0.5

      // Pill background
      const pw = tw + (8 / globalScale)
      const ph = fontSize + (4 / globalScale)
      ctx.fillStyle = '#13131aee'
      ctx.beginPath()
      ctx.roundRect(lx - pw / 2, ly - ph / 2, pw, ph, ph / 2)
      ctx.fill()

      // Text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isHovered ? '#e0e4f6' : '#9aa5ce'
      ctx.fillText(label, lx, ly)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Link painter ──────────────────────────────────────────────────────────
  const paintLink = useCallback((link: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const l = link as GraphLink
    const src = l.source as GraphNode
    const tgt = l.target as GraphNode
    if (src.x == null || tgt.x == null) return

    const sx = src.x, sy = src.y ?? 0
    const tx = tgt.x, ty = tgt.y ?? 0
    const dx = tx - sx, dy = ty - sy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) return

    const ux = dx / dist, uy = dy / dist
    const srcR = nodeRadius(src)
    const tgtR = nodeRadius(tgt)

    // Arrow dimensions in world space
    const ARROW_LEN = 5 / globalScale
    const ARROW_HALF = 2.5 / globalScale
    const LINE_W = 1 / globalScale

    // Start & end points (node border, not center)
    const x1 = sx + ux * srcR
    const y1 = sy + uy * srcR
    const x2 = tx - ux * (tgtR + ARROW_LEN)  // stop before arrowhead
    const y2 = ty - uy * (tgtR + ARROW_LEN)

    const color = EDGE_COLORS[l.side] ?? EDGE_COLORS['both']
    const alpha = 0.75
    const hex2 = Math.round(alpha * 255).toString(16).padStart(2, '0')

    // ── Line ──
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = color + hex2
    ctx.lineWidth = LINE_W
    ctx.stroke()

    // ── Arrowhead ──
    const arrowTipX = tx - ux * tgtR
    const arrowTipY = ty - uy * tgtR
    const perpX = -uy, perpY = ux
    ctx.beginPath()
    ctx.moveTo(arrowTipX, arrowTipY)
    ctx.lineTo(arrowTipX - ux * ARROW_LEN + perpX * ARROW_HALF,
               arrowTipY - uy * ARROW_LEN + perpY * ARROW_HALF)
    ctx.lineTo(arrowTipX - ux * ARROW_LEN - perpX * ARROW_HALF,
               arrowTipY - uy * ARROW_LEN - perpY * ARROW_HALF)
    ctx.closePath()
    ctx.fillStyle = color + hex2
    ctx.fill()

    // ── Edge label (only when zoomed in) ──
    const LABEL_SHOW_SCALE = 0.8
    if (globalScale >= LABEL_SHOW_SCALE && l.label) {
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const fontSize = 10 / globalScale
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`
      const tw = ctx.measureText(l.label).width
      const pw = tw + 6 / globalScale
      const ph = fontSize + 4 / globalScale

      // Pill background
      ctx.fillStyle = '#1e2030ee'
      ctx.beginPath()
      ctx.roundRect(mx - pw / 2, my - ph / 2, pw, ph, ph / 2)
      ctx.fill()

      ctx.fillStyle = color + 'cc'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(l.label, mx, my)
    }
  }, [])

  // ── Controls ───────────────────────────────────────────────────────────────
  function zoomIn()  { graphRef.current?.zoom(1.6, 300) }
  function zoomOut() { graphRef.current?.zoom(0.65, 300) }
  function fitView() { graphRef.current?.zoomToFit(400, 48) }

  function exportPng() {
    const canvas = containerRef.current?.querySelector('canvas')
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'knowledge-graph.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className={`relative flex flex-col border border-[#2a2d3e] bg-[#1a1b26] overflow-hidden shadow-2xl ${expanded ? 'fixed inset-4 z-50 rounded-2xl' : 'h-full rounded-2xl'}`}>

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2d3e] bg-[#13131a]/90 backdrop-blur flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[11px] font-bold text-[#7aa2f7] tracking-widest uppercase shrink-0">Knowledge Graph</span>
          <div className="flex flex-wrap gap-x-2 gap-y-1 overflow-hidden">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1 text-[10px] text-[#565f89] whitespace-nowrap">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                {type}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          <button onClick={exportPng} className="p-1.5 rounded-lg text-[#565f89] hover:text-[#c0caf5] hover:bg-[#292e42] transition-colors" title="Export as PNG">
            <Download size={13} />
          </button>
          <button onClick={zoomOut} className="p-1.5 rounded-lg text-[#565f89] hover:text-[#c0caf5] hover:bg-[#292e42] transition-colors" title="Zoom out (−)">
            <ZoomOut size={13} />
          </button>
          <button onClick={zoomIn} className="p-1.5 rounded-lg text-[#565f89] hover:text-[#c0caf5] hover:bg-[#292e42] transition-colors" title="Zoom in (+)">
            <ZoomIn size={13} />
          </button>
          <button onClick={fitView} className="p-1.5 rounded-lg text-[#565f89] hover:text-[#c0caf5] hover:bg-[#292e42] transition-colors" title="Fit to view">
            <RefreshCcw size={13} />
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-[#565f89] hover:text-[#c0caf5] hover:bg-[#292e42] transition-colors" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div ref={containerRef} className="flex-1 min-h-0">
        {graphData.nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#565f89] text-sm">No graph data</div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="#1a1b26"
            nodeCanvasObject={paintNode}
            nodeCanvasObjectMode={() => 'replace'}
            linkCanvasObject={paintLink}
            linkCanvasObjectMode={() => 'replace'}
            onNodeClick={node => onNodeClick?.(node as GraphNode)}
            onNodeHover={node => {
              hoveredNodeRef.current = node as GraphNode | null
              setHoveredNode(node as GraphNode | null)
            }}
            cooldownTicks={150}
            onEngineStop={fitView}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        )}
      </div>

      {/* ── Diff legend (compare only) ── */}
      {!isSingleDoc && (
        <div className="absolute bottom-3 left-4 flex flex-wrap gap-x-3 gap-y-1 z-10 pointer-events-none">
          {Object.entries({ changed: 'Changed', added: 'Added', removed: 'Removed', unchanged: 'In both' }).map(([status, label]) => (
            <span key={status} className="flex items-center gap-1 text-[10px] text-[#565f89]">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-[2px]" style={{ borderColor: STATUS_STROKE[status] }} />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* ── Zoom hint ── */}
      <div className="absolute bottom-3 right-4 text-[10px] text-[#3b4261] pointer-events-none">
        Scroll to zoom · Drag to pan
      </div>

      {/* ── Hover tooltip ── */}
      {hoveredNode && (
        <div className="absolute top-12 right-4 bg-[#1e2030] border border-[#3b4261] rounded-xl px-3 py-2.5 shadow-2xl max-w-[200px] z-20 pointer-events-none">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: nodeColor(hoveredNode) }} />
            <span className="text-sm font-semibold text-[#c0caf5] truncate">{hoveredNode.name}</span>
          </div>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: nodeColor(hoveredNode) + '22', color: nodeColor(hoveredNode) }}>
            {hoveredNode.type}
          </span>
          {(hoveredNode.value_a || hoveredNode.value_b) && (
            <div className="mt-2 space-y-0.5">
              {hoveredNode.value_a && <div className="text-[11px] text-[#9aa5ce]"><span className="text-[#7aa2f7]">A:</span> {hoveredNode.value_a}</div>}
              {hoveredNode.value_b && <div className="text-[11px] text-[#9aa5ce]"><span className="text-[#9ece6a]">B:</span> {hoveredNode.value_b}</div>}
            </div>
          )}
          {(hoveredNode.para_indices_a.length > 0 || hoveredNode.para_indices_b.length > 0) && (
            <div className="mt-1.5 space-y-0.5">
              {hoveredNode.para_indices_a.length > 0 && (
                <div className="text-[10px] text-[#565f89]">
                  A: {hoveredNode.para_indices_a.slice(0, 5).map(i => `¶${i}`).join(' ')}
                </div>
              )}
              {hoveredNode.para_indices_b.length > 0 && (
                <div className="text-[10px] text-[#565f89]">
                  B: {hoveredNode.para_indices_b.slice(0, 5).map(i => `¶${i}`).join(' ')}
                </div>
              )}
            </div>
          )}
          <div className="mt-1.5 text-[10px] text-[#3b4261]">{hoveredNode.degree} connection{hoveredNode.degree !== 1 ? 's' : ''}</div>
        </div>
      )}
    </div>
  )
}
