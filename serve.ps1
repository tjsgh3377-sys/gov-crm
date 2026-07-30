param([int]$Port = 0)
if ($Port -eq 0) { if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 8741 } }
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ------------------------------------------------------------------
# 여러 명이 동시에 써도 서로 덮어쓰지 않게 하는 구조
#
#   data.json   : 스냅샷. "어느 시점(snapRev)의 전체 자료"
#   ops.jsonl   : 그 뒤에 일어난 변경만 한 줄씩 덧붙인 기록
#   state.json  : snapRev 과 id 발급 번호
#
# 칸 하나를 고치면 그 칸의 변경만 ops.jsonl 에 쌓이므로, 두 사람이 각자 다른
# 줄을 고쳐도 상대 것이 사라지지 않는다. HttpListener 는 요청을 한 번에 하나만
# 처리하므로 이 덧붙이기 자체가 원자적이다.
# ------------------------------------------------------------------
$dataPath  = Join-Path $root 'data.json'
$opsPath   = Join-Path $root 'ops.jsonl'
$statePath = Join-Path $root 'state.json'
$bakDir    = Join-Path $root 'backups'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$script:snapRev  = 0
$script:ops      = New-Object System.Collections.ArrayList
$script:nextIds  = @{ nextId = 1; nextGenId = 1; nextNoticeId = 1 }

function Get-Rev { return $script:snapRev + $script:ops.Count }

function Write-State {
  $o = [ordered]@{
    snapRev      = $script:snapRev
    nextId       = $script:nextIds.nextId
    nextGenId    = $script:nextIds.nextGenId
    nextNoticeId = $script:nextIds.nextNoticeId
  }
  [System.IO.File]::WriteAllText($statePath, ($o | ConvertTo-Json -Compress), $utf8NoBom)
}

function Initialize-Store {
  if (Test-Path $statePath) {
    try {
      $s = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
      $script:snapRev = [int]$s.snapRev
      foreach ($k in @('nextId', 'nextGenId', 'nextNoticeId')) {
        if ($s.$k) { $script:nextIds[$k] = [int]$s.$k }
      }
    } catch { Write-Host "  state.json 을 읽지 못해 새로 만듭니다." -ForegroundColor Yellow }
  } elseif (Test-Path $dataPath) {
    # 처음 한 번만 data.json 을 읽어 id 발급 번호를 가져온다
    try {
      $d = Get-Content $dataPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($k in @('nextId', 'nextGenId', 'nextNoticeId')) {
        if ($d.$k) { $script:nextIds[$k] = [int]$d.$k }
      }
    } catch {}
  }
  if (Test-Path $opsPath) {
    foreach ($ln in [System.IO.File]::ReadAllLines($opsPath, [System.Text.Encoding]::UTF8)) {
      if ($ln -and $ln.Trim()) { [void]$script:ops.Add($ln) }
    }
  }
  Write-State
}

# 변경 한 묶음을 ops.jsonl 에 덧붙이고 새 rev 를 돌려준다.
# cid 는 보낸 브라우저의 임시 식별자. 각 브라우저가 "내가 보낸 변경"을 되받아
# 지금 입력 중인 칸을 덮어쓰지 않도록 걸러내는 데 쓴다.
function Add-Ops($opsJsonArray, $user, $cid) {
  $r = (Get-Rev) + 1
  $who = ($user | ConvertTo-Json -Compress)
  if (-not $user) { $who = '""' }
  $me = ($cid | ConvertTo-Json -Compress)
  if (-not $cid) { $me = '""' }
  $line = '{"rev":' + $r + ',"by":' + $who + ',"cid":' + $me + ',"at":"' + (Get-Date -Format 's') + '","ops":' + $opsJsonArray + '}'
  [System.IO.File]::AppendAllText($opsPath, $line + "`n", $utf8NoBom)
  [void]$script:ops.Add($line)
  return $r
}

# 스냅샷 교체(엑셀 대량등록·업체 추가 등 큰 변경). 이전 스냅샷은 backups 에 남긴다
function Set-Snapshot($bodyText) {
  if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
  if (Test-Path $dataPath) {
    Copy-Item $dataPath (Join-Path $bakDir ('data-' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')) -Force
    Copy-Item $dataPath (Join-Path $root 'data.backup.json') -Force
    # 최근 40개만 유지
    Get-ChildItem $bakDir -Filter 'data-*.json' | Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 40 | ForEach-Object { Remove-Item $_.FullName -Force }
  }
  $tmp = $dataPath + '.tmp'
  [System.IO.File]::WriteAllText($tmp, $bodyText, $utf8NoBom)
  Move-Item $tmp $dataPath -Force
  $script:snapRev = Get-Rev
  $script:ops.Clear()
  if (Test-Path $opsPath) { Remove-Item $opsPath -Force }
  Write-State
  return $script:snapRev
}

Initialize-Store

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
$blocked = @('admin.config.json', 'serve.ps1', 'data.json', 'data.backup.json',
             'ops.jsonl', 'state.json')

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

# 직원에게 보내는 링크에 넣는 열쇠.
# 비밀번호와 따로 두는 이유: 비밀번호를 바꿔도 이미 보낸 링크가 살아 있고,
# 반대로 링크가 새어 나가면 이 열쇠만 지워서 링크 전부를 한 번에 무효화할 수 있다.
function Get-LinkKey {
  $cfgPath = Join-Path $root 'admin.config.json'
  $cfg = $null
  if (Test-Path $cfgPath) {
    try { $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  }
  if ($cfg -and $cfg.linkKey) { return [string]$cfg.linkKey }
  # 아직 없으면 한 번만 만들어 설정 파일에 적어 둔다 (다음 실행에도 같은 링크가 유지되게)
  $chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  $key = -join (1..28 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
  if (-not $cfg) { $cfg = [pscustomobject]@{ password = (Get-Password) } }
  $cfg | Add-Member -NotePropertyName linkKey -NotePropertyValue $key -Force
  try {
    [System.IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 5), $utf8NoBom)
    Write-Host "  직원 링크 열쇠를 새로 만들었습니다 (admin.config.json 에 저장)." -ForegroundColor Yellow
  } catch {
    Write-Host "  admin.config.json 에 링크 열쇠를 저장하지 못했습니다. 다시 실행하면 열쇠가 바뀝니다." -ForegroundColor Red
  }
  return $key
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
      # 비밀번호로 들어오든 링크 열쇠로 들어오든 똑같이 인정한다
      $token = $req.Headers['X-Admin-Token']
      $authed = ($token -and (($token -eq (Get-Password)) -or ($token -eq (Get-LinkKey))))

      if ($path -eq '/api/login' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        $pw = $null
        try { $pw = ($body | ConvertFrom-Json).password } catch {}
        if ($pw -eq (Get-Password)) { Send-Json $resp @{ ok = $true; token = (Get-Password) } }
        elseif ($pw -eq (Get-LinkKey)) { Send-Json $resp @{ ok = $true; token = (Get-LinkKey) } }
        else { Send-Json $resp @{ ok = $false; error = 'invalid password' } 401 }
        continue
      }

      if (-not $authed) { Send-Json $resp @{ ok = $false; error = 'unauthorized' } 401; continue }

      # 직원에게 보낼 링크를 앱에서 만들 수 있도록 열쇠를 알려준다
      if ($path -eq '/api/linkkey' -and $method -eq 'GET') {
        Send-Json $resp @{ ok = $true; key = (Get-LinkKey) }
        continue
      }

      # 스냅샷 내려주기. 이 응답이 담고 있는 시점은 X-Rev 헤더로 알려준다
      if ($path -eq '/api/data' -and $method -eq 'GET') {
        $resp.Headers['X-Rev'] = [string]$script:snapRev
        if (-not (Test-Path $dataPath)) {
          Send-Text $resp '{"meta":{"title":"고객관리 센터","programs":["수출바우처","혁신바우처","소공인판로개척지원사업","기타정부사업"],"categories":["기고객","신규고객"],"staff":[]},"nextId":1,"customers":[],"nextGenId":1,"genCustomers":[],"nextNoticeId":1,"notices":[]}' 200 'application/json; charset=utf-8'
          continue
        }
        Send-Text $resp (Get-Content $dataPath -Raw -Encoding UTF8) 200 'application/json; charset=utf-8'
        continue
      }

      # 내가 본 시점(since) 이후 다른 사람이 바꾼 내용만 받아간다 (3초마다 호출)
      if ($path -eq '/api/changes' -and $method -eq 'GET') {
        $since = 0
        if ($req.QueryString['since']) { try { $since = [int]$req.QueryString['since'] } catch {} }
        if ($since -lt $script:snapRev) {
          # 그 사이 스냅샷이 새로 만들어져 변경 기록이 정리됐다 → 전체를 다시 받아야 한다
          Send-Text $resp ('{"ok":true,"reload":true,"rev":' + (Get-Rev) + '}') 200 'application/json; charset=utf-8'
          continue
        }
        $take = @()
        $skip = $since - $script:snapRev
        if ($skip -lt $script:ops.Count) { $take = $script:ops[$skip..($script:ops.Count - 1)] }
        Send-Text $resp ('{"ok":true,"rev":' + (Get-Rev) + ',"lines":[' + ($take -join ',') + ']}') 200 'application/json; charset=utf-8'
        continue
      }

      # 변경 한 묶음 기록. 본문은 op 객체들의 배열
      if ($path -eq '/api/patch' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        # JSON 문법상 문자열 안에 생 줄바꿈은 못 들어오므로, 남은 줄바꿈은 토큰 사이 공백이라 안전하게 치환된다
        $body = $body.Replace("`r", ' ').Replace("`n", ' ')
        $parsed = $null
        try { $parsed = $body | ConvertFrom-Json } catch { Send-Json $resp @{ ok = $false; error = 'invalid json' } 400; continue }
        if ($parsed -isnot [System.Array]) { Send-Json $resp @{ ok = $false; error = 'ops array required' } 400; continue }
        if ($parsed.Count -eq 0) { Send-Text $resp ('{"ok":true,"rev":' + (Get-Rev) + '}') 200 'application/json; charset=utf-8'; continue }
        $user = $req.Headers['X-User']
        if ($user) { try { $user = [System.Uri]::UnescapeDataString($user) } catch {} }
        $newRev = Add-Ops $body $user $req.Headers['X-Client']
        Send-Text $resp ('{"ok":true,"rev":' + $newRev + '}') 200 'application/json; charset=utf-8'
        continue
      }

      # 새 줄에 붙일 id 를 서버가 발급한다 (직원끼리 같은 id 를 쓰지 않도록)
      if ($path -eq '/api/newid' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        $key = $null; $n = 1
        try { $q = $body | ConvertFrom-Json; $key = $q.key; if ($q.n) { $n = [int]$q.n } } catch {}
        if (-not $script:nextIds.ContainsKey([string]$key)) { Send-Json $resp @{ ok = $false; error = 'unknown key' } 400; continue }
        if ($n -lt 1) { $n = 1 }
        if ($n -gt 20000) { $n = 20000 }
        $start = $script:nextIds[[string]$key]
        $script:nextIds[[string]$key] = $start + $n
        Write-State
        Send-Text $resp ('{"ok":true,"start":' + $start + ',"n":' + $n + '}') 200 'application/json; charset=utf-8'
        continue
      }

      # 전체 스냅샷 교체 (엑셀 대량등록·업체 추가처럼 큰 변경).
      # X-Rev 가 서버의 현재 rev 와 다르면 그 사이 누군가 바꿨다는 뜻이라 거절한다.
      if ($path -eq '/api/save' -and $method -eq 'POST') {
        $body = [System.Text.Encoding]::UTF8.GetString((Read-BodyBytes $req))
        $obj = $null
        try { $obj = $body | ConvertFrom-Json } catch { Send-Json $resp @{ ok = $false; error = 'invalid json' } 400; continue }
        $cli = $req.Headers['X-Rev']
        if ($cli -ne $null -and $cli -ne '') {
          $cliRev = -1
          try { $cliRev = [int]$cli } catch {}
          if ($cliRev -ne (Get-Rev)) {
            Send-Text $resp ('{"ok":false,"stale":true,"rev":' + (Get-Rev) + '}') 409 'application/json; charset=utf-8'
            continue
          }
        }
        foreach ($k in @('nextId', 'nextGenId', 'nextNoticeId')) {
          if ($obj.$k) { $v = [int]$obj.$k; if ($v -gt $script:nextIds[$k]) { $script:nextIds[$k] = $v } }
        }
        $r = Set-Snapshot $body
        Send-Text $resp ('{"ok":true,"rev":' + $r + '}') 200 'application/json; charset=utf-8'
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
