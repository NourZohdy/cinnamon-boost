@echo off
setlocal DisableDelayedExpansion
set "CINNAMON_BOOST_UPDATE_SCRIPT=%~f0"
set "CINNAMON_BOOST_UPDATE_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$code = (Get-Content -Raw -LiteralPath $env:CINNAMON_BOOST_UPDATE_SCRIPT) -split '(?m)^:powershell\r?\n', 2; & ([ScriptBlock]::Create($code[1]))" && (pause & exit /b 0) || (pause & exit /b 1)
:powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$url = 'https://github.com/NourZohdy/cinnamon-boost/releases/latest/download/cinnamon-boost.zip'
$root = $env:CINNAMON_BOOST_UPDATE_DIR
$zip = $null
$archive = $null
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = [IO.Path]::GetTempFileName()
    Write-Host 'Downloading the Cinnamon Boost update...'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip -TimeoutSec 60
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    $manifest = $archive.GetEntry('manifest.json')
    if (!$manifest) { $manifest = $archive.GetEntry('./manifest.json') }
    if (!$manifest) { throw 'The ZIP is missing manifest.json at its root.' }
    $reader = New-Object IO.StreamReader($manifest.Open())
    try { $version = ($reader.ReadToEnd() | ConvertFrom-Json).version }
    finally { $reader.Dispose() }
    if ($version -isnot [string] -or $version -notmatch '^\d+(\.\d+){0,3}\z') {
        throw 'The ZIP has an invalid extension version.'
    }

    # Check all destinations before writing any files.
    $destinations = @{}
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name.StartsWith('./')) { $name = $name.Substring(2) }
        $path = $root
        $parts = $name.TrimEnd('/') -split '/'
        if (!$name -or $entry.FullName -eq './') { continue }
        for ($i = 0; $i -lt $parts.Count; $i++) {
            $part = $parts[$i];
            if (!$part -or $part.EndsWith('.') -or $part.EndsWith(' ') -or
                $part.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
                $part -match '^(CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3]) *(?:\.|$)') {
                throw "The ZIP contains an unsafe path: $($entry.FullName)"
            }
            $path = Join-Path $path $part
            $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "The update cannot write through a link: $path"
            }
            if ($item -and $item.PSIsContainer -ne ($i -lt $parts.Count - 1 -or $name.EndsWith('/'))) {
                throw "The update path conflicts with an existing file or folder: $path"
            }
        }
        if ($name.EndsWith('/')) { continue }
        if ($destinations.ContainsKey($path)) { throw "The ZIP contains a duplicate file: $name" }
        $destinations[$path] = $entry
    }

    foreach ($path in $destinations.Keys) {
        $folder = [IO.Path]::GetDirectoryName($path)
        [IO.Directory]::CreateDirectory($folder) | Out-Null
        $staged = Join-Path $folder ([IO.Path]::GetRandomFileName())
        $output = [IO.File]::Open($staged, [IO.FileMode]::CreateNew)
        try {
            try {
                $inputFile = $destinations[$path].Open()
                try { $inputFile.CopyTo($output) }
                finally { $inputFile.Dispose() }
            } finally { $output.Dispose() }
            if ([IO.File]::Exists($path)) { [IO.File]::Replace($staged, $path, [NullString]::Value) }
            else { [IO.File]::Move($staged, $path) }
        } finally {
            if ([IO.File]::Exists($staged)) { [IO.File]::Delete($staged) }
        }
    }
    Write-Host "Updated to Cinnamon Boost $version. Now open the Cinnamon Boost popup and click Reload extension (or click the reload arrow in chrome://extensions), then refresh Label Studio."
} catch {
    Write-Host "Could not update Cinnamon Boost. $($_.Exception.Message)"
    Write-Host 'To update manually, download the ZIP and extract it into your Cinnamon Boost folder, replacing the existing files. Then reload the extension and refresh Label Studio.'
    Write-Host $url
    exit 1
} finally {
    if ($archive) { $archive.Dispose() }
    if ($zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
}
