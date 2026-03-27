# Gachafruit

## Purpose
Gachafruit is a brand-focused website that showcases creative products and projects.

It serves as a frontend hub for:
- Gachafruit Studio (3D printed objects, yo-yos, creative products)
- External marketplace listings (Etsy, eBay, Amazon)

This site does NOT handle checkout or direct sales at this time.

---

## Architecture

- Static frontend (HTML, CSS, JavaScript)
- Hosted via Cloudflare Pages
- Version controlled with GitHub

### Data Sources
Product and listing data will be pulled from:
- Etsy
- eBay
- Amazon

All external API calls must be handled through backend endpoints (Cloudflare Functions).
No API keys should ever be exposed in frontend code.

---

## Design Philosophy

- Soft minimalism
- Warm neutral color palette
- Terracotta accent color
- Clean spacing and strong hierarchy
- Product-first presentation

The UI must remain flexible and not tied to any specific product category.

---

## Layout System

All pages must be built using reusable components:

- TopBar (optional announcements / external links)
- Header (logo + navigation)
- Hero (flexible content container)
- ContentSection (grid-based reusable section)
- ProductCard (standardized display)
- Footer

Avoid one-off layouts unless absolutely necessary.

---

## Rules

- Maintain consistent spacing between all sections
- Reuse components instead of duplicating layouts
- Do not introduce new colors outside the palette
- Keep interactions subtle and minimal
- Prioritize clarity over decoration

---

## Future Expansion

This project will later support:
- Integration with Dickson Antiquities (linked brand)
- YouTube and content sections
- Additional product categories

The structure must remain scalable and adaptable.