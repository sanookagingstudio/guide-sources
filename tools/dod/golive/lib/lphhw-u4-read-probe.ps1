# lphhw-u4-read-probe.ps1 - G3-TFI-HUB-LPHHW read-only live probe. Emits ONE JSON object.
#
# It proves, against the REAL production systems, what the bridge can and cannot do WITHOUT writing
# anything:
#   * the three bridge credentials exist in the DPAPI vault (names + BOOL only, never a value),
#   * Hub /health + /version answer 200,
#   * an anonymous POST /api/tfi/brief is refused 401 UNAUTHORIZED (fail-closed),
#   * an AUTHORIZED GET /api/tfi/brief with an unknown idempotency key reaches LPHHW and answers
#     404 NOT_FOUND (the read path through the broker is live and authenticated),
#   * LPHHW /version.json answers 200,
#   * LPHHW GET /api/u4/briefs/<unknown> with the service token answers 404 NOT_FOUND (intake live),
#   * LPHHW DELETE /api/u4/briefs/<unknown> answers 404/405 - there is no cleanup route at all
#     (the probe key matches no row, so even a hypothetical route could not delete anything).
# Only statuses, error codes and an 8-char prefix of the random probe key reach the output.
[CmdletBinding()]
param(
    [string]$HubBase = 'https://funaging-omnichannel-hub.vercel.app',
    [string]$LphhwBase = 'https://lphhw.vercel.app',
    [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
Import-Module 'D:\FUNAGING_TEMP\eco_owner\tools\FunagingSecrets.psm1' -Force

function Call([string]$Method, [string]$Url, [hashtable]$Headers, [string]$Body) {
    $p = @{ Uri = $Url; Method = $Method; UseBasicParsing = $true; TimeoutSec = 30; SkipHttpErrorCheck = $true }
    if ($Headers.Count) { $p.Headers = $Headers }
    if ($Body) { $p.Body = $Body; $p.ContentType = 'application/json' }
    try {
        $r = Invoke-WebRequest @p
        $code = $null
        try { $code = ($r.Content | ConvertFrom-Json).error } catch { }
        return [pscustomobject]@{ status = [int]$r.StatusCode; code = $code }
    } catch {
        return [pscustomobject]@{ status = 0; code = 'TRANSPORT_ERROR' }
    }
}

function Presence([string]$Key) {
    $present = Test-FunagingSecret -Key $Key
    return [bool]$present
}

$rec = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o') }
$rec.vault = [ordered]@{
    LPHHW_SERVICE_TOKEN   = (Presence 'LPHHW_SERVICE_TOKEN')
    HUB_INGEST_TOKEN      = (Presence 'HUB_INGEST_TOKEN')
    TFI_RESEARCH_API_TOKEN = (Presence 'TFI_RESEARCH_API_TOKEN')
}

# A random 64-hex idempotency key that matches no row in any system. Only its first 8 chars are recorded.
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$rec.probeKey8 = $key.Substring(0, 8)

$rec.hub = [ordered]@{
    health = (Call 'GET' "$HubBase/health" @{} '')
    version = (Call 'GET' "$HubBase/version" @{} '')
    anonymousPost = (Call 'POST' "$HubBase/api/tfi/brief" @{ 'x-tenant-id' = 'track-c-g3' } '{}')
}
if (Test-FunagingSecret -Key 'HUB_INGEST_TOKEN') {
    $hubTok = Get-FunagingSecret -Key 'HUB_INGEST_TOKEN'
    $rec.hub.authorizedReadUnknown = (Call 'GET' "$HubBase/api/tfi/brief" @{
        Authorization = "Bearer $hubTok"; 'x-tenant-id' = 'track-c-g3'; 'x-idempotency-key' = $key
    } '')
    Remove-Variable hubTok -Force
}

$rec.lphhw = [ordered]@{
    version = (Call 'GET' "$LphhwBase/version.json" @{} '')
    authenticatedAnonymous = (Call 'GET' "$LphhwBase/api/u4/briefs/$key" @{ 'x-tenant-id' = 'track-c-g3' } '')
}
if (Test-FunagingSecret -Key 'LPHHW_SERVICE_TOKEN') {
    $svc = Get-FunagingSecret -Key 'LPHHW_SERVICE_TOKEN'
    $h = @{ 'x-tfi-service-token' = $svc; 'x-tenant-id' = 'track-c-g3' }
    $rec.lphhw.authorizedReadUnknown = (Call 'GET' "$LphhwBase/api/u4/briefs/$key" $h '')
    $rec.lphhw.authorizedDeleteUnknown = (Call 'DELETE' "$LphhwBase/api/u4/briefs/$key" $h '')
    Remove-Variable svc -Force
}

$json = ($rec | ConvertTo-Json -Depth 6)
if ($json -match '\b[0-9a-f]{64}\b') {
    $json = (@{ at = $rec.at; refused = 'a 64-hex value appeared in the probe output' } | ConvertTo-Json)
}
if ($Out) { $json | Set-Content -LiteralPath $Out -Encoding UTF8 }
Write-Output $json
