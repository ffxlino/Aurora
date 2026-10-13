param([string]$Source,[string]$Target,[string]$Previous,[int]$ParentId,[string]$Expected,[string]$ResultFile)
$ErrorActionPreference='Stop'
$moved=$false
try {
  Wait-Process -Id $ParentId -Timeout 60 -ErrorAction SilentlyContinue
  if(Get-Process -Id $ParentId -ErrorAction SilentlyContinue){throw 'Aurora ещё открыта'}
  $stream=[System.IO.File]::OpenRead($Source)
  $digest=[System.Security.Cryptography.SHA256]::Create()
  try {$actual=([System.BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally {$stream.Dispose();$digest.Dispose()}
  if($actual -ne $Expected){throw 'Обновление повреждено'}
  for($attempt=0;$attempt -lt 60;$attempt++) {
    try {Move-Item -LiteralPath $Target -Destination $Previous;$moved=$true;break} catch {if($attempt -eq 59){throw};Start-Sleep -Milliseconds 500}
  }
  Move-Item -LiteralPath $Source -Destination $Target
  @{state='installed'} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding utf8
  Start-Process -FilePath $Target -WindowStyle Normal
  Remove-Item -LiteralPath $Previous -Force -ErrorAction SilentlyContinue
} catch {
  if($moved -and (Test-Path -LiteralPath $Previous)){Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue;Move-Item -LiteralPath $Previous -Destination $Target}
  @{state='error';message=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $ResultFile -Encoding utf8
  if($moved){Start-Process -FilePath $Target -WindowStyle Normal}
}
