---
kind: component
name: Checkout Controller
parent: checkout-api
description: Handles checkout requests from the web app.
technology: Express
uses:
  - to: order-repository
    description: Saves orders
  - to: payment-client
    description: Takes payment
  - to: warehouse
    description: Reserves stock
    technology: gRPC
---

# Checkout Controller
