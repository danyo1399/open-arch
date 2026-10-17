---
kind: component
name: Order Repository
parent: checkout-api
description: Reads and writes orders.
technology: TypeScript
uses:
  - to: orders-db
    description: Reads and writes orders
    technology: SQL
---

# Order Repository
