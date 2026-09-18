$allFiles = git ls-files --others --exclude-standard
$batchSize = 10
$total = $allFiles.Count
Write-Host "Total untracked files remaining: $total"

$batchIndex = 2
for ($i = 0; $i -lt $total; $i += $batchSize) {
    $currentBatch = $allFiles | Select-Object -Skip $i -First $batchSize
    git add -f -- $currentBatch
    $firstFile = $currentBatch[0]
    $msg = "feat: add project files batch $batchIndex ($firstFile and related)"
    git commit -m $msg
    Write-Host "Committed batch $batchIndex ($($currentBatch.Count) files)"
    $batchIndex++
}
