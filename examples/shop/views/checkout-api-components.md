---
kind: view
title: Checkout API components
level: component
scope: checkout-api
---

# Checkout API components

How a checkout request is handled.

<!-- open-arch:preview hash=174508f9 — generated from the model by `open-arch fmt`. Don't edit: change the element files instead. -->
```mermaid
flowchart TB
  subgraph checkout_api_boundary["Checkout API [Container]"]
    checkout_controller["Checkout Controller<br/>[Component: Express]"]
    order_repository["Order Repository<br/>[Component: TypeScript]"]
    payment_client["Payment Client<br/>[Component: TypeScript]"]
  end
  payment_provider["Payment Provider<br/>[External System]"]
  warehouse["Warehouse<br/>[System]"]
  orders_db[("Orders DB<br/>[Container: PostgreSQL]")]
  web_app["Web App<br/>[Container: React]"]
  checkout_controller -->|"Saves orders"| order_repository
  checkout_controller -->|"Takes payment"| payment_client
  checkout_controller -->|"Reserves stock<br/>[gRPC]"| warehouse
  order_repository -->|"Reads and writes orders<br/>[SQL]"| orders_db
  payment_client -->|"Charges cards<br/>[HTTPS]"| payment_provider
  web_app -->|"Places orders<br/>[HTTPS/JSON]"| checkout_controller
  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
  classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000
  classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff
  class payment_provider external
  class warehouse system
  class orders_db,web_app container
  class checkout_controller,order_repository,payment_client component
  style checkout_api_boundary fill:none,stroke:#444444,stroke-dasharray:5 5
```
<!-- /open-arch:preview -->
