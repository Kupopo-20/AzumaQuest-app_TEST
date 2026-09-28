# Simple static file server for local development.
# Usage: run "powershell -File serve.ps1" in this folder.
#        From a phone on the same Wi-Fi, open http://<this PC's IP>:8000/
#        Note: camera access requires HTTPS or localhost.
# Each request is handled in its own runspace so large files (e.g. video)
# don't block other concurrent requests.

$port = 8000
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$port/  (Ctrl+C to stop)"

$mimeMap = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".mp4"  = "video/mp4"
  ".json" = "application/json"
}

$handler = {
  param($context, $root, $mimeMap)
  $request = $context.Request
  $response = $context.Response
  try {
    try {
      $relPath = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($relPath)) { $relPath = "index.html" }
      $filePath = Join-Path $root $relPath
      if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $mime = $mimeMap[$ext]
        if (-not $mime) { $mime = "application/octet-stream" }
        $response.ContentType = $mime
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
      }
    } finally {
      $response.OutputStream.Close()
    }
  } catch {
    # Client disconnects (e.g. a cancelled video request) land here; ignore and keep serving.
  }
}

$pool = [runspacefactory]::CreateRunspacePool(1, 8)
$pool.Open()
$jobs = New-Object System.Collections.Generic.List[object]

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $ps = [powershell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($context).AddArgument($root).AddArgument($mimeMap)
    $async = $ps.BeginInvoke()
    $jobs.Add(@{ ps = $ps; async = $async })

    for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
      if ($jobs[$i].async.IsCompleted) {
        try { $jobs[$i].ps.EndInvoke($jobs[$i].async) } catch {}
        $jobs[$i].ps.Dispose()
        $jobs.RemoveAt($i)
      }
    }
  }
} finally {
  $listener.Stop()
  $pool.Close()
}
