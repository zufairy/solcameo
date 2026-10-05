import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus, ZoomIn, ZoomOut, RotateCcw, MapPin, X, Clock, DollarSign, Star, ChevronRight, RefreshCw } from 'lucide-react'

import type { IntelligentNode } from '@/lib/builder/intelligentNode'

interface WorkflowCanvasProps {
  isMinimized: boolean
  /** Kept for layout; FAB below toggles plan sidebar instead when `onTogglePlanSidebar` is set. */
  onToggleMinimize?: () => void
  /** When set, FAB opens/closes the right plan sidebar (preferred over collapsing the canvas). */
  planSidebarOpen?: boolean
  onTogglePlanSidebar?: () => void
  nodes?: IntelligentNode[]
  previewNodes?: IntelligentNode[] // Preview nodes to show in preview mode
  onNodeUpdate?: (nodeId: string, updates: Partial<IntelligentNode>) => void
  /** Resize pan/zoom so all nodes fit the viewport after batch adds */
  autoFitOnNodeChange?: boolean
  /** Called when a node's CTA button is clicked and has no ctaHref (action-only CTAs) */
  onNodeCtaClick?: (node: IntelligentNode) => void
  discoveryData?: {
    businessConcept?: string
    targetAudience?: string
    keyFeatures?: string[]
    timeline?: string
    budget?: string
    suggestedFreelancers?: {
      id?: string
      name: string
      role: string
      rating: number
      hourlyRate: number
      avatar?: string
    }[]
  }
}

const CATEGORY_COLORS = {
  foundation: '#86A8FF',
  development: '#7FD3C6',
  asset: '#D49BFF',
  talent: '#F2C068',
  marketing: '#FF8BA0',
  operations: '#9AD8FF',
  growth: '#FFB968',
  milestone: '#ffffff',
  initial: '#10b981' // Green color for INITIAL nodes
}

// Route any remote image through our proxy to bypass CORS/hotlinking blocks.
// Same-origin URLs (/...) and data URLs pass through unchanged.
function proxiedImageUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('data:') || trimmed.startsWith('/')) return trimmed
  if (!/^https?:\/\//i.test(trimmed)) return ''
  // Unsplash CDN is already public + CORS-friendly — no need to proxy.
  if (/^https:\/\/images\.unsplash\.com\//i.test(trimmed)) return trimmed
  return `/api/builder/image-proxy?url=${encodeURIComponent(trimmed)}`
}

function getNodeCoverImage(node: IntelligentNode) {
  const base = node.sourceCoverImageUrl || node.sourceImageUrl || node.sourceProfileImageUrl
  if (base && base.length > 4) return proxiedImageUrl(base)

  // User requested ALWAYS have images. Fallback for Foundation/Community nodes
  if (node.category === 'foundation' || /\b(community|knowledge)\b/i.test(node.label)) {
    return 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=400&q=80' // Futuristic neural network
  }
  return ''
}

function getNodeProfileImage(node: IntelligentNode) {
  return proxiedImageUrl(node.sourceProfileImageUrl || node.sourceImageUrl || node.sourceCoverImageUrl || '')
}

function getSuggestedCommunityCoverImage(node: IntelligentNode) {
  const community = node.suggestedCommunities?.[0]
  if (!community) return ''
  return community.coverImage || community.image || community.profileImage || community.avatar || ''
}

function getSuggestedCommunityProfileImage(node: IntelligentNode) {
  const community = node.suggestedCommunities?.[0]
  if (!community) return ''
  return community.profileImage || community.avatar || community.image || community.coverImage || ''
}

export default function WorkflowCanvas({
  isMinimized,
  onTogglePlanSidebar,
  planSidebarOpen = false,
  nodes: externalNodes,
  previewNodes = [],
  onNodeUpdate,
  discoveryData,
  autoFitOnNodeChange = false,
  onNodeCtaClick,
}: WorkflowCanvasProps) {
  const [viewMode, setViewMode] = useState<'canvas' | 'preview'>('canvas')
  const canvasRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<IntelligentNode[]>([])
  const [draggedNode, setDraggedNode] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [expandedNode, setExpandedNode] = useState<string | null>(null)
  const [showOperations, setShowOperations] = useState<Set<string>>(new Set()) // Track which milestones have operations visible

  // Zoom and pan state
  const [zoom, setZoom] = useState(0.7)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [agendaNode, setAgendaNode] = useState<IntelligentNode | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Touch gesture state
  const [, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null)
  const [lastTap, setLastTap] = useState<number>(0)

  const canvasNodes = useMemo(() => {
    const committedNodes = externalNodes || []
    if (!previewNodes.length) return committedNodes

    const committedIds = new Set(committedNodes.map(node => node.id))
    return [
      ...committedNodes,
      ...previewNodes.filter(node => !committedIds.has(node.id))
    ]
  }, [externalNodes, previewNodes])
  const previewPanelNodes = useMemo(() => {
    if (previewNodes.length > 0) return previewNodes
    return externalNodes || []
  }, [externalNodes, previewNodes])

  // Track previous milestone count and positions to detect new milestones
  const milestonePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Auto-scroll to new nodes
  const prevNodeCountRef = useRef(0)
  const hasAutoCenteredRef = useRef(false)

  const fitAllNodesInView = useCallback((force = false) => {
    if ((!autoFitOnNodeChange && !force) || !containerRef.current || !canvasNodes.length) return
    const rect = containerRef.current.getBoundingClientRect()
    const pad = 48
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of canvasNodes) {
      const w = n.category === 'milestone' ? 280 : n.category === 'marketing' ? 260 : 240
      const h = n.category === 'milestone' ? 145 : n.category === 'marketing' ? 130 : 120
      minX = Math.min(minX, n.x - 90)
      minY = Math.min(minY, n.y - 50)
      maxX = Math.max(maxX, n.x + w)
      maxY = Math.max(maxY, n.y + h)
    }
    const bw = Math.max(maxX - minX, 280)
    const bh = Math.max(maxY - minY, 200)
    const innerPad = pad * 2
    const scale = Math.min(
      (rect.width - innerPad) / bw,
      (rect.height - innerPad) / bh,
    )
    const z = Math.max(0.36, Math.min(scale, 1.08))
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setZoom(z)
    setPan({
      x: rect.width / 2 - cx * z,
      y: rect.height / 2 - cy * z,
    })
  }, [autoFitOnNodeChange, canvasNodes])

  // Center canvas initially
  useEffect(() => {
    if (containerRef.current && !isInitialized) {
      const containerRect = containerRef.current.getBoundingClientRect()
      // Start with canvas centered
      setPan({
        x: containerRect.width * 0.15,
        y: containerRect.height * 0.1
      })
      setIsInitialized(true)
    }
  }, [isInitialized])

  useEffect(() => {
    if (canvasNodes.length > prevNodeCountRef.current) {
      if (autoFitOnNodeChange) {
        setTimeout(() => fitAllNodesInView(), 120)
      }
    }

    setNodes(canvasNodes)
    prevNodeCountRef.current = canvasNodes.length
  }, [canvasNodes, autoFitOnNodeChange, fitAllNodesInView])

  useEffect(() => {
    if (canvasNodes.length === 0) {
      hasAutoCenteredRef.current = false
    }
  }, [canvasNodes.length])

  useEffect(() => {
    if (!containerRef.current || canvasNodes.length === 0 || hasAutoCenteredRef.current) return
    hasAutoCenteredRef.current = true
    setTimeout(() => fitAllNodesInView(true), 80)
  }, [canvasNodes.length, fitAllNodesInView])

  // Filter operations nodes - only show them if they belong to a milestone
  const milestoneNodes = nodes.filter(n => n.category === 'milestone')
  const operationsNodes = nodes.filter(n => n.category === 'operations')

  // Group operations by their milestone dependency
  const operationsByMilestone = new Map<string, IntelligentNode[]>()
  operationsNodes.forEach(opNode => {
    const milestoneDep = opNode.dependencies?.find(depId => milestoneNodes.some(m => m.id === depId))
    if (milestoneDep) {
      if (!operationsByMilestone.has(milestoneDep)) {
        operationsByMilestone.set(milestoneDep, [])
      }
      operationsByMilestone.get(milestoneDep)!.push(opNode)
    }
  })

  const hasOperations = operationsByMilestone.size > 0
  const openNodeCta = useCallback((href?: string) => {
    if (!href) return
    if (typeof window === 'undefined') return
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [])

  // Store operations positions separately so they don't move when milestone moves
  const operationsPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Position operations nodes under their milestones (diagonal placement - lower and more right with more gaps)
  const positionedNodes = useMemo(() => {
    const updatedNodes = [...nodes]
    const OPERATIONS_OFFSET_Y = 150 // Vertical spacing under milestone (increased)
    const OPERATIONS_SPACING_Y = 280 // Vertical spacing between operations (increased for more gaps)
    const OPERATIONS_SPACING_X = 150 // Horizontal offset (increased for more gaps)

    milestoneNodes.forEach((milestone) => {
      const operations = operationsByMilestone.get(milestone.id) || []
      if (operations.length > 0 && showOperations.has(milestone.id)) {
        // Position operations diagonally (each lower and more to the right)
        operations.forEach((op, opIndex) => {
          const nodeIndex = updatedNodes.findIndex(n => n.id === op.id)
          if (nodeIndex >= 0) {
            // Check if we already have a stored position for this operation
            const storedPos = operationsPositionsRef.current.get(op.id)

            if (storedPos) {
              // Use stored position (operations don't move when milestone moves)
              updatedNodes[nodeIndex] = {
                ...updatedNodes[nodeIndex],
                x: storedPos.x,
                y: storedPos.y
              }
            } else {
              // Calculate initial position based on milestone
              const newX = milestone.x + (opIndex * OPERATIONS_SPACING_X)
              const newY = milestone.y + OPERATIONS_OFFSET_Y + (opIndex * OPERATIONS_SPACING_Y)

              // Store the position
              operationsPositionsRef.current.set(op.id, { x: newX, y: newY })

              updatedNodes[nodeIndex] = {
                ...updatedNodes[nodeIndex],
                x: newX,
                y: newY
              }
            }
          }
        })
      } else {
        // If operations are hidden, remove their stored positions
        operations.forEach(op => {
          operationsPositionsRef.current.delete(op.id)
        })
      }
    })

    return updatedNodes
  }, [nodes, milestoneNodes, operationsByMilestone, showOperations])

  // Show operations nodes only if their milestone is expanded
  const visibleNodes = positionedNodes.filter(n => {
    if (n.category === 'operations') {
      const milestoneDep = n.dependencies?.find(depId => milestoneNodes.some(m => m.id === depId))
      return milestoneDep ? showOperations.has(milestoneDep) : false
    }
    return true
  })

  // Group nodes by milestone/category and create hierarchical connections
  const getGroupedConnections = useCallback(() => {
    const connections: Array<{ from: IntelligentNode; to: IntelligentNode }> = []

    // Find specific node types
    const initialNode = visibleNodes.find(n => n.category === 'initial')
    const milestoneNodesList = visibleNodes.filter(n => n.category === 'milestone').sort((a, b) => a.x - b.x)

    // 1. Connect Initial Node to First Milestone (with animation)
    if (initialNode && milestoneNodesList.length > 0) {
      connections.push({
        from: initialNode,
        to: milestoneNodesList[0]
      })
      // Also connect initial to all milestones if there are multiple
      milestoneNodesList.slice(1).forEach(milestone => {
        connections.push({
          from: initialNode,
          to: milestone
        })
      })
    }

    // 2. Connect Milestones Sequentially
    for (let i = 0; i < milestoneNodesList.length - 1; i++) {
      connections.push({
        from: milestoneNodesList[i],
        to: milestoneNodesList[i + 1]
      })
    }

    // 3. Connect Milestones to their Task Nodes (Vertical Hierarchy)
    milestoneNodesList.forEach(milestone => {
      // Find nodes that should be under this milestone
      // This relies on the AI placing them vertically below or having a dependency
      // We'll look for nodes that are vertically aligned (roughly) and below the milestone
      const childNodes = visibleNodes.filter(n =>
        n.category !== 'milestone' &&
        n.category !== 'initial' &&
        Math.abs(n.x - milestone.x) < 100 && // Roughly same X
        n.y > milestone.y // Below
      ).sort((a, b) => a.y - b.y)

      if (childNodes.length > 0) {
        // Connect Milestone -> First Child
        connections.push({
          from: milestone,
          to: childNodes[0]
        })

        // Connect Children Sequentially (Vertical Chain)
        for (let i = 0; i < childNodes.length - 1; i++) {
          connections.push({
            from: childNodes[i],
            to: childNodes[i + 1]
          })
        }
      }
    })

    return connections
  }, [visibleNodes])

  // Zoom controls
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.2, 2))
  }

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.2, 0.5))
  }

  const handleResetView = () => {
    if (autoFitOnNodeChange && canvasNodes.length) {
      fitAllNodesInView()
    } else {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }

  // Mouse wheel zoom
  useEffect(() => {
    if (isMinimized) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setZoom(prev => Math.max(0.5, Math.min(2, prev + delta)))
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false })
      return () => container.removeEventListener('wheel', handleWheel)
    }
  }, [isMinimized])

  // Canvas panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left mouse button
    if ((e.target as HTMLElement).closest('.node-container')) return // Don't pan if clicking on a node

    setIsPanning(true)
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return

    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y
    })
  }, [isPanning, panStart])

  const handleCanvasMouseUp = () => {
    setIsPanning(false)
  }

  useEffect(() => {
    if (isPanning) {
      window.addEventListener('mousemove', handleCanvasMouseMove)
      window.addEventListener('mouseup', handleCanvasMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleCanvasMouseMove)
        window.removeEventListener('mouseup', handleCanvasMouseUp)
      }
    }
  }, [isPanning, handleCanvasMouseMove])

  // Touch event handlers for iPhone
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two-finger gesture for panning
      e.preventDefault()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      setIsPanning(true)
      setPanStart({ x: centerX - pan.x, y: centerY - pan.y })

      // Calculate initial distance for pinch zoom
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )
      setLastTouchDistance(distance)
    } else if (e.touches.length === 1) {
      // Single touch - check for double tap
      const now = Date.now()
      const timeSinceLastTap = now - lastTap

      if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
        // Double tap detected - add note
        const touch = e.touches[0]
        const canvasRect = canvasRef.current?.getBoundingClientRect()
        if (canvasRect) {
          const x = (touch.clientX - canvasRect.left - pan.x) / zoom
          const y = (touch.clientY - canvasRect.top - pan.y) / zoom

          // Create a new note node
          const newNote: IntelligentNode = {
            id: `note-${Date.now()}`,
            label: 'New Note',
            description: 'Double-tap to edit',
            category: 'development',
            status: 'pending',
            x,
            y,
            dependencies: []
          }

          setNodes(prev => [...prev, newNote])
        }
        setLastTap(0)
      } else {
        setLastTap(now)
        const touch = e.touches[0]
        setTouchStart({ x: touch.clientX, y: touch.clientY })
      }
    }
  }, [pan, zoom, lastTap])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && isPanning) {
      // Two-finger pan
      e.preventDefault()
      const touch1 = e.touches[0]
      const touch2 = e.touches[1]
      const centerX = (touch1.clientX + touch2.clientX) / 2
      const centerY = (touch1.clientY + touch2.clientY) / 2

      setPan({
        x: centerX - panStart.x,
        y: centerY - panStart.y
      })

      // Pinch zoom
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      )

      if (lastTouchDistance) {
        const scale = distance / lastTouchDistance
        setZoom(prev => Math.max(0.5, Math.min(2, prev * scale)))
        setLastTouchDistance(distance)
      }
    }
  }, [isPanning, panStart, lastTouchDistance])

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false)
    setTouchStart(null)
    setLastTouchDistance(null)
  }, [])

  const getNodeColor = (category: IntelligentNode['category']) => {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.development
  }

  useEffect(() => {
    // Auto-expand milestones that have operations
    const milestonesWithOps = new Set<string>()
    nodes.forEach(n => {
      if (n.category === 'operations') {
        n.dependencies?.forEach(depId => milestonesWithOps.add(depId))
      }
    })

    if (milestonesWithOps.size > 0) {
      setShowOperations(prev => {
        const next = new Set(prev)
        milestonesWithOps.forEach(id => next.add(id))
        return next
      })
    }
  }, [nodes])

  const handleNodeDragStart = (nodeId: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation() // Prevent canvas panning
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    const canvasRect = canvasRef.current?.getBoundingClientRect()
    if (!canvasRect) return

    setDraggedNode(nodeId)
    setDragOffset({
      x: (event.clientX - canvasRect.left - pan.x) / zoom - node.x,
      y: (event.clientY - canvasRect.top - pan.y) / zoom - node.y
    })
  }

  const handleNodeDragEnd = () => {
    setDraggedNode(null)
  }

  // Add mouse move listener for dragging
  useEffect(() => {
    if (!draggedNode) return

    const handleMouseMove = (e: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect()
      if (!canvasRect) return

      const draggedNodeData = nodes.find(n => n.id === draggedNode)
      if (!draggedNodeData) return

      // Account for zoom and pan when calculating new position
      const newX = ((e.clientX - canvasRect.left - pan.x) / zoom) - dragOffset.x
      const newY = ((e.clientY - canvasRect.top - pan.y) / zoom) - dragOffset.y

      // Constrain to reasonable bounds (accounting for zoom)
      const padding = 50 / zoom
      const maxX = (canvasRect.width / zoom) - padding
      const maxY = (canvasRect.height / zoom) - padding
      const constrainedX = Math.max(padding, Math.min(newX, maxX))
      const constrainedY = Math.max(padding, Math.min(newY, maxY))

      // Update node position (both milestones and operations can be moved)
      setNodes(prev => prev.map(n => {
        if (n.id === draggedNode) {
          const updated = { ...n, x: constrainedX, y: constrainedY }

          // Update stored position for both milestones and operations
          if (n.category === 'operations') {
            operationsPositionsRef.current.set(n.id, { x: constrainedX, y: constrainedY })
          } else if (n.category === 'milestone') {
            milestonePositionsRef.current.set(n.id, { x: constrainedX, y: constrainedY })
          }

          return updated
        }
        return n
      }))
    }

    const handleMouseUp = () => {
      setDraggedNode(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggedNode, dragOffset])

  return (
    <>
      {/* Canvas Container - Always visible but can be minimized */}
      <motion.div
        initial={false}
        animate={{
          width: isMinimized ? '0%' : '100%',
          opacity: isMinimized ? 0 : 1
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
        className="absolute inset-0 bg-[#1a1a1a] border-l border-white/10 flex flex-col overflow-hidden"
      >
        {/* Shared Header for Canvas and Preview */}
        {!isMinimized && (
          <div className="h-12 border-b border-white/10 flex items-center justify-between px-4 flex-shrink-0 bg-[#1a1a1a]">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <h2 className="text-xs font-medium text-white">
                {viewMode === 'canvas' ? 'Marketing plan' : 'Preview Area'}
              </h2>
              {viewMode === 'preview' && (
                <span className="text-[10px] text-white/50">
                  {previewPanelNodes.length > 0 ? `${previewPanelNodes.length} cards` : 'No nodes'}
                </span>
              )}
            </div>

            {/* Animated Toggle Switch - Smaller */}
            <div className="flex items-center gap-2">
              <span className={`text-[10px] transition-colors duration-300 ${viewMode === 'canvas' ? 'text-white' : 'text-white/40'}`}>
                Canvas
              </span>
              <button
                onClick={() => setViewMode(prev => prev === 'canvas' ? 'preview' : 'canvas')}
                className="relative w-10 h-5 bg-white/10 rounded-full transition-all duration-300 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-[#1a1a1a]"
              >
                <motion.div
                  className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-md"
                  animate={{
                    x: viewMode === 'preview' ? 20 : 0
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 500,
                    damping: 30
                  }}
                />
              </button>
              <span className={`text-[10px] transition-colors duration-300 ${viewMode === 'preview' ? 'text-white' : 'text-white/40'}`}>
                Preview
              </span>
            </div>
          </div>
        )}

        {/* Canvas Area - Only visible when not minimized */}
        {!isMinimized && viewMode === 'canvas' && (
          <div
            ref={containerRef}
            className="flex-1 relative overflow-hidden"
            onMouseDown={handleCanvasMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
          >
            {/* Zoom Controls */}
            <div className="absolute top-4 right-4 z-40 flex flex-col gap-2 bg-[#1a1a1a]/90 backdrop-blur-sm border border-white/10 rounded-lg p-2">
              <button
                onClick={handleZoomIn}
                className="p-2 hover:bg-white/10 rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleZoomOut}
                className="p-2 hover:bg-white/10 rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleResetView}
                className="p-2 hover:bg-white/10 rounded transition-colors"
                title={autoFitOnNodeChange ? 'Fit canvas' : 'Reset view'}
              >
                <RotateCcw className="w-4 h-4 text-white" />
              </button>
              <div className="text-xs text-white/60 text-center pt-1 border-t border-white/10 mt-1">
                {Math.round(zoom * 100)}%
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                x: pan.x,
                y: pan.y,
                scale: zoom
              }}
              transition={{
                opacity: { duration: 0.2 },
                x: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 },
                y: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 },
                scale: { type: 'spring', stiffness: 300, damping: 30 }
              }}
              ref={canvasRef}
              className="relative"
              style={{
                width: '100%',
                height: '100%',
                minWidth: '200%',
                minHeight: '200%',
                transformOrigin: '0 0'
              }}
              onMouseLeave={handleNodeDragEnd}
            >
              {/* Background Dots - Infinite repeat using CSS background */}
              <div
                className="absolute pointer-events-none"
                style={{
                  width: '200%',
                  height: '200%',
                  left: '-50%',
                  top: '-50%',
                  backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)`,
                  backgroundSize: '30px 30px',
                  // Offset background based on pan position to create infinite scrolling effect
                  backgroundPosition: `${pan.x % 30}px ${pan.y % 30}px`
                }}
              />

              {/* Connection Lines - Grouped by milestone/category with electricity effect */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                <defs>
                  <linearGradient id="electricity-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity="0" />
                    <stop offset="50%" stopColor="#818cf8" stopOpacity="1" />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {getGroupedConnections().map((connection) => {
                  const from = connection.from
                  const to = connection.to

                  // Calculate connection points
                  // For horizontal connections (Initial -> Milestone, Milestone -> Milestone)
                  // For vertical connections (Milestone -> Task, Task -> Task)

                  const isVertical = Math.abs(from.x - to.x) < 50

                  let startX, startY, endX, endY, controlX1, controlY1, controlX2, controlY2

                  if (isVertical) {
                    // Vertical connection (Top to Bottom)
                    // Align with center-bottom and center-top
                    startX = from.x + 100 // Center width (approx)
                    startY = from.y + 80  // Bottom edge
                    endX = to.x + 100     // Center width
                    endY = to.y           // Top edge

                    controlX1 = startX
                    controlY1 = startY + 50
                    controlX2 = endX
                    controlY2 = endY - 50
                  } else {
                    // Horizontal connection (Right to Left)
                    // Align with center-sides of the new node design
                    startX = from.x + 180 // Right edge (approx width of node)
                    startY = from.y + 40  // Vertical center (approx height/2)
                    endX = to.x           // Left edge
                    endY = to.y + 40      // Vertical center

                    controlX1 = startX + 80
                    controlY1 = startY
                    controlX2 = endX - 80
                    controlY2 = endY
                  }

                  const path = `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`

                  const isMilestoneConnection = from.category === 'milestone' || to.category === 'milestone'
                  const isInitialToMilestone = from.category === 'initial' && to.category === 'milestone'
                  const strokeColor = isMilestoneConnection ? '#10b981' : getNodeColor(to.category)
                  const strokeWidth = isInitialToMilestone ? '2' : isMilestoneConnection ? '1.5' : '1'

                  return (
                    <g key={`${from.id}-${to.id}`}>
                      {/* Base connection line with animation */}
                      <motion.path
                        d={path}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        fill="transparent"
                        opacity={isInitialToMilestone ? 0.8 : 0.5}
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: isInitialToMilestone ? 0.8 : 0.5 }}
                        transition={{
                          pathLength: { duration: 0.8, ease: 'easeInOut' },
                          opacity: { duration: 0.5 }
                        }}
                      />
                      {/* Animated gradient for milestone connections */}
                      {isInitialToMilestone && (
                        <motion.path
                          d={path}
                          stroke="url(#electricity-gradient)"
                          strokeWidth={strokeWidth}
                          strokeLinecap="round"
                          fill="transparent"
                          opacity={0.6}
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{
                            pathLength: { duration: 1.2, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse' }
                          }}
                        />
                      )}
                    </g>
                  )
                })}
              </svg>

              {/* Nodes */}
              <AnimatePresence>
                {visibleNodes.map((node, index) => {
                  const isDragging = draggedNode === node.id
                  const isCoreNode = node.id === 'center'
                  const isOperationNode = node.category === 'operations'
                  const isKnowledgeBaseNode = node.category === 'foundation' && /\bknowledge\b/i.test(node.label)
                  const isKnowledgeBaseExpanded = isKnowledgeBaseNode && expandedNode === node.id
                  const isPreviewNode = node.id.startsWith('__preview-')
                  const showOperationsToggle = node.category === 'milestone' && node.id !== 'center' && hasOperations
                  return (
                    <motion.div
                      key={node.id}
                      initial={false}
                      animate={{
                        scale: 1,
                        opacity: 1,
                        x: node.x - (node.category === 'milestone' ? 100 : 85),
                        y: node.y - (node.category === 'milestone' ? 55 : 45),
                        rotateX: 0,
                        filter: 'blur(0px)'
                      }}
                      exit={{
                        scale: 0.8,
                        opacity: 0,
                        y: -20,
                        filter: 'blur(5px)'
                      }}
                      transition={{
                        type: 'spring',
                        stiffness: node.category === 'milestone' ? 300 : 280,
                        damping: node.category === 'milestone' ? 20 : 22,
                        mass: 0.5,
                        delay: node.animation?.delay !== undefined
                          ? node.animation.delay / 1000
                          : index * 0.04,
                      }}
                      className="absolute cursor-move node-container"
                      style={{
                        left: 0,
                        top: 0,
                        zIndex: node.category === 'milestone'
                          ? (isDragging ? 100 : 50) // Milestones on top
                          : node.category === 'operations'
                            ? (isDragging ? 60 : 30) // Operations above regular nodes but below milestones
                            : (isDragging ? 50 : 10)
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation() // Prevent canvas panning when dragging nodes
                        handleNodeDragStart(node.id, e)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        // Show agenda popup on click
                        if (isKnowledgeBaseNode) {
                          setExpandedNode(prev => (prev === node.id ? null : node.id))
                        }
                        setAgendaNode(agendaNode?.id === node.id ? null : node)
                      }}
                    >
                      <motion.div
                        whileHover={{ scale: 1.015, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        className={`relative overflow-hidden rounded-md border transition-colors duration-300 ${node.category === 'milestone'
                          ? 'min-w-[228px] max-w-[268px] px-4 py-3.5'
                          : isKnowledgeBaseExpanded
                            ? 'min-w-[320px] max-w-[420px] px-3.5 py-3'
                          : node.category === 'marketing'
                            ? 'min-w-[212px] max-w-[256px] px-3.5 py-3'
                            : isOperationNode
                              ? 'min-w-[205px] max-w-[245px] px-3 py-2.5'
                              : 'min-w-[190px] max-w-[228px] px-3 py-2.5'
                          }`}
                        style={{
                          borderColor: isCoreNode
                            ? 'rgba(196, 232, 255, 0.22)'
                            : node.category === 'initial'
                              ? 'rgba(52, 211, 153, 0.26)'
                              : node.category === 'milestone'
                                ? 'rgba(110, 231, 183, 0.2)'
                                : node.category === 'marketing'
                                  ? 'rgba(125, 211, 252, 0.18)'
                                  : 'rgba(255,255,255,0.08)',
                          borderWidth: '1px',
                          borderStyle: isPreviewNode ? 'dashed' : 'solid',
                          background: isCoreNode
                            ? 'linear-gradient(180deg, rgba(18, 30, 49, 0.98), rgba(10, 16, 28, 0.98))'
                            : node.category === 'initial'
                              ? 'linear-gradient(180deg, rgba(9, 31, 24, 0.98), rgba(8, 22, 18, 0.98))'
                              : node.category === 'milestone'
                                ? 'linear-gradient(180deg, rgba(15, 30, 23, 0.96), rgba(10, 18, 14, 0.96))'
                                : node.category === 'marketing'
                                  ? 'linear-gradient(180deg, rgba(14, 22, 35, 0.97), rgba(10, 14, 24, 0.97))'
                                  : 'linear-gradient(180deg, rgba(17, 19, 26, 0.96), rgba(11, 13, 19, 0.96))',
                          boxShadow:
                            '0 16px 40px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)'
                        }}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
                        {isPreviewNode && (
                          <div className="absolute right-2 top-2 rounded-full border border-lime-300/35 bg-lime-400/15 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-lime-100">
                            Live
                          </div>
                        )}
                        {/* Gig Image for Operations Nodes (Freelancers) */}
                        {isOperationNode && node.suggestedFreelancers && node.suggestedFreelancers.length > 0 && (
                          <div className="mb-3 -mx-3 -mt-2.5">
                            <img
                              src={node.suggestedFreelancers[0].gigImage || node.suggestedFreelancers[0].avatar || ''}
                              alt={node.suggestedFreelancers[0].name}
                              className="w-full h-24 object-cover rounded-t-md"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          </div>
                        )}

                        {!isOperationNode && getNodeCoverImage(node) && (
                          <div className="relative mb-3 -mx-3 -mt-2.5 overflow-hidden rounded-t-md">
                            <img
                              src={getNodeCoverImage(node)}
                              alt={node.label}
                              className="h-28 w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,7,11,0.02),rgba(5,7,11,0.14)_45%,rgba(5,7,11,0.82)_100%)]" />
                            {getNodeProfileImage(node) && (
                              <div className="absolute bottom-0 left-3 translate-y-1/2">
                                <img
                                  src={getNodeProfileImage(node)}
                                  alt={`${node.label} profile`}
                                  className="h-12 w-12 rounded-2xl border-2 border-[#111318] object-cover shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none'
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Community Images for Operations Nodes (Communities) */}
                        {isOperationNode && node.suggestedCommunities && node.suggestedCommunities.length > 0 && (
                          <div className="mb-3 -mx-3 -mt-2.5 relative">
                            {/* Cover Image */}
                            {getSuggestedCommunityCoverImage(node) ? (
                              <img
                                src={getSuggestedCommunityCoverImage(node)}
                                alt={node.suggestedCommunities[0].name}
                                className="w-full h-20 object-cover rounded-t-md"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />
                            ) : (
                              <div className="w-full h-20 bg-gradient-to-br from-blue-500/30 to-purple-500/30 rounded-t-md" />
                            )}

                            {/* Profile Image Overlay */}
                            {getSuggestedCommunityProfileImage(node) && (
                              <div className="absolute bottom-0 left-3 transform translate-y-1/2">
                                <img
                                  src={getSuggestedCommunityProfileImage(node)}
                                  alt={node.suggestedCommunities[0].name}
                                  className="w-12 h-12 rounded-full border-3 border-[#1a1a1a] object-cover shadow-lg"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none'
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Add extra padding if community has profile image */}
                        <div className={getSuggestedCommunityProfileImage(node) ? 'pt-6' : getNodeProfileImage(node) ? 'pt-6' : ''}>
                          <div className="mb-1.5 flex flex-col gap-1">
                            <div className={`${node.category === 'milestone' ? 'text-[9px]' : 'text-[8px]'} uppercase tracking-[0.18em] flex items-center gap-1.5 justify-between ${isCoreNode || node.category === 'initial' ? 'text-white/68' : 'text-white/38'}`}>
                              <div className="flex items-center gap-1.5">
                                {node.category === 'milestone' && (
                                  <div className="h-2 w-2 rounded-full bg-emerald-300/90" />
                                )}
                                {node.category === 'initial' && (
                                  <div className="h-2 w-2 rounded-full bg-emerald-300/90" />
                                )}
                                {isCoreNode
                                  ? 'Core task'
                                  : node.category === 'initial'
                                    ? 'Initial'
                                    : node.category === 'marketing'
                                      ? 'Campaign lane'
                                      : node.category}
                              </div>
                              {/* Variation/Swap button for milestone nodes */}
                              {node.category === 'milestone' && (
                                <motion.button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Trigger variation swap
                                    if (onNodeUpdate) {
                                      // Generate variation
                                      const variations = [
                                        { label: `${node.label} (Alternative)`, description: `Alternative approach: ${node.description}` },
                                        { label: `${node.label} (Optimized)`, description: `Optimized version: ${node.description}` },
                                        { label: `${node.label} (Enhanced)`, description: `Enhanced approach: ${node.description}` },
                                        { label: `${node.label} (Streamlined)`, description: `Streamlined version: ${node.description}` }
                                      ]
                                      const variation = variations[Math.floor(Math.random() * variations.length)]
                                      onNodeUpdate(node.id, {
                                        ...variation,
                                        animation: { entrance: 'bounce', delay: 0 }
                                      })
                                    } else if (window.dispatchEvent) {
                                      // Fallback to custom event for backward compatibility
                                      window.dispatchEvent(new CustomEvent('milestone-variation-request', { detail: { nodeId: node.id } }))
                                    }
                                  }}
                                  whileHover={{ scale: 1.1, rotate: 90 }}
                                  whileTap={{ scale: 0.9 }}
                                  className="rounded-full border border-white/10 bg-white/[0.04] p-1.5 transition-colors hover:bg-white/[0.08]"
                                  title="Show variations / Swap milestone"
                                >
                                  <RefreshCw className="w-3 h-3 text-white/58" />
                                </motion.button>
                              )}
                            </div>
                            <h3 className={`font-semibold text-white ${node.category === 'milestone' ? 'text-[15px]' : 'text-[13px]'} leading-tight ${isCoreNode || node.category === 'milestone' || isOperationNode ? 'line-clamp-2' : 'truncate'}`}>
                              {node.label}
                            </h3>
                          </div>

                          {isKnowledgeBaseNode ? (
                            <div className={`mb-1.5 rounded border border-white/12 bg-black/40 p-1.5 text-left ${isKnowledgeBaseExpanded ? '' : ''}`}>
                              {onNodeUpdate ? (
                                <textarea
                                  value={node.description}
                                  onChange={(e) => {
                                    onNodeUpdate(node.id, { description: e.target.value })
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => e.stopPropagation()}
                                  rows={isKnowledgeBaseExpanded ? 14 : 7}
                                  className={`w-full resize-none rounded border border-white/10 bg-transparent px-2 py-1.5 font-inherit leading-relaxed text-white/78 outline-none transition focus:border-sky-300/35 ${isKnowledgeBaseExpanded ? 'min-h-[18rem] text-[11px]' : 'min-h-[8.75rem] text-[10px]'}`}
                                  placeholder="Write the knowledge base here..."
                                />
                              ) : (
                                <div className={`overflow-y-auto rounded px-2 py-1.5 ${isKnowledgeBaseExpanded ? 'max-h-[18rem]' : 'max-h-[8.75rem]'}`}>
                                  <p className={`whitespace-pre-wrap leading-relaxed text-white/74 ${isKnowledgeBaseExpanded ? 'text-[11px]' : 'text-[10px]'}`}>
                                    {node.description}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className={`mb-1.5 text-white/68 ${node.category === 'milestone' ? 'text-[11px]' : node.category === 'initial' ? 'text-[11px]' : 'text-[10px]'} leading-snug ${node.category === 'initial' ? 'line-clamp-6 max-h-[7.75rem]' : 'line-clamp-3'}`}>
                              {node.category === 'initial' ? (
                                <motion.span
                                  key={`goal-pulse-${node.pulseToken ?? 0}`}
                                  className="block"
                                  initial={{ opacity: 0.82 }}
                                  animate={{ opacity: [0.94, 1] }}
                                  transition={{ duration: 0.26 }}
                                >
                                  {node.description}
                                </motion.span>
                              ) : (
                                node.description
                              )}
                            </p>
                          )}

                          {node.sourceUrl && (
                            <p className="mb-2 truncate text-[9px] uppercase tracking-[0.14em] text-white/42">
                              Source · {(() => {
                                try {
                                  return new URL(node.sourceUrl).hostname.replace(/^www\./, '')
                                } catch {
                                  return node.sourceUrl
                                }
                              })()}
                            </p>
                          )}

                          {isKnowledgeBaseNode && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedNode(prev => (prev === node.id ? null : node.id))
                                setAgendaNode(node)
                              }}
                              className="mb-2 inline-flex items-center rounded-full border border-white/12 bg-white/[0.03] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/60 transition hover:bg-white/[0.06] hover:text-white/85"
                            >
                              {isKnowledgeBaseExpanded ? 'Collapse KB' : 'Expand KB'}
                            </button>
                          )}

                          {/* Community Stats - Rating and Category side by side */}
                          {isOperationNode && node.suggestedCommunities && node.suggestedCommunities.length > 0 && (
                            <div className="flex items-center gap-2 mb-2">
                              {/* Rating with yellow background */}
                              {node.suggestedCommunities[0].rating && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-yellow-500/20 rounded-md">
                                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                  <span className="text-yellow-400 text-[10px] font-semibold">
                                    {node.suggestedCommunities[0].rating.toFixed(1)}
                                  </span>
                                </div>
                              )}
                              {/* Category with blue background */}
                              {node.suggestedCommunities[0].category && (
                                <div className="px-2 py-0.5 bg-blue-500/20 rounded-md">
                                  <span className="text-blue-400 text-[10px] font-medium">
                                    {node.suggestedCommunities[0].category}
                                  </span>
                                </div>
                              )}
                              {/* Member count */}
                              {node.suggestedCommunities[0].memberCount > 0 && (
                                <span className="text-white/50 text-[10px]">
                                  {node.suggestedCommunities[0].memberCount} members
                                </span>
                              )}
                            </div>
                          )}

                          {(node.estimatedCost || node.estimatedTime || (node.freelancerCount && node.freelancerCount > 0 && !isOperationNode)) && (
                            <div className="mb-2 flex flex-col gap-1 text-[10px] text-white/58">
                              {node.estimatedCost && (
                                <span>Budget · ${node.estimatedCost.min}-{node.estimatedCost.max}</span>
                              )}
                              {node.estimatedTime && (
                                <span>Timeline · {node.estimatedTime}</span>
                              )}
                              {node.freelancerCount && node.freelancerCount > 0 && !isOperationNode && (
                                <span>{node.freelancerCount} matched freelancers</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Removed "Linked to" text as requested */}

                        {showOperationsToggle && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowOperations(prev => {
                                const newSet = new Set(prev)
                                if (newSet.has(node.id)) {
                                  newSet.delete(node.id)
                                } else {
                                  newSet.add(node.id)
                                }
                                return newSet
                              })
                              setExpandedNode(prev => prev === node.id ? null : node.id)
                            }}
                            className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.05] px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-white/[0.08]"
                          >
                            {showOperations.has(node.id) ? 'Hide Talent' : 'Show Talent'}
                          </button>
                        )}

                        {!showOperationsToggle && isOperationNode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (node.ctaHref) {
                                openNodeCta(node.ctaHref)
                                return
                              }
                              setAgendaNode(node)
                            }}
                            className="mt-2 w-full rounded-md border border-sky-300/14 bg-sky-500/14 px-3 py-2 text-[10px] font-semibold text-sky-50 transition hover:bg-sky-500/22"
                          >
                            {node.ctaLabel || 'View details'}
                          </button>
                        )}

                        {!showOperationsToggle && !isOperationNode && (node.ctaHref || node.ctaLabel) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (node.ctaHref) {
                                openNodeCta(node.ctaHref)
                              } else {
                                onNodeCtaClick?.(node)
                              }
                            }}
                            className={`mt-2 w-full rounded-md px-3 py-2 text-[10px] font-semibold transition ${
                              node.status === 'completed'
                                ? 'border border-sky-300/20 bg-sky-500/14 text-sky-50 hover:bg-sky-500/22'
                                : node.category === 'milestone'
                                  ? 'border border-lime-300/25 bg-lime-400/[0.12] text-lime-50 hover:bg-lime-400/[0.18]'
                                  : 'border border-emerald-300/16 bg-emerald-500/14 text-emerald-50 hover:bg-emerald-500/22'
                            }`}
                          >
                            {node.ctaLabel || 'Open flow'}
                          </button>
                        )}

                        {!showOperationsToggle && !isOperationNode && node.suggestedFreelancers && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="mt-2 space-y-1.5 max-h-48 overflow-y-auto"
                          >
                            {node.suggestedFreelancers.map((freelancer) => (
                              <div
                                key={freelancer.id}
                                className="flex items-start gap-2 p-1.5 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <div className="flex-shrink-0 relative">
                                  {freelancer.gigImage ? (
                                    <img
                                      src={freelancer.gigImage}
                                      alt={freelancer.name}
                                      className="w-10 h-10 rounded-lg object-cover border border-white/10"
                                    />
                                  ) : freelancer.avatar ? (
                                    <img
                                      src={freelancer.avatar}
                                      alt={freelancer.name}
                                      className="w-10 h-10 rounded-lg object-cover border border-white/10"
                                    />
                                  ) : (
                                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-semibold border border-white/10">
                                      {freelancer.name.charAt(0)}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-white text-[11px] font-medium truncate leading-tight">
                                    {freelancer.name}
                                  </p>
                                  <p className="text-white/60 text-[10px] leading-tight">${freelancer.rate}/hr</p>
                                  <span className="text-white/50 text-[10px]">⭐ {freelancer.rating}</span>
                                </div>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </motion.div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>

            </motion.div>

            {/* Empty State (anchored to viewport center, not transformed canvas) */}
            {visibleNodes.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
              >
                <div className="text-center px-6">
                  <p className="text-white/45 text-xs">
                    {discoveryData?.businessConcept
                      ? 'Complete the discovery questions to generate your workflow'
                      : 'Start building your business to see the workflow canvas'}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Agenda Popup */}
            <AnimatePresence>
              {agendaNode && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="absolute bottom-5 left-5 right-5 z-50 overflow-hidden rounded-md border border-white/10 bg-[#161618]/92 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:right-auto"
                  style={{ maxWidth: '420px' }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: CATEGORY_COLORS[agendaNode.category] || CATEGORY_COLORS.development }}
                      />
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-white/50">{agendaNode.category}</p>
                        <h3 className="text-sm font-semibold text-white">{agendaNode.label}</h3>
                      </div>
                    </div>
                    <button
                      onClick={() => setAgendaNode(null)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <X className="w-4 h-4 text-white/60" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="space-y-3.5 px-3.5 py-3.5">
                    {agendaNode.category === 'foundation' && /\bknowledge\b/i.test(agendaNode.label) ? (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-white/12 bg-black/35 px-2.5 py-2">
                        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-white/78">{agendaNode.description}</p>
                      </div>
                    ) : (
                      <p className="text-[12px] leading-relaxed text-white/75">{agendaNode.description}</p>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2.5">
                      {agendaNode.estimatedCost && (
                        <div className="rounded-lg bg-white/5 p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <DollarSign className="w-3.5 h-3.5 text-green-400" />
                            <span className="text-[10px] text-white/50">Budget</span>
                          </div>
                          <p className="text-[12px] font-semibold text-white">
                            ${agendaNode.estimatedCost.min}-{agendaNode.estimatedCost.max}
                          </p>
                        </div>
                      )}
                      {agendaNode.estimatedTime && (
                        <div className="rounded-lg bg-white/5 p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-3.5 h-3.5 text-blue-400" />
                            <span className="text-[10px] text-white/50">Timeline</span>
                          </div>
                          <p className="text-[12px] font-semibold text-white">{agendaNode.estimatedTime}</p>
                        </div>
                      )}
                      {agendaNode.freelancerCount && agendaNode.freelancerCount > 0 && (
                        <div className="rounded-lg bg-white/5 p-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <Star className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-[10px] text-white/50">Matches</span>
                          </div>
                          <p className="text-[12px] font-semibold text-white">{agendaNode.freelancerCount} freelancers</p>
                        </div>
                      )}
                    </div>

                    {/* Suggested Freelancers */}
                    {agendaNode.suggestedFreelancers && agendaNode.suggestedFreelancers.length > 0 && (
                      <div>
                        <p className="text-xs text-white/50 mb-2">Suggested Talent</p>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {agendaNode.suggestedFreelancers.slice(0, 3).map((freelancer) => (
                            <div
                              key={freelancer.id}
                              className="flex items-center gap-3 p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              {freelancer.avatar ? (
                                <img
                                  src={freelancer.avatar}
                                  alt={freelancer.name}
                                  className="w-8 h-8 rounded-lg object-cover"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                                  {freelancer.name.charAt(0)}
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-white truncate">{freelancer.name}</p>
                                <p className="text-[10px] text-white/50">${freelancer.rate}/hr • ⭐ {freelancer.rating}</p>
                              </div>
                              <ChevronRight className="w-4 h-4 text-white/30" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => openNodeCta(agendaNode.ctaHref)}
                        className="flex-1 rounded-lg border border-emerald-400/35 bg-emerald-500/[0.16] px-3 py-2 text-[12px] font-semibold text-emerald-50 shadow-[0_8px_24px_rgba(16,185,129,0.24),inset_0_1px_0_rgba(255,255,255,0.12)] transition-all hover:bg-emerald-500/24"
                      >
                        {agendaNode.ctaLabel || 'View Details'}
                      </button>
                      <button className="rounded-lg border border-white/12 bg-white/[0.05] px-3 py-2 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/[0.1]">
                        Add to Plan
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div >
        )
        }

        {/* Preview Area - Only visible when not minimized and in preview mode */}
        {
          !isMinimized && viewMode === 'preview' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {previewPanelNodes.length > 0 ? (
                  <div className="space-y-2">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-3"
                    >
                      <p className="text-[10px] text-white/50 mb-2">
                        This panel mirrors the saved canvas cards. Cards only update after the builder fetches or confirms real data.
                      </p>
                    </motion.div>

                    {previewPanelNodes.map((node, index) => (
                      <motion.div
                        key={node.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-0 hover:bg-white/[0.06] transition-colors"
                      >
                        {getNodeCoverImage(node) ? (
                          <div className="relative h-24 w-full overflow-hidden">
                            <img
                              src={getNodeCoverImage(node)}
                              alt={node.label}
                              className="h-full w-full object-cover"
                            />
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,10,14,0.08),rgba(7,10,14,0.78))]" />
                            {getNodeProfileImage(node) ? (
                              <div className="absolute bottom-0 left-3 translate-y-1/2">
                                <img
                                  src={getNodeProfileImage(node)}
                                  alt={`${node.label} profile`}
                                  className="h-10 w-10 rounded-2xl border-2 border-[#111318] object-cover shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={`flex items-start gap-2.5 p-3 ${getNodeProfileImage(node) ? 'pt-7' : ''}`}>
                          <div
                            className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: CATEGORY_COLORS[node.category] || CATEGORY_COLORS.development }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="mb-0.5 text-[9px] uppercase tracking-[0.15em] text-white/40">
                              {node.category}
                            </p>
                            <h4 className="mb-1 text-xs font-medium text-white">
                              {node.label}
                            </h4>
                            <p className="text-[10px] leading-relaxed text-white/70">
                              {node.description}
                            </p>
                            {node.sourceUrl && (
                              <p className="mt-1.5 truncate text-[9px] text-white/45">
                                {node.sourceUrl}
                              </p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-center px-6"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                      <MapPin className="w-6 h-6 text-white/40" />
                    </div>
                    <p className="text-xs text-white/50 mb-1.5">Canvas Snapshot</p>
                    <p className="text-[10px] text-white/40 max-w-sm">
                      Send a request with a website or business prompt and the builder will pin fetched, static cards here.
                    </p>
                  </motion.div>
                )}
              </div>
            </div>
          )
        }

        {/* Minimized State */}
        {
          isMinimized && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center h-full"
            >
              <p className="text-white/40 text-xs">Canvas minimized - Click to expand</p>
            </motion.div>
          )
        }
      </motion.div >

      {/* Plan sidebar toggle, after canvas so it stacks above the full-bleed canvas */}
      {!isMinimized && onTogglePlanSidebar && (
        <motion.button
          type="button"
          aria-label={planSidebarOpen ? "Close plan sidebar" : "Open plan sidebar"}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          onClick={onTogglePlanSidebar}
          className="absolute bottom-5 right-5 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.07] backdrop-blur-2xl text-white/[0.88] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_40px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.06] transition-[background,box-shadow] duration-300 hover:bg-white/[0.11] hover:ring-white/[0.1]"
        >
          {planSidebarOpen ? (
            <Minus className="h-[15px] w-[15px] shrink-0" strokeWidth={2.5} />
          ) : (
            <Plus className="h-[15px] w-[15px] shrink-0" strokeWidth={2.5} />
          )}
        </motion.button>
      )}
    </>
  )
}
