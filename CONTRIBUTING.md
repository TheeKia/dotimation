# Contributing to dotimation

Thank you for your interest in contributing to our project! This guide will help you get started with the development process.

See [AGENTS.md](AGENTS.md) for architecture, invariants, and repository commands.

## Development Setup

### Prerequisites

- Bun installed on your system

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/TheeKia/dotimation.git`
3. Navigate to the project directory: `cd dotimation`
4. Install dependencies: `bun install`
5. Start development: `bun run dev`

### Development Mode

Run `bun run dev` for React or `bun run dev:svelte` for Svelte (normally http://localhost:5173). Each Vite playground imports its adapter and core directly from workspace source; no package build is needed for live edits. Package boundaries and lifecycle ownership are documented in [docs/architecture.md](docs/architecture.md).

## Development Workflow

1. Create a new branch: `git checkout -b feature/your-feature-name`
2. Start development mode: `bun run dev`
3. Make your changes and test them live in the preview app
4. Check and fix code style and formatting issues: `bun run lint:fix`
5. Run `bun run type-check`, `bun test`, and `bun run test:e2e` (install Chromium once with `bunx playwright install chromium`).
6. Build and validate all packages: `bun run build && bun run check:dist && bun run test:packages`. The last command installs packed artifacts into temporary, isolated consumers and checks their types, production output, SSR, and browser rendering.
7. Build both playgrounds with `bun run --cwd apps/playground-react build` and `bun run --cwd apps/playground-svelte build`.
8. Commit your changes using the conventions below
9. Push your branch to your fork
10. Open a pull request

Formatting uses Biome for TypeScript/configuration and Prettier with its Svelte plugin for component files. Svelte semantic diagnostics run in `bun run type-check`. Shared options and behavior belong in core; adapters own framework lifecycle and DOM presentation.

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for clear and structured commit messages:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code changes that neither fix bugs nor add features
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Maintenance tasks, dependencies, etc.

## Pull Request Guidelines

1. Update documentation if needed
2. Ensure all tests pass
3. Address any feedback from code reviews
4. Once approved, your PR will be merged

## Code of Conduct

Please be respectful and constructive in all interactions within our community.

## Questions?

If you have any questions, please [open an issue](https://github.com/TheeKia/dotimation/issues/new) for discussion.

Thank you for contributing to dotimation!
