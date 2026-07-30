param([int]$Port = 0)
if ($Port -eq 0) { if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 8741 } }
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "정부지원사업 고객관리:  http://localhost:$Port/"

$mime = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8';
  '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg';
  '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.svg'='image/svg+xml';
  '.webp'='image/webp'; '.bmp'='image/bmp';
  '.ico'='image/x-icon'; '.woff'='font/woff'; '.woff2'='font/woff2';
  '.ttf'='font/ttf'; '.pdf'='application/pdf'; '.map'='application/json'
}

# 브라우저에 직접 노출하면 안 되는 파일 (data.json 은 인증된 API 로만 접근)
$blocked = @('admin.config.json', 'serve.ps1', 'data.json', 'data.backup.json')

$script:tempPw = $null
function Get-Password {
  $cfgPath = Join-Path $root 'admin.config.json'
  if (Test-Path $cfgPath) {
    try { return (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).password } catch {}
  }
  # 설정 파일이 없으면 고정 기본값 대신 실행할 때마다 임시 비밀번호를 발급한다
  if (-not $script:tempPw) {
    $chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    $script:tempPw = -join (1..10 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    Write-Host ''
    Write-Host "  admin.config.json 이 없어 임시 비밀번호를 발급했습니다:  $script:tempPw" -ForegroundColor Yellow
    Write-Host '  고정하려면 admin.config.example.json 을 admin.config.json 으로 복사해 password 를 바꾸세요.' -ForegroundColor Yellow
    Write-Host ''
  }
  return $script:tempPw
}

function Read-BodyBytes($req) {
  $ms = New-Object System.IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  return $ms.ToArray()
}

function Send-Json($resp, $obj, $status = 200) {
  $resp.StatusCode = $status
  $resp.ContentType = 'application/json; charset=utf-8'
  $json = ($obj | ConvertTo-Json -Depth 20 -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.OutputStream.Close()
}

function Send-Text($resp, $text, $status = 200, $type = 'text/plain; charset=utf-8') {
  $resp.StatusCode = $status
  $resp.ContentType = $type
  $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$text)
  $resp.ContentLength64 = $bytes.Length
  $resp.OutputStream.Write($bytes, 0, $bytes.Length)
  $resp.OutputStream.Close()
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $resp = $ctx.Response
    $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
    $method = $req.HttpMethod

    # ---------- API ----------
    if ($path.StartsWith('/api/')) {
      $token = $req.Headers['X-Admin-Token']
      $authed = ($token -and ($token -eq (Get-Password)))

      if ($path -eq '/api/login' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        $pw = $null
        try { $pw = ($body | ConvertFrom-Json).password } catch {}
        if ($pw -eq (Get-Password)) { Send-Json $resp @{ ok = $true; token = (Get-Password) } }
        else { Send-Json $resp @{ ok = $false; error = 'invalid password' } 401 }
        continue
      }

      if (-not $authed) { Send-Json $resp @{ ok = $false; error = 'unauthorized' } 401; continue }

      if ($path -eq '/api/data' -and $method -eq 'GET') {
        $dp = Join-Path $root 'data.json'
        if (-not (Test-Path $dp)) {
          Send-Text $resp '{"meta":{"title":"고객관리 센터","programs":["수출바우처","혁신바우처","소공인판로개척지원사업","기타정부사업"],"categories":["기고객","신규고객"]},"nextId":1,"customers":[],"nextGenId":1,"genCustomers":[],"nextNoticeId":1,"notices":[]}' 200 'application/json; charset=utf-8'
          continue
        }
        Send-Text $resp (Get-Content $dp -Raw -Encoding UTF8) 200 'application/json; charset=utf-8'
        continue
      }

      if ($path -eq '/api/save' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        try { $null = $body | ConvertFrom-Json } catch { Send-Json $resp @{ ok = $false; error = 'invalid json' } 400; continue }
        # 저장 전 백업 1부 유지
        $dp = Join-Path $root 'data.json'
        if (Test-Path $dp) { Copy-Item $dp (Join-Path $root 'data.backup.json') -Force }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($dp, $body, $utf8)
        Send-Json $resp @{ ok = $true }
        continue
      }

      # 문의 첨부 이미지 업로드 (원본 파일은 uploads/ 에 안전한 이름으로 저장)
      if ($path -eq '/api/upload' -and $method -eq 'POST') {
        $ext = ''
        $fnRaw = $req.Headers['X-File-Name']
        if ($fnRaw) { try { $ext = [System.IO.Path]::GetExtension([System.Uri]::UnescapeDataString($fnRaw)).ToLower() } catch {} }
        $allowed = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp')
        if ($allowed -notcontains $ext) { Send-Json $resp @{ ok = $false; error = '이미지 파일만 첨부할 수 있습니다.' } 400; continue }
        $bytes = Read-BodyBytes $req
        if ($bytes.Length -eq 0) { Send-Json $resp @{ ok = $false; error = '빈 파일' } 400; continue }
        if ($bytes.Length -gt 10485760) { Send-Json $resp @{ ok = $false; error = '10MB 이하만 첨부할 수 있습니다.' } 400; continue }
        $updir = Join-Path $root 'uploads'
        if (-not (Test-Path $updir)) { New-Item -ItemType Directory -Path $updir | Out-Null }
        $nm = 'img_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + ([System.Guid]::NewGuid().ToString('N').Substring(0, 8)) + $ext
        [System.IO.File]::WriteAllBytes((Join-Path $updir $nm), $bytes)
        Send-Json $resp @{ ok = $true; file = ('uploads/' + $nm) }
        continue
      }

      # 계약 첨부 파일 업로드 (견적서·작업자료·계약서 등 문서 허용, 원본 파일명 반환)
      if ($path -eq '/api/upload-file' -and $method -eq 'POST') {
        $orig = ''
        $ext = ''
        $fnRaw = $req.Headers['X-File-Name']
        if ($fnRaw) { try { $orig = [System.Uri]::UnescapeDataString($fnRaw); $ext = [System.IO.Path]::GetExtension($orig).ToLower() } catch {} }
        $allowed = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf', '.hwp', '.hwpx', '.doc', '.docx', '.xls', '.xlsx', '.xlsm', '.csv', '.ppt', '.pptx', '.txt', '.rtf', '.ai', '.psd', '.eps', '.svg', '.zip')
        if ($allowed -notcontains $ext) { Send-Json $resp @{ ok = $false; error = '허용되지 않는 파일 형식입니다.' } 400; continue }
        $bytes = Read-BodyBytes $req
        if ($bytes.Length -eq 0) { Send-Json $resp @{ ok = $false; error = '빈 파일' } 400; continue }
        if ($bytes.Length -gt 52428800) { Send-Json $resp @{ ok = $false; error = '50MB 이하만 첨부할 수 있습니다.' } 400; continue }
        $updir = Join-Path $root 'uploads'
        if (-not (Test-Path $updir)) { New-Item -ItemType Directory -Path $updir | Out-Null }
        $nm = 'file_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + ([System.Guid]::NewGuid().ToString('N').Substring(0, 8)) + $ext
        [System.IO.File]::WriteAllBytes((Join-Path $updir $nm), $bytes)
        if (-not $orig) { $orig = $nm }
        Send-Json $resp @{ ok = $true; file = ('uploads/' + $nm); name = $orig }
        continue
      }

      Send-Json $resp @{ ok = $false; error = 'not found' } 404
      continue
    }

    # ---------- Static files ----------
    $rel = $path.TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    if ($blocked -contains $rel) { Send-Text $resp 'Forbidden' 403; continue }

    $file = Join-Path $root $rel
    if (Test-Path $file -PathType Container) { $file = Join-Path $file 'index.html' }
    if (Test-Path $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $resp.ContentType = $mime[$ext] }
      $resp.Headers['Cache-Control'] = 'no-store'
      $b = [System.IO.File]::ReadAllBytes($file)
      $resp.ContentLength64 = $b.Length
      $resp.OutputStream.Write($b, 0, $b.Length)
      $resp.OutputStream.Close()
    } else {
      Send-Text $resp '404 Not Found' 404
    }
  } catch {
    try { $resp.StatusCode = 500; $resp.OutputStream.Close() } catch {}
  }
}
