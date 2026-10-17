---
kind: view
title: System landscape
level: landscape
---

# System landscape

Every person and system, and how they connect.

<!-- open-arch:preview hash=4f221059 — generated from the model by `open-arch fmt`. Don't edit: change the element files instead. -->
```mermaid
flowchart TB
  customer(["Customer<br/>[Person]"])
  payment_provider["Payment Provider<br/>[External System]"]
  shop["Shop<br/>[System]"]
  warehouse["Warehouse<br/>[System]"]
  customer -->|"Browses products and places orders<br/>[HTTPS]"| shop
  shop -->|"Charges cards<br/>[HTTPS]"| payment_provider
  shop -->|"Reserves stock<br/>[gRPC]"| warehouse
  classDef person fill:#08427b,stroke:#052e56,color:#ffffff
  classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff
  classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff
  classDef component fill:#85bbf0,stroke:#5d82a8,color:#000000
  classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff
  class customer person
  class payment_provider external
  class shop,warehouse system
```
<!-- /open-arch:preview -->
