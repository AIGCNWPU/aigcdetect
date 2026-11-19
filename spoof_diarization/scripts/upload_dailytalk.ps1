# 把 DailyTalk 子集（val+test 需要的 675 个对话）分批 scp 到服务器。
# 断点续传：已存在的批次用 mark 文件记录，重跑会跳过。
$ErrorActionPreference = "Continue"
$src = "D:\chrome_down\dt_subset\dailytalk\data"
$dst = "/mnt/vos-6d37s2q0/users/zqy/datasets/dailytalk/data"
$markDir = "D:\chrome_down\upload_done"
New-Item -ItemType Directory -Force -Path $markDir | Out-Null

$dirs = Get-ChildItem $src -Directory | Sort-Object Name
$batchSize = 40
$total = [math]::Ceiling($dirs.Count / $batchSize)
$index = 0
$started = Get-Date

for ($i = 0; $i -lt $dirs.Count; $i += $batchSize) {
    $index++
    $mark = Join-Path $markDir ("batch_{0:d2}.done" -f $index)
    if (Test-Path $mark) { Write-Output ("[{0}/{1}] skip (done)" -f $index, $total); continue }
    $batch = $dirs[$i..([Math]::Min($i + $batchSize - 1, $dirs.Count - 1))]
    $paths = $batch | ForEach-Object { $_.FullName }
    $ok = $false
    for ($try = 1; $try -le 3 -and -not $ok; $try++) {
        scp -P 22022 -o BatchMode=yes -r -q @paths zqy@101.200.176.142:$dst 2>$null
        $ok = ($LASTEXITCODE -eq 0)
        if (-not $ok) { Write-Output ("batch {0} retry {1}" -f $index, $try); Start-Sleep -Seconds 5 }
    }
    if ($ok) { New-Item -ItemType File -Path $mark -Force | Out-Null }
    $elapsed = ((Get-Date) - $started).TotalSeconds
    Write-Output ("[{0}/{1}] {2} dialogs ok={3} elapsed={4:n0}s" -f $index, $total, $batch.Count, $ok, $elapsed)
}
Write-Output "ALL DONE"
