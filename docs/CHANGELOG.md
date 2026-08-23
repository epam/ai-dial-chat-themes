# Ai Dial Themes Change Log

## 0.19.1

Light theme only. Adds the DIAL 2.0 tokens that DIAL UI Kit 0.14.0 introduced, where the control tokens are named after the **role** they fill instead of their opacity (`alpha`/`beta`) or their literal hue (`blue`).

**No token is removed or renamed in this release.** Every 0.19.0 name is kept with its 0.19.0 value, so applications on DIAL UI Kit 0.13.0 are unaffected; applications on 0.14.0 pick up the new names, which the kit reads first in its `var()` fallback chains.

### Added

- Accent gradient stops:
  - `bg-gradient-1`
  - `bg-gradient-1-hover`
  - `bg-gradient-1-active`
  - `bg-gradient-2`
  - `bg-gradient-2-hover`
  - `bg-gradient-2-active`
  - `stroke-gradient-1`
  - `stroke-gradient-2`

- Role-named control tokens (new names for the tokens listed under [Deprecated](#deprecated)):
  - `bg-control-disable-primary`
  - `bg-control-neutral-hover-muted`
  - `text-control-disable-primary`
  - `text-control-disable-secondary`
  - `text-control-accent-hover`
  - `text-control-accent-active`
  - `shadow-blue-500-alpha-20`

- New control steps:
  - `bg-control-accent-hover`
  - `bg-control-neutral-default`
  - `bg-control-neutral-hover-strong`
  - `bg-control-inverted`
  - `bg-control-disable-secondary`
  - `text-control-inverted`
  - `stroke-control-disable-primary`

- New stroke tokens:
  - `stroke-default`
  - `stroke-accent`

- New shadow tokens:
  - `shadow-blue-500-alpha-4`
  - `shadow-blue-500-alpha-8`

### Updated

- `bg-control-accent`: `#124ACE` → `#1D4ED8` (blue-500) — the only value that moves for existing applications.

The disabled-control roles were swapped in 0.19.0: the light grey sat on the label and the mid grey on the surface, the opposite of what the kit expects. The new tokens carry the corrected roles, while the 0.19.0 names keep their original values:

| Token | Value | Role |
| --- | --- | --- |
| `bg-control-disable-primary` | `#DCE0E8` | disabled surface (grey-300) |
| `text-control-disable-primary` | `#848E9C` | disabled label (grey-600) |
| `text-control-disable-secondary` | `#DCE0E8` | — |
| `bg-control-disable` *(0.19.0)* | `#848E9C` | unchanged |
| `text-control-disable-alpha` *(0.19.0)* | `#DCE0E8` | unchanged |
| `text-control-disable-beta` *(0.19.0)* | `#848E9C` | unchanged |

### Deprecated

Kept for backward compatibility, to be removed in a future major release. DIAL UI Kit 0.14.0 no longer reads them first:

- `bg-control-disable` → use `bg-control-disable-primary`
- `bg-control-neutral-hover` → use `bg-control-neutral-hover-muted`
- `text-control-disable-alpha` → use `text-control-disable-primary`
- `text-control-disable-beta` → use `text-control-disable-secondary`
- `text-control-blue-hover` → use `text-control-accent-hover`
- `text-control-blue-active` → use `text-control-accent-active`
- `shadow-blue-500` → use `shadow-blue-500-alpha-20`
- `stroke-hover-alpha` → use `stroke-accent-alpha`; the token is gone from DIAL UI Kit 0.14.0 and both carry the same colour (`#2764D933`)

## 0.19.0

### Added

DIAL 2.0 colour tokens, light theme only. The dark theme is unchanged, so DIAL UI Kit 2.0 components fall back to the light defaults there.

- New background layers:
  - `bg-layer-sunken`
  - `bg-layer-base`
  - `bg-layer-raised`
  - `bg-layer-6`
  - `bg-layer-7`
  - `bg-backdrop`

- Control background tokens:
  - `bg-control-accent`
  - `bg-control-accent-alpha`
  - `bg-control-accent-alpha-hover`
  - `bg-control-accent-alpha-active`
  - `bg-control-neutral`
  - `bg-control-neutral-hover`
  - `bg-control-neutral-active`
  - `bg-control-error`
  - `bg-control-error-hover`
  - `bg-control-error-active`
  - `bg-control-error-alpha-hover`
  - `bg-control-error-alpha-active`
  - `bg-control-disable`

- Visual background tokens:
  - `bg-visual-blue`
  - `bg-visual-green-1`
  - `bg-visual-green-2`
  - `bg-visual-brown`
  - `bg-visual-red`
  - `bg-visual-violet-1`
  - `bg-visual-violet-2`

- Text tokens:
  - `text-tertiary`
  - `text-accent`
  - `text-control-permanent`
  - `text-control-disable-alpha`
  - `text-control-disable-beta`
  - `text-control-blue-hover`
  - `text-control-blue-active`

- Visual text tokens:
  - `text-visual-blue`
  - `text-visual-green-1`
  - `text-visual-green-2`
  - `text-visual-green-3`
  - `text-visual-brown-1`
  - `text-visual-brown-2`
  - `text-visual-red`
  - `text-visual-violet-1`
  - `text-visual-violet-2`

- Stroke tokens:
  - `stroke-hover-alpha`
  - `stroke-focus-black`
  - `stroke-focus-blue`
  - `stroke-accent-alpha`
  - `stroke-error-alpha`

- Shadow tokens:
  - `shadow-default`
  - `shadow-grey-1000`
  - `shadow-blue-500`

## 0.16.0

### ⚠️ Breaking Changes
- Removed `app-logo` from theme config¹
- Removed default favicon from theme images¹

¹ DIAL Admin and DIAL Chat applications will include a fallback mechanism to prevent failures.


### Added

- New fields for theme images:
  - `admin-logo-light`
  - `admin-logo-dark`
  - `admin-favicon`
  - `chat-logo-light`
  - `chat-logo-dark`
  - `chat-favicon`

- New images for:
  - DIAL Admin logo and favicon
  - DIAL Chat logo and favicon

### Updated

- Updated icons for DIAL products

## 0.14.0

### Added

- `stroke-focus`

- New button background tokens:
  - `controls-bg-accent-primary-active`
  - `controls-bg-accent-primary-alpha-active`
  - `controls-bg-accent-secondary-alpha-active`
  - `controls-bg-accent-tertiary-alpha-active`
  - `controls-bg-error-active`
  - `controls-bg-error-alpha-hover`
  - `controls-bg-error-alpha-active`
  - `controls-bg-neutral-active`
  - `controls-bg-accent-success-alpha-hover`
  - `controls-bg-accent-success-alpha-active`

- New button text tokens:
  - `controls-text-accent-primary-active`
  - `controls-text-secondary-disable`
  - `controls-text-accent-disable`

---

### Renamed

- `controls-bg-solid-primary` → `controls-bg-accent-primary`
- `controls-bg-solid-primary-hover` → `controls-bg-accent-primary-hover`
- `controls-bg-solid-error` → `controls-bg-error`
- `controls-bg-solid-error-hover` → `controls-bg-accent-error-hover`
- `controls-bg-solid-disable` → `controls-bg-disable-accent`
- `controls-bg-outlined-neutral-hover` → `controls-bg-neutral-hover`
- `controls-text-solid` → `controls-text-permanent`
- `controls-text-solid-disable` → `controls-text-primary-disable`
- `controls-text-outlined` → `controls-text-neutral`
- `controls-text-link-primary-hover` → `controls-text-accent-primary-hover`

![alt text](./images/rename-tokens-0.14.png)
## 0.13.0

### Added

- Introduced new token:
  - `text-warning-icon`

- New solid button background tokens:
  - `controls-bg-solid-primary`
  - `controls-bg-solid-primary-hover`
  - `controls-bg-solid-error`
  - `controls-bg-solid-error-hover`
  - `controls-bg-solid-disable`

- New outlined button state token:
  - `controls-bg-outlined-neutral-hover`

- New button text tokens:
  - `controls-text-solid`
  - `controls-text-solid-disable`
  - `controls-text-outlined`
  - `controls-text-link-primary-hover`

---
