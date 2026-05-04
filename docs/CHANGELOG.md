# Ai Dial Themes Change Log

## 0.16.0
- Update DIAL Chat and DIAL Admin favicon images in correct size and quality

## 0.15.0

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