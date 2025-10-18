# dotimation

Animate anything with dots

## Installation

```bash
bun add dotimation
```

## Usage

Dotimation makes use of react-query so make sure this is used inside a QueryClientProvider

```tsx
import { Dotimation } from 'dotimation';

function Component() {
	return (
		<Dotimation
			item={{ type: 'text', data: 'Hello' }}
			width={256}
			height={256}
		/>
	);
}
```

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

MIT
