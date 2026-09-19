# Create a source-only archive for a Pi that does not yet have the app files.
# This avoids copying Windows dependencies, build output, test databases, and secrets.
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDir = Join-Path $projectRoot 'data/deploy-bundles'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$archivePath = Join-Path $outputDir ("tracker-pi-{0}.tar.gz" -f [guid]::NewGuid().ToString('N'))

$sourcePaths = @(
  'app', 'db', 'lib', 'public', 'scripts', 'infra/docker/pi', 'docs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'next.config.ts', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.mjs',
  '.dockerignore', 'README.md'
)
$excludeArgs = @(
  '--exclude=secrets', '--exclude=.env', '--exclude=.env.*',
  '--exclude=node_modules', '--exclude=data', '--exclude=.next-node',
  '--exclude=*.log', '--exclude=*.tar.gz'
)

& tar.exe -czf $archivePath -C $projectRoot @excludeArgs @sourcePaths
if ($LASTEXITCODE -ne 0) { throw 'Could not create the Pi source archive.' }
$contents = & tar.exe -tzf $archivePath
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the Pi source archive.' }
$sensitive = $contents | Where-Object {
  $_ -match '(^|/)(secrets|node_modules|data)(/|$)' -or
  $_ -match '(^|/)\.env(\.|/|$)'
}
if ($sensitive) {
  throw 'The archive contains excluded local data or secrets. Do not copy it to the Pi.'
}

Write-Output "Pi source archive: $archivePath"
Write-Output 'Only source files and deployment instructions were included.'
