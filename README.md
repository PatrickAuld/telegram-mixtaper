# telegram-mixtaper

Telegram bot that adds Spotify links to a playlist

## Development

This project uses [uv](https://github.com/astral-sh/uv) for dependency management. To create a virtual environment with the project and development dependencies, run:

```bash
uv sync --dev
```

### Running the bot locally

Set the required environment variables and then start the bot with:

```bash
uv run python bot.py
```

### Tests

The repository does not include automated unit tests, but the static checks ensure the sources compile. To run them locally use:

```bash
scripts/test.sh
```

### Building a standalone executable

Use the build script to generate a single-file executable with bundled dependencies. The executable is written to `dist/telegram-mixtaper` by default.

```bash
scripts/build.sh
```

Pass a custom output directory or executable name by supplying arguments:

```bash
scripts/build.sh build custom-name
```

The CI workflow runs these commands automatically on every push and pull request.
