---
kind: container
name: Web App
parent: shop
description: The storefront customers use.
technology: React
uses:
  - to: checkout-controller
    description: Places orders
    technology: HTTPS/JSON
---

# Web App

Single-page app served from a CDN.
