``` bash

src/
├── app.module.ts                # Root module
├── main.ts                      # Entry point
│
├── api/                         # API features
│   ├── stablecoins/
│   │   ├── stablecoins.controller.ts
│   │   ├── stablecoins.service.ts
│   │   ├── stablecoins.module.ts
│   │   └── dto/
│   │       └── stablecoin.dto.ts
│   │
│   ├── reserve/
│   │   ├── reserve.controller.ts
│   │   ├── reserve.service.ts
│   │   ├── reserve.module.ts
│   │   └── dto/
│   │       ├── reserve-holdings.dto.ts
│   │       └── reserve-composition.dto.ts
│   │
│   └── health/
│       ├── health.controller.ts
│       └── health.module.ts
│
├── common/                      # Shared resources
│   ├── middleware/
│   │   ├── rate-limiter.middleware.ts
│   │   └── cache.middleware.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   └── services/
│       └── mento.service.ts
│
├── types/                       # Shared types/interfaces
│   └── api.types.ts
│
└── utils/                       # Utility functions
    ├── responses.util.ts
    └── validation.util.ts

```