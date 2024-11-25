# Mento Analytics API

A NestJS-based API for retrieving Mento Analytics Data

## Project Structure

```bash
src/
├── app.module.ts                # Root module
├── main.ts                      # Entry point
│
├── api/                         # API features
│   ├── stablecoins/            # Stablecoin-related endpoints
│   │   ├── stablecoins.controller.ts
│   │   ├── stablecoins.service.ts
│   │   ├── stablecoins.module.ts
│   │   └── dto/
│   │       └── stablecoin.dto.ts
│   │
│   ├── reserve/                # Reserve-related endpoints
│   │   ├── reserve.controller.ts
│   │   ├── reserve.service.ts
│   │   ├── reserve.module.ts
│   │   └── dto/
│   │       ├── reserve-holdings.dto.ts
│   │       └── reserve-composition.dto.ts
│   │
│   └── health/                 # Health check endpoints
│       ├── health.controller.ts
│       └── health.module.ts
│
├── common/                      
│   └── services/                # Shared services
│       └── mento.service.ts     
│
├── types/                       # Shared types/interfaces
│   └── api.types.ts
│
└── utils/                       # Utility functions
    ├── responses.util.ts
    └── validation.util.ts
```

## Features

- **Stablecoins API**: Endpoints for retrieving stablecoin information
- **Reserve API**: Access to reserve holdings and composition data
- **Health Checks**: Service health monitoring
- **Error Handling**: Standardized error responses

## Getting Started

### Prerequisites

- Node.js (v21+)
- pnpm

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run start:dev

# Build for production
pnpm run build

# Start production server
pnpm run start:prod
```

### Environment Variables

Create a `.env` file in the root directory:

```env
cp .env.example sample
```

## API Documentation

API documentation is available at `/docs` when running the server (Swagger UI).

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
