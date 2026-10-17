---
kind: view
title: Shop containers
level: container
scope: shop
include: ["*"]
---

# Shop containers

What runs inside the shop.

<!-- open-arch:preview hash=2c976f44 — generated from the model by `open-arch fmt`. Don't edit: change the element files instead. -->
```mermaid
flowchart TB
  customer(["Customer<br/>[Person]"])
  subgraph shop_boundary["Shop [System]"]
    checkout_api["Checkout API<br/>[Container: Node.js]"]
    orders_db[("Orders DB<br/>[Container: PostgreSQL]")]
    web_app["Web App<br/>[Container: React]"]
  end
  payment_provider["Payment Provider<br/>[External System]"]
  warehouse["Warehouse<br/>[System]"]
  checkout_api -->|"Reads and writes orders<br/>[SQL]"| orders_db
  checkout_api -->|"Charges cards<br/>[HTTPS]"| payment_provider
  checkout_api -->|"Reserves stock<br/>[gRPC]"| warehouse
  customer -->|"Browses products and places orders<br/>[HTTPS]"| web_app
  web_app -->|"Places orders<br/>[HTTPS/JSON]"| checkout_api
  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
  classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000
  classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff
  class customer person
  class payment_provider external
  class warehouse system
  class checkout_api,orders_db,web_app container
  style shop_boundary fill:none,stroke:#444444,stroke-dasharray:5 5
```
<!-- /open-arch:preview -->

<!-- open-arch:layout
{
  "nodes": {
    "checkout-api": {"x": 0, "y": 320},
    "customer": {"x": 0, "y": 0},
    "orders-db": {"x": 0, "y": 480},
    "web-app": {"x": 0, "y": 160}
  }
}
-->
