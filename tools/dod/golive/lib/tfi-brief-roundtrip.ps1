# tfi-brief-roundtrip.ps1 - G3-TFI-HUB-LPHHW QA round trip against PRODUCTION, values never printed.
#
# Phase create : TFI production builds + delivers ONE QA-prefixed `tfi.u4-game-brief.v1` brief through the
#                Hub broker; the script then reads it back in LPHHW through the Hub AND directly with the
#                LPHHW service token. Emits JSON { idempotencyKey, key8, contentHash8, hubId, lphhwId,
#                readbackStatus, directReadbackStatus }.
# Phase cleanup: deletes exactly that QA brief through the LPHHW QA delete route and proves the readback is
#                404 afterwards. Emits JSON { deleted, afterReadbackStatus }.
#
# The brief content is QA-only text (no real content, no clinical terms). Tokens come from the DPAPI vault
# and are never echoed; the output carries only statuses, ids and an 8-char key prefix.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('create', 'cleanup')][string]$Phase,
    [string]$Ref = 'QA-TFI-HUB',
    [string]$Key = '',
    [string]$TfiBase = 'https://tourism-intelligence-engine.vercel.app',
    [string]$HubBase = 'https://funaging-omnichannel-hub.vercel.app',
    [string]$LphhwBase = 'https://lphhw.vercel.app',
    [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Import-Module 'D:\FUNAGING_TEMP\eco_owner\tools\FunagingSecrets.psm1' -Force

function Call([string]$Method, [string]$Url, [hashtable]$Headers, [string]$Body) {
    $p = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 120; SkipHttpErrorCheck = $true }
    if ($Headers.Count) { $p.Headers = $Headers }
    if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
    $r = Invoke-WebRequest @p
    $obj = $null
    try { $obj = $r.Content | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ status = [int]$r.StatusCode; body = $obj; raw = $r.Content }
}

$rec = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); phase = $Phase; ref = $Ref }

if ($Phase -eq 'create') {
    if (-not (Test-FunagingSecret -Key 'TFI_RESEARCH_API_TOKEN')) { throw 'TFI bearer missing from the vault' }
    $tfiTok = Get-FunagingSecret -Key 'TFI_RESEARCH_API_TOKEN'
    $body = (@{
        qaRef = $Ref
        targetGroup = 'track-c-g3-qa'
        candidates = @(@{
            title = 'QA bridge candidate for the G3 production E2E'
            rationale = "$Ref - contract proof only; no real content, no clinical terms"
            evidenceIds = @("$Ref-evidence")
            purposeDomains = @('cognitive')
        })
        withheldCount = 0
    } | ConvertTo-Json -Depth 6 -Compress)
    $created = Call 'POST' "$TfiBase/v1/bridge/u4-brief" @{ Authorization = "Bearer $tfiTok" } $body
    Remove-Variable tfiTok -Force
    $rec.tfiCreateStatus = $created.status
    $rec.idempotencyKey = [string]$created.body.idempotencyKey
    $rec.key8 = if ($rec.idempotencyKey.Length -ge 8) { $rec.idempotencyKey.Substring(0, 8) } else { '' }
    $rec.contentHash8 = ([string]$created.body.contentHash).Substring(0, [Math]::Min(8, ([string]$created.body.contentHash).Length))
    $rec.lphhwId = [string]$created.body.lphhwId
    if ($created.status -ne 200 -or $rec.idempotencyKey.Length -ne 64) {
        $rec.ok = $false
        $rec.error = "TFI create answered $($created.status) $($created.raw.Substring(0, [Math]::Min(200, $created.raw.Length)))"
    } else {
        $hubTok = Get-FunagingSecret -Key 'HUB_INGEST_TOKEN'
        $hubRead = Call 'GET' "$HubBase/api/tfi/brief" @{ Authorization = "Bearer $hubTok"; 'x-tenant-id' = 'track-c-g3'; 'x-idempotency-key' = $rec.idempotencyKey } ''
        Remove-Variable hubTok -Force
        $svc = Get-FunagingSecret -Key 'LPHHW_SERVICE_TOKEN'
        $direct = Call 'GET' "$LphhwBase/api/u4/briefs/$($rec.idempotencyKey)" @{ 'x-tfi-service-token' = $svc; 'x-tenant-id' = 'track-c-g3' } ''
        Remove-Variable svc -Force
        $rec.hubReadbackStatus = $hubRead.status
        $rec.directReadbackStatus = $direct.status
        $rec.receivedAt = [string]$direct.body.receivedAt
        $rec.ok = ($hubRead.status -eq 200 -and $direct.status -eq 200 -and $rec.lphhwId)
        if (-not $rec.ok) { $rec.error = "readback hub=$($hubRead.status) direct=$($direct.status)" }
    }
} else {
    if ($Key.Length -ne 64) { throw 'cleanup needs the 64-char idempotency key of the QA brief' }
    $svc = Get-FunagingSecret -Key 'LPHHW_SERVICE_TOKEN'
    $h = @{ 'x-tfi-service-token' = $svc; 'x-tenant-id' = 'track-c-g3' }
    $del = Call 'DELETE' "$LphhwBase/api/u4/briefs/$Key" $h ''
    $after = Call 'GET' "$LphhwBase/api/u4/briefs/$Key" $h ''
    Remove-Variable svc -Force
    $rec.deleted = ($del.status -eq 200 -or $del.status -eq 204 or $del.status -eq 202)
    $rec.deleteStatus = $del.status
    $rec.afterReadbackStatus = $after.status
    $rec.ok = ($rec.deleted -and $after.status -eq 404)
    if (-not $rec.ok) { $rec.error = "delete=$($del.status) after=$($after.status)" }
}

# `idempotencyKey` is the QA brief's public identifier (it must be handed to the cleanup phase); it is not a
# credential. No vault value is ever placed in $rec, so nothing secret can reach this output.
$json = ($rec | ConvertTo-Json -Depth 6)
if ($Out) { $json | Set-Content -LiteralPath $Out -Encoding UTF8 }
Write-Output $json
if (-not $rec.ok) { exit 1 }
exit 0
