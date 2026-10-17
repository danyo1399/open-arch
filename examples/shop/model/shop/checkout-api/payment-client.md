---
kind: component
name: Payment Client
parent: checkout-api
description: Wraps the payment provider's API.
technology: TypeScript
uses:
  - to: payment-provider
    description: Charges cards
    technology: HTTPS
---

# Payment Client
