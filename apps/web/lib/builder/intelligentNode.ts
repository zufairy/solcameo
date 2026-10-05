/**
 * Canvas node shape used by WorkflowCanvas (aligned with apps/ai dynamicCanvasEngine).
 */

export interface IntelligentNode {
  id: string
  label: string
  category: 'foundation' | 'development' | 'marketing' | 'operations' | 'growth' | 'milestone' | 'initial'
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  ctaLabel?: string
  ctaHref?: string
  sourceImageUrl?: string
  sourceCoverImageUrl?: string
  sourceProfileImageUrl?: string
  sourceUrl?: string

  estimatedCost?: { min: number; max: number }
  estimatedTime?: string
  complexity?: 'low' | 'medium' | 'high'

  suggestedFreelancers?: Array<{
    id: string
    name: string
    avatar?: string
    gigImage?: string
    rate: number
    rating: number
    availability: 'immediate' | 'available' | 'busy'
    matchScore: number
  }>
  freelancerCount?: number
  priceRange?: { min: number; max: number }

  suggestedCommunities?: Array<{
    id: string
    name: string
    description?: string
    avatar?: string
    coverImage?: string
    profileImage?: string
    image?: string
    memberCount: number
    postCount: number
    rating: number
    matchScore: number
    category?: string
  }>
  communityCount?: number

  subTasks?: Array<{
    task: string
    complexity: 'easy' | 'medium' | 'hard'
    estimatedHours: number
  }>

  x: number
  y: number

  animation?: {
    entrance: 'scale-and-fade' | 'slide' | 'bounce'
    delay: number
  }

  /** Bumped by the builder when the goal text changes to re-run a light motion pulse on the card. */
  pulseToken?: number

  dependencies?: string[]
  connectsTo?: string[]
}
