# Mobile-Responsive Collapsible Drawer Navigation

Responsive layout optimization for SignalForge ML that replaces the fixed-width desktop sidebar on mobile screens with a clean, collapsible slide-out drawer accessible via a dedicated top-left hamburger menu toggle.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following user preferences were confirmed in clarification:
> - **Menu Style**: Collapsible slide-out drawer with a top-left hamburger button and backdrop overlay.
> - **Initial Mobile State**: Closed by default on mobile phones so the signal terminal and market charts occupy 100% of the screen width.
> - **Desktop Behavior**: Preserves clean persistent sidebar or collapsible toggle on desktop screens ($\ge 1024\text{px}$).

---

## 1. Overview & Core Concept

When viewing the trading research terminal on mobile devices, the fixed 240px sidebar currently occupies more than 50% of the viewport width, truncating candlestick charts, signal cards, and cognitive streams. This update introduces:
1. **Top-Left Mobile Menu Toggle**: A clean, accessible hamburger button (`Menu` / `X`) in the header.
2. **Slide-Out Drawer with Backdrop**: A smooth sliding navigation drawer with an animated backdrop overlay (`fixed inset-0 bg-black/60`).
3. **Auto-Close on Navigation**: Automatically closes the drawer when the user selects a view tab.
4. **Responsive Header Clocks**: Compacts clocks and session indicators on small screens to prevent header wrapping.

---

## 2. User Experience & Visual Design

- **Mobile Viewport (< 1024px)**:
  - Sidebar is hidden by default (`hidden lg:flex`).
  - Signal terminal, market explorer, and research views expand to **100% full width**.
  - Tapping the hamburger button opens a smooth slide-out drawer from the left with full touch-friendly targets ($\ge 44\text{px}$).
  - Tapping any tab or tapping the dimmed background immediately dismisses the drawer.
- **Desktop Viewport ($\ge 1024px$)**:
  - Retains the sidebar for workflow navigation.
- **Header Layout**:
  - Replaces congested clocks on small mobile screens with compact IST time and mobile menu icon, preventing overflow.

---

## 3. Technical Architecture & Component Mapping

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Header (Mobile Responsive)                      │
│   [☰ Menu]  SIGNALFORGE ML           [AUTOPILOT: ACTIVE]  [05:48 IST]   │
└────────────────────────────────────────────────────────────────────────┘
                                 │
     ┌───────────────────────────┴───────────────────────────┐
     ▼                                                       ▼
[Mobile Drawer Overlay]                                [Main Content Area]
• fixed inset-0 z-50                                   • 100% Full-Width Viewport
• Slide transition (-translate-x-full -> 0)           • Signal Terminal / Explorer
• Closes on item selection or backdrop click           • Uncramped Cards & SVG Charts
```

### Components to Update
1. `src/components/Header.tsx`:
   - Add `onToggleMenu` prop and hamburger menu button (`Menu` icon).
   - Add mobile-optimized clock formatting (`hidden sm:inline` for secondary text).
2. `src/components/Sidebar.tsx`:
   - Accept `isOpen: boolean`, `onClose: () => void`.
   - Implement responsive classes: on mobile (`lg:hidden`), render as an overlay drawer with backdrop; on desktop (`lg:flex`), render as normal.
3. `src/App.tsx`:
   - Manage `isMobileMenuOpen` state (defaults to `false`).
   - Pass toggle handler to `Header` and `Sidebar`.

---

## 4. Verification & Testing

1. Test mobile viewport (< 640px) to verify sidebar is hidden on launch and main signal cards occupy 100% width.
2. Tap hamburger button: verify drawer opens smoothly.
3. Tap view tab: verify active view changes and drawer auto-closes.
4. Tap backdrop: verify drawer closes without changing view.
5. Verify desktop viewport (> 1024px) remains accessible.
6. Verify `tsc --noEmit` and `compile_applet`.
