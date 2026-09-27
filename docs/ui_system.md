# UI Design System

The NexU design language is "Campus OS"—a dark, minimalist aesthetic with glassmorphic layers.

## Visual Language
The interface uses a pitch-black foundation with semi-transparent overlays to create depth and focus.

### Color Palette
- Background: #04070d (Coal Black)
- Primary Accent: #ff6a41 (Vivid Orange)
- Borders: rgba(255, 255, 255, 0.12)
- Text: rgba(255, 255, 255, 0.95)

### Glassmorphism Implementation
All internal modules use a standardized glass token:
- backdrop-filter: blur(12px) saturate(160%)
- background: rgba(255, 255, 255, 0.03)
- border-radius: 16px

## Components

### CardNav
A high-end navigation component that supports:
- Glassmorphic solid variants for internal pages.
- Dynamic transparency for public pages.
- Integrated backdrop blurs.

### SpotlightCard
Interactive feature cards that track mouse movement to reveal a subtle glow, now upgraded with 14px backdrop blurs.

## Scrolling and Overlays
- Smooth Scrolling: Powered by Lenis.
- Overlay Logic: When a modal or PDF viewer is open, the background scroll is programmatically locked to prevent context loss.
